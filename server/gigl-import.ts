import { existsSync, readFileSync } from "fs";
import path from "path";
import { eq, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "./db";
import { parks, parkVisits, stravaActivities } from "@shared/schema";
import { buildParkIndex, outlineCentre, parksContainingPoint } from "./park-matching";
import { rematchUserParks } from "./strava";

// One-time switch of the park list to GiGL "Spaces to Visit" (built by scripts/build-gigl-parks.ts).
// Runs automatically at server start. Each step is recorded in the data_migrations table so it
// never runs twice, and the park swap happens inside one transaction — if anything fails, the
// old park list stays exactly as it was.
const PARKS_STEP = "gigl-v15-parks";
const VISITS_STEP = "gigl-v15-visits-rebuilt";
const DATA_FILE = path.resolve(process.cwd(), "server/data/gigl-parks.json");
const LOCK_ID = 7316001; // arbitrary number, stops two server instances importing at once

interface GiglPark {
  siteId: string;
  name: string;
  boroughs: string; // e.g. "Lambeth" or "Lambeth; Wandsworth" for parks on a border
  primaryUse: string;
  access: string;
  lat: number;
  lng: number;
  royal: boolean;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
}

const accessCategory = (access: string) => (access.startsWith("Part") ? "Partial" : "Public");

async function stepDone(name: string): Promise<boolean> {
  const result = await db.execute(sql`SELECT 1 FROM data_migrations WHERE name = ${name}`);
  return result.rows.length > 0;
}

async function importParks(): Promise<void> {
  if (!existsSync(DATA_FILE)) {
    console.error(`[GiGL import] ${DATA_FILE} not found — keeping the current park list`);
    return;
  }
  const data: { count: number; parks: GiglPark[] } = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  console.log(`[GiGL import] Replacing the park list with ${data.parks.length} GiGL sites...`);

  await db.transaction(async (tx) => {
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(${LOCK_ID}) AS ok`);
    if (!(lock.rows[0] as any)?.ok) {
      console.log("[GiGL import] Another server is already importing — skipping");
      return;
    }
    if ((await tx.execute(sql`SELECT 1 FROM data_migrations WHERE name = ${PARKS_STEP}`)).rows.length > 0) return;

    // 1. Keep a full copy of the old data, just in case.
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS parks_backup_pre_gigl AS TABLE parks`);
    await tx.execute(sql`CREATE TABLE IF NOT EXISTS park_visits_backup_pre_gigl AS TABLE park_visits`);

    // 2. Remember manual completions ("mark complete" button — no route behind them) so they can
    //    be moved onto the matching GiGL park. Route-based visits are rebuilt from routes later.
    const manualVisits = await tx
      .select({
        activityId: parkVisits.activityId,
        visitDate: parkVisits.visitDate,
        name: parks.name,
        lat: parks.latitude,
        lng: parks.longitude,
        polygon: parks.polygon,
      })
      .from(parkVisits)
      .innerJoin(stravaActivities, eq(parkVisits.activityId, stravaActivities.id))
      .innerJoin(parks, eq(parkVisits.parkId, parks.id))
      .where(isNull(stravaActivities.polyline));

    // 3. Swap the park list.
    await tx.delete(parkVisits);
    await tx.delete(parks);
    const rows = data.parks.map((p) => ({
      name: p.name,
      borough: p.boroughs.split(";")[0].trim(),
      siteType: p.primaryUse,
      openToPublic: p.access,
      accessCategory: accessCategory(p.access),
      latitude: p.lat,
      longitude: p.lng,
      polygon: p.geometry,
      siteRef: p.siteId,
      isRoyalPark: p.royal,
      adminNotes: p.boroughs.includes(";") ? `GiGL site ${p.siteId}; spans ${p.boroughs}` : `GiGL site ${p.siteId}`,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      await tx.insert(parks).values(rows.slice(i, i + 500));
    }

    // 4. Re-attach manual completions to the GiGL park at the old park's location (its pin, or
    //    the middle of its old outline if it had no pin), falling back to a park with the same name.
    const newParks = await tx.select().from(parks);
    const index = buildParkIndex(newParks);
    const simpleName = (n: string) => n.toLowerCase().replace(/\*/g, "").replace(/^the /, "").trim();
    const byName = new Map(newParks.map((p) => [simpleName(p.name), p]));
    let moved = 0;
    for (const v of manualVisits) {
      if (v.activityId == null) continue;
      const where = v.lat != null && v.lng != null ? [v.lat, v.lng] : outlineCentre(v.polygon);
      const target = (where && parksContainingPoint(index, where[0], where[1])[0]) ?? byName.get(simpleName(v.name));
      if (!target) continue;
      await tx.insert(parkVisits)
        .values({ parkId: target.id, activityId: v.activityId, visitDate: v.visitDate })
        .onConflictDoNothing();
      moved++;
    }

    await tx.execute(sql`INSERT INTO data_migrations (name) VALUES (${PARKS_STEP})`);
    console.log(`[GiGL import] Park list replaced (${rows.length} parks). Manual completions moved: ${moved} of ${manualVisits.length}`);
  });
}

async function rebuildAllVisits(): Promise<void> {
  const users = await db
    .selectDistinct({ userId: stravaActivities.userId })
    .from(stravaActivities)
    .where(isNotNull(stravaActivities.polyline));
  console.log(`[GiGL import] Rebuilding park visits for ${users.length} user(s)...`);
  for (const { userId } of users) {
    await rematchUserParks(userId);
  }
  await db.execute(sql`INSERT INTO data_migrations (name) VALUES (${VISITS_STEP}) ON CONFLICT DO NOTHING`);
  console.log("[GiGL import] Done — all park visits rebuilt against GiGL boundaries");
}

/** Called once at server start. Safe to call on every start: finished steps are skipped. */
export async function ensureGiglParks(): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS data_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  if (!(await stepDone(PARKS_STEP))) await importParks();
  if ((await stepDone(PARKS_STEP)) && !(await stepDone(VISITS_STEP))) await rebuildAllVisits();
}
