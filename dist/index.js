var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// shared/models/auth.ts
import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
var sessions, users;
var init_auth = __esm({
  "shared/models/auth.ts"() {
    "use strict";
    sessions = pgTable(
      "sessions",
      {
        sid: varchar("sid").primaryKey(),
        sess: jsonb("sess").notNull(),
        expire: timestamp("expire").notNull()
      },
      (table) => [index("IDX_session_expire").on(table.expire)]
    );
    users = pgTable("users", {
      id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
      email: varchar("email").unique(),
      firstName: varchar("first_name"),
      lastName: varchar("last_name"),
      profileImageUrl: varchar("profile_image_url"),
      createdAt: timestamp("created_at").defaultNow(),
      updatedAt: timestamp("updated_at").defaultNow()
    });
  }
});

// shared/schema.ts
var schema_exports = {};
__export(schema_exports, {
  insertParkSchema: () => insertParkSchema,
  parkVisits: () => parkVisits,
  parks: () => parks,
  sessions: () => sessions,
  stravaActivities: () => stravaActivities,
  stravaTokens: () => stravaTokens,
  users: () => users
});
import { pgTable as pgTable2, text, serial, boolean, timestamp as timestamp2, jsonb as jsonb2, index as index2, integer, doublePrecision } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
var stravaTokens, stravaActivities, parkVisits, parks, insertParkSchema;
var init_schema = __esm({
  "shared/schema.ts"() {
    "use strict";
    init_auth();
    stravaTokens = pgTable2("strava_tokens", {
      id: serial("id").primaryKey(),
      userId: text("user_id").notNull().unique(),
      // Links to auth user - one per user
      athleteId: text("athlete_id").notNull(),
      // Strava athlete ID
      accessToken: text("access_token").notNull(),
      refreshToken: text("refresh_token").notNull(),
      expiresAt: timestamp2("expires_at").notNull(),
      athleteName: text("athlete_name"),
      // "Firstname Lastname" — populated on OAuth connect
      createdAt: timestamp2("created_at").defaultNow(),
      updatedAt: timestamp2("updated_at").defaultNow()
    });
    stravaActivities = pgTable2("strava_activities", {
      id: serial("id").primaryKey(),
      stravaId: text("strava_id").notNull().unique(),
      // Strava activity ID
      userId: text("user_id").notNull(),
      // Links to auth user
      name: text("name").notNull(),
      activityType: text("activity_type").notNull(),
      // "Run", "Walk", etc.
      startDate: timestamp2("start_date").notNull(),
      distance: doublePrecision("distance"),
      // meters
      movingTime: integer("moving_time"),
      // seconds
      polyline: text("polyline"),
      // Encoded polyline for route overlay
      averagePace: integer("average_pace"),
      // seconds per km
      createdAt: timestamp2("created_at").defaultNow()
    });
    parkVisits = pgTable2("park_visits", {
      id: serial("id").primaryKey(),
      parkId: integer("park_id").notNull(),
      activityId: integer("activity_id"),
      // References stravaActivities.id (null for manual completions)
      visitDate: timestamp2("visit_date").notNull(),
      createdAt: timestamp2("created_at").defaultNow()
    }, (table) => [
      index2("park_visits_park_idx").on(table.parkId),
      index2("park_visits_activity_idx").on(table.activityId)
    ]);
    parks = pgTable2("parks", {
      id: serial("id").primaryKey(),
      name: text("name").notNull(),
      borough: text("borough").notNull(),
      siteType: text("site_type").notNull(),
      openToPublic: text("open_to_public").notNull(),
      // Original: "Yes", "No", "Partially", etc.
      accessCategory: text("access_category"),
      // Simplified: "Public", "Partial", "Not Public"
      // British National Grid coordinates (OSGB36)
      easting: integer("easting"),
      northing: integer("northing"),
      // WGS84 coordinates (computed from easting/northing)
      latitude: doublePrecision("latitude"),
      longitude: doublePrecision("longitude"),
      // Optional: GeoJSON Polygon for parks with boundary data
      polygon: jsonb2("polygon"),
      // Alternative polygon options when match is unclear
      alternativePolygons: jsonb2("alternative_polygons"),
      // OSM matching metadata
      osmId: text("osm_id"),
      osmMatchScore: doublePrecision("osm_match_score"),
      osmMatchStatus: text("osm_match_status"),
      // 'matched', 'ambiguous', 'no_match'
      // Wikidata verification
      wikidataId: text("wikidata_id"),
      wikidataVerified: boolean("wikidata_verified").default(false),
      wikidataScore: doublePrecision("wikidata_score"),
      // Additional metadata
      address: text("address"),
      postcode: text("postcode"),
      openingTimes: text("opening_times"),
      siteRef: text("site_ref"),
      completed: boolean("completed").default(false).notNull(),
      completedDate: timestamp2("completed_date"),
      gardensTrustInfo: text("gardens_trust_info"),
      adminNotes: text("admin_notes")
    }, (table) => [
      index2("park_name_borough_idx").on(table.name, table.borough)
    ]);
    insertParkSchema = createInsertSchema(parks).omit({
      id: true,
      completed: true,
      completedDate: true
    }).extend({
      // Make polygon optional (can be null if only using point data)
      polygon: z.any().optional().nullable()
    });
  }
});

// server/db.ts
var db_exports = {};
__export(db_exports, {
  db: () => db,
  pool: () => pool
});
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
var Pool, pool, db;
var init_db = __esm({
  "server/db.ts"() {
    "use strict";
    init_schema();
    ({ Pool } = pg);
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL must be set. Did you forget to provision a database?"
      );
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema: schema_exports });
  }
});

// server/replit_integrations/auth/storage.ts
import { eq } from "drizzle-orm";
var AuthStorage, authStorage;
var init_storage = __esm({
  "server/replit_integrations/auth/storage.ts"() {
    "use strict";
    init_auth();
    init_db();
    AuthStorage = class {
      async getUser(id) {
        const [user] = await db.select().from(users).where(eq(users.id, id));
        return user;
      }
      async upsertUser(userData) {
        const [user] = await db.insert(users).values(userData).onConflictDoUpdate({
          target: users.id,
          set: {
            ...userData,
            updatedAt: /* @__PURE__ */ new Date()
          }
        }).returning();
        return user;
      }
    };
    authStorage = new AuthStorage();
  }
});

// server/replit_integrations/auth/replitAuth.ts
import * as client from "openid-client";
import { Strategy } from "openid-client/passport";
import passport from "passport";
import session from "express-session";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1e3;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions"
  });
  return session({
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      maxAge: sessionTtl
    }
  });
}
function updateUserSession(user, tokens) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}
async function upsertUser(claims) {
  await authStorage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"]
  });
}
async function setupAuth(app2) {
  if (process.env.ENABLE_REPLIT_AUTH !== "true" || !process.env.REPL_ID) {
    console.warn(
      "Skipping Replit auth: ENABLE_REPLIT_AUTH must be 'true' and REPL_ID must be set"
    );
    return;
  }
  app2.set("trust proxy", 1);
  app2.use(getSession());
  app2.use(passport.initialize());
  app2.use(passport.session());
  const config = await getOidcConfig();
  const verify = async (tokens, verified) => {
    const user = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };
  const registeredStrategies = /* @__PURE__ */ new Set();
  const ensureStrategy = (domain) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`
        },
        verify
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };
  passport.serializeUser((user, cb) => cb(null, user));
  passport.deserializeUser((user, cb) => cb(null, user));
  app2.get("/api/login", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"]
    })(req, res, next);
  });
  app2.get("/api/callback", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login"
    })(req, res, next);
  });
  app2.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`
        }).href
      );
    });
  });
}
var getOidcConfig, isAuthenticated;
var init_replitAuth = __esm({
  "server/replit_integrations/auth/replitAuth.ts"() {
    "use strict";
    init_storage();
    getOidcConfig = memoize(
      async () => {
        return await client.discovery(
          new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
          process.env.REPL_ID
        );
      },
      { maxAge: 3600 * 1e3 }
    );
    isAuthenticated = async (req, res, next) => {
      const user = req.user;
      if (!req.isAuthenticated() || !user.expires_at) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const now = Math.floor(Date.now() / 1e3);
      if (now <= user.expires_at) {
        return next();
      }
      const refreshToken = user.refresh_token;
      if (!refreshToken) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }
      try {
        const config = await getOidcConfig();
        const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
        updateUserSession(user, tokenResponse);
        return next();
      } catch (error) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }
    };
  }
});

// server/replit_integrations/auth/routes.ts
function registerAuthRoutes(app2) {
  app2.get("/api/auth/user", isAuthenticated, async (req, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });
}
var init_routes = __esm({
  "server/replit_integrations/auth/routes.ts"() {
    "use strict";
    init_storage();
    init_replitAuth();
  }
});

// server/replit_integrations/auth/index.ts
var auth_exports = {};
__export(auth_exports, {
  authStorage: () => authStorage,
  getSession: () => getSession,
  isAuthenticated: () => isAuthenticated,
  registerAuthRoutes: () => registerAuthRoutes,
  setupAuth: () => setupAuth
});
var init_auth2 = __esm({
  "server/replit_integrations/auth/index.ts"() {
    "use strict";
    init_replitAuth();
    init_storage();
    init_routes();
  }
});

// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path2 from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
var vite_config_default;
var init_vite_config = __esm({
  async "vite.config.ts"() {
    "use strict";
    vite_config_default = defineConfig({
      plugins: [
        react(),
        runtimeErrorOverlay(),
        ...process.env.NODE_ENV !== "production" && process.env.REPL_ID !== void 0 ? [
          await import("@replit/vite-plugin-cartographer").then(
            (m) => m.cartographer()
          ),
          await import("@replit/vite-plugin-dev-banner").then(
            (m) => m.devBanner()
          )
        ] : []
      ],
      resolve: {
        alias: {
          "@": path2.resolve(import.meta.dirname, "client", "src"),
          "@shared": path2.resolve(import.meta.dirname, "shared"),
          "@assets": path2.resolve(import.meta.dirname, "attached_assets")
        }
      },
      root: path2.resolve(import.meta.dirname, "client"),
      build: {
        outDir: path2.resolve(import.meta.dirname, "dist/public"),
        emptyOutDir: true
      },
      server: {
        fs: {
          strict: true,
          deny: ["**/.*"]
        }
      }
    });
  }
});

// server/vite.ts
var vite_exports = {};
__export(vite_exports, {
  setupVite: () => setupVite
});
import { createServer as createViteServer, createLogger } from "vite";
import fs2 from "fs";
import path3 from "path";
import { nanoid } from "nanoid";
async function setupVite(server, app2) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server, path: "/vite-hmr" },
    allowedHosts: true,
    fs: { strict: false }
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
      }
    },
    server: serverOptions,
    appType: "custom"
  });
  app2.use(vite.middlewares);
  app2.use("/{*path}", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path3.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html"
      );
      let template = await fs2.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
var viteLogger;
var init_vite = __esm({
  async "server/vite.ts"() {
    "use strict";
    await init_vite_config();
    viteLogger = createLogger();
  }
});

// server/index.ts
import "dotenv/config";
import express2 from "express";
import session2 from "express-session";
import connectPgSimple from "connect-pg-simple";

// server/storage.ts
init_db();
init_schema();
import { eq as eq2, ilike, and, sql as sql2, inArray } from "drizzle-orm";

// shared/coordinates.ts
var AIRY_1830 = {
  a: 6377563396e-3,
  // Semi-major axis
  b: 6356256909e-3
  // Semi-minor axis
};
var WGS84 = {
  a: 6378137,
  b: 63567523142e-4
};
var E0 = 4e5;
var N0 = -1e5;
var F0 = 0.9996012717;
var PHI0 = 49 * Math.PI / 180;
var LAMBDA0 = -2 * Math.PI / 180;
var TX = 446.448;
var TY = -125.157;
var TZ = 542.06;
var RX = 0.1502 / 3600 * Math.PI / 180;
var RY = 0.247 / 3600 * Math.PI / 180;
var RZ = 0.8421 / 3600 * Math.PI / 180;
var S = -20.4894 / 1e6;
function toRadians(degrees) {
  return degrees * Math.PI / 180;
}
function toDegrees(radians) {
  return radians * 180 / Math.PI;
}
function osgb36ToLatLon(E, N) {
  const { a, b } = AIRY_1830;
  const e2 = 1 - b * b / (a * a);
  const n = (a - b) / (a + b);
  const n2 = n * n;
  const n3 = n * n * n;
  let phi = PHI0;
  let M = 0;
  do {
    phi = (N - N0 - M) / (a * F0) + phi;
    const Ma = (1 + n + 5 / 4 * n2 + 5 / 4 * n3) * (phi - PHI0);
    const Mb = (3 * n + 3 * n2 + 21 / 8 * n3) * Math.sin(phi - PHI0) * Math.cos(phi + PHI0);
    const Mc = (15 / 8 * n2 + 15 / 8 * n3) * Math.sin(2 * (phi - PHI0)) * Math.cos(2 * (phi + PHI0));
    const Md = 35 / 24 * n3 * Math.sin(3 * (phi - PHI0)) * Math.cos(3 * (phi + PHI0));
    M = b * F0 * (Ma - Mb + Mc - Md);
  } while (Math.abs(N - N0 - M) > 1e-5);
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const sin2Phi = sinPhi * sinPhi;
  const tanPhi = Math.tan(phi);
  const tan2Phi = tanPhi * tanPhi;
  const tan4Phi = tan2Phi * tan2Phi;
  const tan6Phi = tan4Phi * tan2Phi;
  const nu = a * F0 / Math.sqrt(1 - e2 * sin2Phi);
  const rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * sin2Phi, 1.5);
  const eta2 = nu / rho - 1;
  const VII = tanPhi / (2 * rho * nu);
  const VIII = tanPhi / (24 * rho * Math.pow(nu, 3)) * (5 + 3 * tan2Phi + eta2 - 9 * tan2Phi * eta2);
  const IX = tanPhi / (720 * rho * Math.pow(nu, 5)) * (61 + 90 * tan2Phi + 45 * tan4Phi);
  const X = 1 / (cosPhi * nu);
  const XI = 1 / (cosPhi * 6 * Math.pow(nu, 3)) * (nu / rho + 2 * tan2Phi);
  const XII = 1 / (cosPhi * 120 * Math.pow(nu, 5)) * (5 + 28 * tan2Phi + 24 * tan4Phi);
  const XIIA = 1 / (cosPhi * 5040 * Math.pow(nu, 7)) * (61 + 662 * tan2Phi + 1320 * tan4Phi + 720 * tan6Phi);
  const dE = E - E0;
  const dE2 = dE * dE;
  const dE3 = dE2 * dE;
  const dE4 = dE2 * dE2;
  const dE5 = dE4 * dE;
  const dE6 = dE3 * dE3;
  const dE7 = dE4 * dE3;
  const lat = phi - VII * dE2 + VIII * dE4 - IX * dE6;
  const lon = LAMBDA0 + X * dE - XI * dE3 + XII * dE5 - XIIA * dE7;
  return { lat: toDegrees(lat), lon: toDegrees(lon) };
}
function toCartesian(lat, lon, ellipsoid) {
  const { a, b } = ellipsoid;
  const sinPhi = Math.sin(toRadians(lat));
  const cosPhi = Math.cos(toRadians(lat));
  const sinLambda = Math.sin(toRadians(lon));
  const cosLambda = Math.cos(toRadians(lon));
  const e2 = 1 - b * b / (a * a);
  const nu = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  return {
    x: nu * cosPhi * cosLambda,
    y: nu * cosPhi * sinLambda,
    z: (1 - e2) * nu * sinPhi
  };
}
function toLatLon(x, y, z4, ellipsoid) {
  const { a, b } = ellipsoid;
  const e2 = 1 - b * b / (a * a);
  const p = Math.sqrt(x * x + y * y);
  let phi = Math.atan2(z4, p * (1 - e2));
  let phiP = 2 * Math.PI;
  while (Math.abs(phi - phiP) > 1e-12) {
    const sinPhi = Math.sin(phi);
    const nu = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
    phiP = phi;
    phi = Math.atan2(z4 + e2 * nu * sinPhi, p);
  }
  const lon = Math.atan2(y, x);
  return { lat: toDegrees(phi), lon: toDegrees(lon) };
}
function helmertTransform(x, y, z4) {
  return {
    x: (1 + S) * x + -RZ * y + RY * z4 + TX,
    y: RZ * x + (1 + S) * y + -RX * z4 + TY,
    z: -RY * x + RX * y + (1 + S) * z4 + TZ
  };
}
function osgbToWgs84(easting, northing) {
  const osgb = osgb36ToLatLon(easting, northing);
  const cartesian = toCartesian(osgb.lat, osgb.lon, AIRY_1830);
  const wgs84Cartesian = helmertTransform(cartesian.x, cartesian.y, cartesian.z);
  const wgs84 = toLatLon(wgs84Cartesian.x, wgs84Cartesian.y, wgs84Cartesian.z, WGS84);
  return { latitude: wgs84.lat, longitude: wgs84.lon };
}
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = toRadians(lat2 - lat1);
  const deltaLambda = toRadians(lon2 - lon1);
  const a = Math.sin(deltaPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// server/storage.ts
init_storage();
var DatabaseStorage = class {
  async getParks(params) {
    const conditions = [];
    if (params?.borough) {
      const boroughs = params.borough.split(",").map((b) => b.trim()).filter((b) => b);
      if (boroughs.length > 0) {
        conditions.push(inArray(parks.borough, boroughs));
      }
    }
    if (params?.siteType) {
      const types = params.siteType.split(",").map((t) => t.trim()).filter((t) => t);
      if (types.length > 0) {
        conditions.push(inArray(parks.siteType, types));
      }
    }
    if (params?.accessCategory) {
      const accessCategories = params.accessCategory.split(",").map((s) => s.trim()).filter((s) => s);
      if (accessCategories.length > 0) {
        conditions.push(inArray(parks.accessCategory, accessCategories));
      }
    }
    if (params?.search) {
      conditions.push(ilike(parks.name, `%${params.search}%`));
    }
    if (conditions.length === 0) {
      return await db.select().from(parks).orderBy(parks.name);
    }
    return await db.select().from(parks).where(and(...conditions)).orderBy(parks.name);
  }
  async getPark(id) {
    const [park] = await db.select().from(parks).where(eq2(parks.id, id));
    return park;
  }
  async createPark(park) {
    const [existing] = await db.select().from(parks).where(and(eq2(parks.name, park.name), eq2(parks.borough, park.borough)));
    if (existing) {
      return existing;
    }
    let parkData = { ...park };
    if (park.easting && park.northing && (!park.latitude || !park.longitude)) {
      const coords = osgbToWgs84(park.easting, park.northing);
      parkData.latitude = coords.latitude;
      parkData.longitude = coords.longitude;
    }
    const [newPark] = await db.insert(parks).values(parkData).returning();
    return newPark;
  }
  async updatePark(id, updates) {
    const [updatedPark] = await db.update(parks).set(updates).where(eq2(parks.id, id)).returning();
    return updatedPark;
  }
  async deletePark(id) {
    await db.delete(parks).where(eq2(parks.id, id));
  }
  async bulkCreateParks(parksData) {
    if (parksData.length === 0) return [];
    return await db.insert(parks).values(parksData).returning();
  }
  async getParkStats(params) {
    const allParks = await this.getParks(params);
    const total = allParks.length;
    const completed = allParks.filter((p) => p.completed).length;
    const byBorough = {};
    allParks.forEach((p) => {
      if (!byBorough[p.borough]) {
        byBorough[p.borough] = { total: 0, completed: 0 };
      }
      byBorough[p.borough].total++;
      if (p.completed) {
        byBorough[p.borough].completed++;
      }
    });
    return {
      total,
      completed,
      percentage: total > 0 ? Math.round(completed / total * 100) : 0,
      byBorough
    };
  }
  // Per-user park completion: derives "completed" from parkVisits + stravaActivities
  // instead of the global parks.completed flag
  async getParksForUser(userId, params) {
    const allParks = await this.getParks(params);
    const userVisits = await db.select({
      parkId: parkVisits.parkId,
      earliestVisit: sql2`min(${parkVisits.visitDate})`
    }).from(parkVisits).innerJoin(stravaActivities, eq2(parkVisits.activityId, stravaActivities.id)).where(eq2(stravaActivities.userId, userId)).groupBy(parkVisits.parkId);
    const visitMap = new Map(userVisits.map((v) => [v.parkId, new Date(v.earliestVisit)]));
    return allParks.map((park) => ({
      ...park,
      completed: visitMap.has(park.id),
      completedDate: visitMap.get(park.id) ?? null
    }));
  }
  async getStatsForUser(userId, params) {
    const userParks = await this.getParksForUser(userId, params);
    const total = userParks.length;
    const completed = userParks.filter((p) => p.completed).length;
    const byBorough = {};
    userParks.forEach((p) => {
      if (!byBorough[p.borough]) {
        byBorough[p.borough] = { total: 0, completed: 0 };
      }
      byBorough[p.borough].total++;
      if (p.completed) {
        byBorough[p.borough].completed++;
      }
    });
    return {
      total,
      completed,
      percentage: total > 0 ? Math.round(completed / total * 100) : 0,
      byBorough
    };
  }
  async getFilterOptions() {
    const allParks = await db.select({
      borough: parks.borough,
      siteType: parks.siteType,
      accessCategory: parks.accessCategory
    }).from(parks);
    const boroughs = [...new Set(allParks.map((p) => p.borough))].sort();
    const siteTypes = [...new Set(allParks.map((p) => p.siteType))].sort();
    const accessCategories = [...new Set(allParks.map((p) => p.accessCategory).filter(Boolean))].sort();
    return { boroughs, siteTypes, accessCategories };
  }
  async getAmbiguousParks() {
    return await db.select().from(parks).where(eq2(parks.osmMatchStatus, "ambiguous")).orderBy(parks.name);
  }
};
var storage = new DatabaseStorage();

// shared/routes.ts
init_schema();
import { z as z2 } from "zod";
var errorSchemas = {
  validation: z2.object({
    message: z2.string(),
    field: z2.string().optional()
  }),
  notFound: z2.object({
    message: z2.string()
  }),
  internal: z2.object({
    message: z2.string()
  })
};
var api = {
  parks: {
    list: {
      method: "GET",
      path: "/api/parks",
      input: z2.object({
        borough: z2.string().optional(),
        siteType: z2.string().optional(),
        accessCategory: z2.string().optional(),
        search: z2.string().optional()
      }).optional(),
      responses: {
        200: z2.array(z2.custom())
      }
    },
    get: {
      method: "GET",
      path: "/api/parks/:id",
      responses: {
        200: z2.custom(),
        404: errorSchemas.notFound
      }
    },
    create: {
      method: "POST",
      path: "/api/parks",
      input: insertParkSchema,
      responses: {
        201: z2.custom(),
        400: errorSchemas.validation,
        401: z2.object({ message: z2.string() })
        // Unauthorized
      }
    },
    update: {
      method: "PUT",
      path: "/api/parks/:id",
      input: insertParkSchema.partial().extend({
        completed: z2.boolean().optional(),
        completedDate: z2.string().optional().or(z2.date().optional())
      }),
      responses: {
        200: z2.custom(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
        401: z2.object({ message: z2.string() })
        // Unauthorized
      }
    },
    delete: {
      method: "DELETE",
      path: "/api/parks/:id",
      responses: {
        204: z2.void(),
        404: errorSchemas.notFound,
        401: z2.object({ message: z2.string() })
        // Unauthorized
      }
    },
    toggleComplete: {
      method: "PATCH",
      path: "/api/parks/:id/complete",
      input: z2.object({ completed: z2.boolean() }),
      responses: {
        200: z2.custom(),
        404: errorSchemas.notFound,
        401: z2.object({ message: z2.string() })
        // Unauthorized
      }
    },
    stats: {
      method: "GET",
      path: "/api/stats",
      responses: {
        200: z2.object({
          total: z2.number(),
          completed: z2.number(),
          percentage: z2.number(),
          byBorough: z2.record(z2.object({ total: z2.number(), completed: z2.number() }))
        })
      }
    },
    filterOptions: {
      method: "GET",
      path: "/api/parks/filter-options",
      responses: {
        200: z2.object({
          boroughs: z2.array(z2.string()),
          siteTypes: z2.array(z2.string()),
          accessCategories: z2.array(z2.string())
        })
      }
    }
  }
};

// server/routes.ts
import { z as z3 } from "zod";

// server/strava.ts
init_db();
init_schema();
import { eq as eq3, and as and2, lt, desc as desc2, sql as sql3, isNotNull, gte } from "drizzle-orm";
import crypto from "crypto";
var PARK_PROXIMITY_METERS = 100;
var STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
var STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
var APP_URL = process.env.APP_URL || void 0;
var oauthStates = /* @__PURE__ */ new Map();
var authMiddleware = (req, res, next) => {
  if (req.session?.userId) {
    req.user = { claims: { sub: req.session.userId } };
    next();
  } else {
    res.status(401).json({ error: "Not logged in" });
  }
};
function decodePolyline(encoded) {
  const points = [];
  let index3 = 0, lat = 0, lng = 0;
  while (index3 < encoded.length) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index3++) - 63;
      result |= (b & 31) << shift;
      shift += 5;
    } while (b >= 32);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;
    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index3++) - 63;
      result |= (b & 31) << shift;
      shift += 5;
    } while (b >= 32);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;
    points.push([lng / 1e5, lat / 1e5]);
  }
  return points;
}
function pointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
function segmentsIntersect(p1, p2, p3, p4) {
  const [x1, y1] = p1;
  const [x2, y2] = p2;
  const [x3, y3] = p3;
  const [x4, y4] = p4;
  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (Math.abs(denom) < 1e-10) return false;
  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
  const ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;
  return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
}
function segmentIntersectsPolygon(p1, p2, polygon) {
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (segmentsIntersect(p1, p2, polygon[j], polygon[i])) {
      return true;
    }
  }
  return false;
}
function polylineIntersectsPolygon(polyline, polygon) {
  for (const point of polyline) {
    if (pointInPolygon(point, polygon)) {
      return true;
    }
  }
  for (let i = 0; i < polyline.length - 1; i++) {
    if (segmentIntersectsPolygon(polyline[i], polyline[i + 1], polygon)) {
      return true;
    }
  }
  return false;
}
function polylinePassesNearPoint(polyline, lat, lng, thresholdMeters) {
  for (const [pointLat, pointLng] of polyline) {
    const distance = haversineDistance(pointLat, pointLng, lat, lng);
    if (distance <= thresholdMeters) {
      return true;
    }
  }
  return false;
}
function routePassesThroughPark(routePoints, park) {
  const polygonRings = extractPolygonRings(park.polygon);
  if (polygonRings.length > 0) {
    for (const ring of polygonRings) {
      if (ring.length >= 3 && polylineIntersectsPolygon(routePoints, ring)) {
        return true;
      }
    }
    if (polygonRings.some((r) => r.length >= 3)) {
      return false;
    }
  }
  if (park.latitude && park.longitude) {
    return polylinePassesNearPoint(routePoints, park.latitude, park.longitude, PARK_PROXIMITY_METERS);
  }
  return false;
}
async function getValidAccessToken(userId) {
  const [token] = await db.select().from(stravaTokens).where(eq3(stravaTokens.userId, userId));
  if (!token) return null;
  const now = /* @__PURE__ */ new Date();
  const expiresAt = new Date(token.expiresAt);
  if (now < expiresAt) {
    return token.accessToken;
  }
  if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
    console.error("Strava credentials not configured");
    return null;
  }
  try {
    const response = await fetch("https://www.strava.com/api/v3/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: token.refreshToken
      })
    });
    if (!response.ok) {
      console.error("Failed to refresh Strava token");
      return null;
    }
    const data = await response.json();
    await db.update(stravaTokens).set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: new Date(data.expires_at * 1e3),
      updatedAt: /* @__PURE__ */ new Date()
    }).where(eq3(stravaTokens.userId, userId));
    return data.access_token;
  } catch (error) {
    console.error("Error refreshing Strava token:", error);
    await db.delete(stravaTokens).where(eq3(stravaTokens.userId, userId));
    return null;
  }
}
function extractPolygonRings(polygon) {
  if (!polygon) return [];
  if (polygon.type === "Polygon" && Array.isArray(polygon.coordinates)) {
    const ring = polygon.coordinates[0].map((coord) => [coord[1], coord[0]]);
    return [ring];
  }
  if (polygon.type === "MultiPolygon" && Array.isArray(polygon.coordinates)) {
    return polygon.coordinates.map(
      (poly) => poly[0].map((coord) => [coord[1], coord[0]])
    );
  }
  if (Array.isArray(polygon) && polygon.length > 0) {
    if (Array.isArray(polygon[0]) && typeof polygon[0][0] === "number") {
      return [polygon];
    }
    if (Array.isArray(polygon[0]) && Array.isArray(polygon[0][0])) {
      return polygon;
    }
  }
  return [];
}
function registerStravaRoutes(app2) {
  app2.get("/api/strava/status", async (req, res) => {
    const userId = req.session?.userId;
    if (!userId) {
      return res.json({
        connected: false,
        configured: !!(STRAVA_CLIENT_ID && STRAVA_CLIENT_SECRET),
        athleteName: null
      });
    }
    const [token] = await db.select().from(stravaTokens).where(eq3(stravaTokens.userId, userId));
    res.json({
      connected: !!token,
      configured: !!(STRAVA_CLIENT_ID && STRAVA_CLIENT_SECRET),
      athleteName: token?.athleteName ?? null
    });
  });
  app2.get("/api/strava/connect", (req, res) => {
    if (!STRAVA_CLIENT_ID) {
      return res.status(500).json({ error: "Strava not configured" });
    }
    const state = crypto.randomBytes(32).toString("hex");
    oauthStates.set(state, {
      expiresAt: Date.now() + 10 * 60 * 1e3
      // 10 minutes
    });
    const host = req.get("host");
    const protocol = req.get("x-forwarded-proto") || req.protocol;
    const baseUrl = APP_URL || `${protocol}://${host}`;
    const redirectUri = `${baseUrl}/api/strava/callback`;
    console.log("[Strava] Connect \u2014 host:", host, "proto:", protocol, "APP_URL:", APP_URL, "\u2192 redirectUri:", redirectUri);
    const scope = "activity:read_all";
    const authUrl = `https://www.strava.com/oauth/authorize?client_id=${STRAVA_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&state=${state}&approval_prompt=force`;
    res.redirect(authUrl);
  });
  app2.get("/api/strava/callback", async (req, res) => {
    const code = req.query.code;
    const state = req.query.state;
    const error = req.query.error;
    if (error) {
      console.error("Strava OAuth denied:", error);
      return res.redirect("/?strava=denied");
    }
    if (!code || !state) {
      return res.redirect("/?strava=error");
    }
    const storedState = oauthStates.get(state);
    if (!storedState || storedState.expiresAt < Date.now()) {
      oauthStates.delete(state);
      return res.redirect("/?strava=expired");
    }
    oauthStates.delete(state);
    if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
      return res.redirect("/?strava=not_configured");
    }
    try {
      const host = req.get("host");
      const protocol = req.get("x-forwarded-proto") || req.protocol;
      const baseUrl = APP_URL || `${protocol}://${host}`;
      const redirectUri = `${baseUrl}/api/strava/callback`;
      console.log("[Strava] Callback \u2014 host:", host, "proto:", protocol, "APP_URL:", APP_URL, "\u2192 redirectUri:", redirectUri);
      const response = await fetch("https://www.strava.com/api/v3/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: STRAVA_CLIENT_ID,
          client_secret: STRAVA_CLIENT_SECRET,
          code,
          grant_type: "authorization_code"
        })
      });
      if (!response.ok) {
        const errText = await response.text();
        console.error("Strava token exchange failed:", errText);
        return res.redirect("/?strava=error");
      }
      const data = await response.json();
      const userId = String(data.athlete.id);
      const athleteName = `${data.athlete.firstname} ${data.athlete.lastname}`;
      req.session.userId = userId;
      req.session.athleteName = athleteName;
      const [existing] = await db.select().from(stravaTokens).where(eq3(stravaTokens.userId, userId));
      if (existing) {
        await db.update(stravaTokens).set({
          athleteId: userId,
          athleteName,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: new Date(data.expires_at * 1e3),
          updatedAt: /* @__PURE__ */ new Date()
        }).where(eq3(stravaTokens.userId, userId));
      } else {
        await db.insert(stravaTokens).values({
          userId,
          athleteId: userId,
          athleteName,
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: new Date(data.expires_at * 1e3)
        });
      }
      req.session.save((err) => {
        if (err) console.error("Session save error:", err);
        console.log(`[Strava] Session saved for athlete ${userId} (${athleteName})`);
        res.redirect("/?strava=connected");
      });
    } catch (error2) {
      console.error("Strava OAuth error:", error2);
      res.redirect("/?strava=error");
    }
  });
  app2.post("/api/strava/disconnect", authMiddleware, async (req, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    await db.delete(stravaTokens).where(eq3(stravaTokens.userId, userId));
    res.json({ success: true });
  });
  app2.get("/api/strava/activities", authMiddleware, async (req, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) {
      return res.status(401).json({ error: "Strava not connected" });
    }
    try {
      const response = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=30", {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!response.ok) {
        return res.status(response.status).json({ error: "Failed to fetch activities" });
      }
      const activities = await response.json();
      const runs = activities.filter((a) => a.type === "Run");
      res.json(runs);
    } catch (error) {
      console.error("Error fetching Strava activities:", error);
      res.status(500).json({ error: "Failed to fetch activities" });
    }
  });
  app2.post("/api/strava/sync/:activityId", authMiddleware, async (req, res) => {
    const userId = req.user?.claims?.sub;
    const stravaActivityId = req.params.activityId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) {
      return res.status(401).json({ error: "Strava not connected" });
    }
    try {
      const activityResponse = await fetch(
        `https://www.strava.com/api/v3/activities/${stravaActivityId}?include_all_efforts=false`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!activityResponse.ok) {
        return res.status(activityResponse.status).json({ error: "Failed to fetch activity" });
      }
      const activity = await activityResponse.json();
      const polylineEncoded = activity.map?.polyline || activity.map?.summary_polyline;
      if (!polylineEncoded) {
        return res.json({ parksCompleted: [], message: "No route data available for this activity" });
      }
      const routePoints = decodePolyline(polylineEncoded);
      const activityDate = new Date(activity.start_date);
      const [existingActivity] = await db.select().from(stravaActivities).where(eq3(stravaActivities.stravaId, String(activity.id)));
      let storedActivityId;
      if (existingActivity) {
        storedActivityId = existingActivity.id;
      } else {
        const [inserted] = await db.insert(stravaActivities).values({
          stravaId: String(activity.id),
          userId,
          name: activity.name,
          activityType: activity.type,
          startDate: activityDate,
          distance: activity.distance,
          movingTime: activity.moving_time,
          polyline: polylineEncoded,
          averagePace: activity.distance && activity.moving_time ? Math.round(activity.moving_time / (activity.distance / 1e3)) : null
        }).returning();
        storedActivityId = inserted.id;
      }
      const allParks = await storage.getParks();
      const parksCompleted = [];
      const parksVisited = [];
      for (const park of allParks) {
        if (!park.polygon && !park.latitude) continue;
        if (routePassesThroughPark(routePoints, park)) {
          parksVisited.push(park.id);
          const [existingVisit] = await db.select().from(parkVisits).where(and2(
            eq3(parkVisits.parkId, park.id),
            eq3(parkVisits.activityId, storedActivityId)
          ));
          if (!existingVisit) {
            await db.insert(parkVisits).values({
              parkId: park.id,
              activityId: storedActivityId,
              visitDate: activityDate
            });
          }
          if (!park.completed) {
            await storage.updatePark(park.id, {
              completed: true,
              completedDate: activityDate
            });
            parksCompleted.push(park.id);
          }
        }
      }
      res.json({
        parksCompleted,
        parksVisited,
        activityId: storedActivityId,
        activityName: activity.name,
        message: parksCompleted.length > 0 ? `Marked ${parksCompleted.length} new park(s) as completed! (${parksVisited.length} total parks visited)` : parksVisited.length > 0 ? `Visited ${parksVisited.length} park(s) (already completed)` : "No parks were run through in this activity"
      });
    } catch (error) {
      console.error("Error syncing activity:", error);
      res.status(500).json({ error: "Failed to sync activity" });
    }
  });
  app2.post("/api/strava/sync-latest", authMiddleware, async (req, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) {
      return res.status(401).json({ error: "Strava not connected" });
    }
    try {
      const listResponse = await fetch(
        "https://www.strava.com/api/v3/athlete/activities?per_page=1&page=1",
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!listResponse.ok) {
        return res.status(listResponse.status).json({ error: "Failed to fetch activities" });
      }
      const activities = await listResponse.json();
      if (!activities.length) {
        return res.json({ activity: null, parksCompleted: [], parksVisited: [], message: "No activities found" });
      }
      const activityResponse = await fetch(
        `https://www.strava.com/api/v3/activities/${activities[0].id}?include_all_efforts=false`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!activityResponse.ok) {
        return res.status(activityResponse.status).json({ error: "Failed to fetch activity details" });
      }
      const activity = await activityResponse.json();
      const polylineEncoded = activity.map?.polyline || activity.map?.summary_polyline;
      const activitySummary = {
        id: activity.id,
        name: activity.name,
        distance: activity.distance,
        moving_time: activity.moving_time,
        start_date: activity.start_date,
        summaryPolyline: polylineEncoded || null
      };
      if (!polylineEncoded) {
        return res.json({ activity: activitySummary, parksCompleted: [], parksVisited: [], message: "No route data for this activity" });
      }
      const routePoints = decodePolyline(polylineEncoded);
      const activityDate = new Date(activity.start_date);
      const [existingActivity] = await db.select().from(stravaActivities).where(eq3(stravaActivities.stravaId, String(activity.id)));
      let storedActivityId;
      if (existingActivity) {
        storedActivityId = existingActivity.id;
      } else {
        const [inserted] = await db.insert(stravaActivities).values({
          stravaId: String(activity.id),
          userId,
          name: activity.name,
          activityType: activity.type,
          startDate: activityDate,
          distance: activity.distance,
          movingTime: activity.moving_time,
          polyline: polylineEncoded,
          averagePace: activity.distance && activity.moving_time ? Math.round(activity.moving_time / (activity.distance / 1e3)) : null
        }).returning();
        storedActivityId = inserted.id;
      }
      const allParks = await storage.getParks();
      const parksCompletedData = [];
      const parksVisitedData = [];
      for (const park of allParks) {
        if (!park.polygon && !park.latitude) continue;
        if (routePassesThroughPark(routePoints, park)) {
          parksVisitedData.push(park);
          const [existingVisit] = await db.select().from(parkVisits).where(and2(eq3(parkVisits.parkId, park.id), eq3(parkVisits.activityId, storedActivityId)));
          if (!existingVisit) {
            await db.insert(parkVisits).values({ parkId: park.id, activityId: storedActivityId, visitDate: activityDate });
          }
          if (!park.completed) {
            await storage.updatePark(park.id, { completed: true, completedDate: activityDate });
            parksCompletedData.push({ ...park, completed: true });
          }
        }
      }
      res.json({
        activity: activitySummary,
        parksCompleted: parksCompletedData,
        parksVisited: parksVisitedData,
        message: parksCompletedData.length > 0 ? `Marked ${parksCompletedData.length} new park(s) as completed!` : parksVisitedData.length > 0 ? `Visited ${parksVisitedData.length} park(s) (already completed)` : "No parks detected on this route"
      });
    } catch (error) {
      console.error("Error syncing latest activity:", error);
      res.status(500).json({ error: "Failed to sync latest activity" });
    }
  });
  app2.put("/api/strava/activity/:activityId/description", authMiddleware, async (req, res) => {
    const userId = req.user?.claims?.sub || req.user?.id || "dev-user";
    const { activityId } = req.params;
    const { description, name } = req.body;
    if (!description && !name) {
      return res.status(400).json({ error: "description or name is required" });
    }
    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) {
      return res.status(401).json({ error: "Strava not connected" });
    }
    const updatePayload = {};
    if (name) updatePayload.name = name;
    if (description) updatePayload.description = description;
    try {
      const response = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(updatePayload)
      });
      if (!response.ok) {
        const errText = await response.text();
        console.error("Strava activity update failed:", errText);
        return res.status(response.status).json({ error: "Failed to update Strava activity" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating Strava activity description:", error);
      res.status(500).json({ error: "Failed to update activity" });
    }
  });
  app2.post("/api/strava/sync-all", authMiddleware, async (req, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const accessToken = await getValidAccessToken(userId);
    if (!accessToken) {
      return res.status(401).json({ error: "Strava not connected" });
    }
    try {
      const response = await fetch("https://www.strava.com/api/v3/athlete/activities?per_page=50", {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!response.ok) {
        return res.status(response.status).json({ error: "Failed to fetch activities" });
      }
      const activities = await response.json();
      const runs = activities.filter((a) => a.type === "Run");
      const allParks = await storage.getParks();
      const parksCompleted = /* @__PURE__ */ new Set();
      const parksVisited = /* @__PURE__ */ new Set();
      let activitiesProcessed = 0;
      let activitiesStored = 0;
      for (const activity of runs) {
        const polylineEncoded = activity.map?.summary_polyline;
        if (!polylineEncoded) continue;
        const routePoints = decodePolyline(polylineEncoded);
        const activityDate = new Date(activity.start_date);
        activitiesProcessed++;
        const [existingActivity] = await db.select().from(stravaActivities).where(eq3(stravaActivities.stravaId, String(activity.id)));
        let storedActivityId;
        if (existingActivity) {
          storedActivityId = existingActivity.id;
        } else {
          const [inserted] = await db.insert(stravaActivities).values({
            stravaId: String(activity.id),
            userId,
            name: activity.name,
            activityType: activity.type,
            startDate: activityDate,
            distance: activity.distance,
            movingTime: activity.moving_time,
            polyline: polylineEncoded
          }).returning();
          storedActivityId = inserted.id;
          activitiesStored++;
        }
        for (const park of allParks) {
          if (!park.polygon && !park.latitude) continue;
          if (routePassesThroughPark(routePoints, park)) {
            parksVisited.add(park.id);
            const [existingVisit] = await db.select().from(parkVisits).where(and2(
              eq3(parkVisits.parkId, park.id),
              eq3(parkVisits.activityId, storedActivityId)
            ));
            if (!existingVisit) {
              await db.insert(parkVisits).values({
                parkId: park.id,
                activityId: storedActivityId,
                visitDate: activityDate
              });
            }
            if (!park.completed && !parksCompleted.has(park.id)) {
              await storage.updatePark(park.id, {
                completed: true,
                completedDate: activityDate
              });
              parksCompleted.add(park.id);
            }
          }
        }
      }
      res.json({
        activitiesProcessed,
        activitiesStored,
        parksCompleted: Array.from(parksCompleted),
        parksVisited: Array.from(parksVisited),
        message: `Processed ${activitiesProcessed} runs (${activitiesStored} new), marked ${parksCompleted.size} new park(s) as completed, visited ${parksVisited.size} total parks`
      });
    } catch (error) {
      console.error("Error syncing all activities:", error);
      res.status(500).json({ error: "Failed to sync activities" });
    }
  });
  app2.get("/api/strava/stored-activities", authMiddleware, async (req, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const activities = await db.select().from(stravaActivities).where(eq3(stravaActivities.userId, userId)).orderBy(stravaActivities.startDate);
      res.json(activities);
    } catch (error) {
      console.error("Error fetching stored activities:", error);
      res.status(500).json({ error: "Failed to fetch activities" });
    }
  });
  app2.get("/api/strava/runs", authMiddleware, async (req, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    try {
      const activities = await db.select().from(stravaActivities).where(eq3(stravaActivities.userId, userId)).orderBy(desc2(stravaActivities.startDate));
      const visitCounts = await db.select({
        activityId: parkVisits.activityId,
        count: sql3`cast(count(*) as int)`
      }).from(parkVisits).where(isNotNull(parkVisits.activityId)).groupBy(parkVisits.activityId);
      const countMap = new Map(visitCounts.map((v) => [v.activityId, v.count]));
      const withCounts = activities.map((act) => ({
        ...act,
        parkCount: countMap.get(act.id) ?? 0
      }));
      res.json(withCounts);
    } catch (error) {
      console.error("Error fetching runs:", error);
      res.status(500).json({ error: "Failed to fetch runs" });
    }
  });
  app2.get("/api/strava/activity/:stravaId/summary", authMiddleware, async (req, res) => {
    const userId = req.user?.claims?.sub;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const { stravaId } = req.params;
    try {
      const [activity] = await db.select().from(stravaActivities).where(and2(
        eq3(stravaActivities.stravaId, stravaId),
        eq3(stravaActivities.userId, userId)
      ));
      if (!activity) {
        return res.status(404).json({ error: "Activity not found" });
      }
      const visits = await db.select({ parkId: parkVisits.parkId }).from(parkVisits).where(eq3(parkVisits.activityId, activity.id));
      const parkIds = visits.map((v) => v.parkId);
      const parksVisitedData = (await Promise.all(parkIds.map((id) => storage.getPark(id)))).filter(Boolean);
      const parksCompletedData = [];
      for (const park of parksVisitedData) {
        const [earlierVisit] = await db.select().from(parkVisits).where(and2(
          eq3(parkVisits.parkId, park.id),
          lt(parkVisits.activityId, activity.id)
        )).limit(1);
        if (!earlierVisit) {
          parksCompletedData.push(park);
        }
      }
      res.json({
        activity: {
          id: Number(activity.stravaId),
          name: activity.name,
          distance: activity.distance ?? 0,
          moving_time: activity.movingTime ?? 0,
          start_date: activity.startDate.toISOString(),
          summaryPolyline: activity.polyline ?? null
        },
        parksCompleted: parksCompletedData,
        parksVisited: parksVisitedData,
        message: `${parksVisitedData.length} park(s) on this run`
      });
    } catch (error) {
      console.error("Error fetching run summary:", error);
      res.status(500).json({ error: "Failed to fetch run summary" });
    }
  });
  app2.get("/api/parks/:id/visits", async (req, res) => {
    const parkId = Number(req.params.id);
    if (isNaN(parkId)) {
      return res.status(400).json({ error: "Invalid park ID" });
    }
    try {
      const visits = await db.select({
        id: parkVisits.id,
        visitDate: parkVisits.visitDate,
        activityId: parkVisits.activityId,
        activityName: stravaActivities.name,
        distance: stravaActivities.distance
      }).from(parkVisits).leftJoin(stravaActivities, eq3(parkVisits.activityId, stravaActivities.id)).where(eq3(parkVisits.parkId, parkId)).orderBy(parkVisits.visitDate);
      res.json(visits);
    } catch (error) {
      console.error("Error fetching park visits:", error);
      res.status(500).json({ error: "Failed to fetch visits" });
    }
  });
  app2.get("/api/stats/year-challenge", async (req, res) => {
    const userId = req.session?.userId;
    if (!userId) {
      const year = (/* @__PURE__ */ new Date()).getFullYear();
      return res.json({ totalVisits: 0, weekly: [], year, target: 500 });
    }
    try {
      let weekOfYear2 = function(d) {
        const start = new Date(d.getFullYear(), 0, 1);
        return Math.ceil(((d.getTime() - start.getTime()) / 864e5 + start.getDay() + 1) / 7);
      };
      var weekOfYear = weekOfYear2;
      const year = (/* @__PURE__ */ new Date()).getFullYear();
      const yearStart = /* @__PURE__ */ new Date(`${year}-01-01`);
      const visits = await db.select({ visitDate: parkVisits.visitDate }).from(parkVisits).innerJoin(stravaActivities, eq3(parkVisits.activityId, stravaActivities.id)).where(and2(
        eq3(stravaActivities.userId, userId),
        gte(parkVisits.visitDate, yearStart)
      ));
      const weekMap = /* @__PURE__ */ new Map();
      for (const v of visits) {
        const w = weekOfYear2(new Date(v.visitDate));
        weekMap.set(w, (weekMap.get(w) ?? 0) + 1);
      }
      const currentWeek = weekOfYear2(/* @__PURE__ */ new Date());
      const weekly = [];
      let cumulative = 0;
      for (let w = 1; w <= currentWeek; w++) {
        cumulative += weekMap.get(w) ?? 0;
        weekly.push({ week: w, visits: cumulative });
      }
      res.json({ totalVisits: visits.length, weekly, year, target: 500 });
    } catch (error) {
      console.error("Error fetching year challenge stats:", error);
      res.status(500).json({ error: "Failed to fetch challenge stats" });
    }
  });
}

// server/routes.ts
import Anthropic from "@anthropic-ai/sdk";
async function registerRoutes(httpServer2, app2) {
  if (process.env.ENABLE_REPLIT_AUTH === "true") {
    const { setupAuth: setupAuth2, registerAuthRoutes: registerAuthRoutes2 } = await Promise.resolve().then(() => (init_auth2(), auth_exports));
    await setupAuth2(app2);
    registerAuthRoutes2(app2);
  }
  registerStravaRoutes(app2);
  app2.get(api.parks.list.path, async (req, res) => {
    try {
      const input = api.parks.list.input?.parse(req.query);
      if (req.session?.userId) {
        const parks4 = await storage.getParksForUser(req.session.userId, input);
        return res.json(parks4);
      }
      const parks3 = await storage.getParks(input);
      res.json(parks3.map((p) => ({ ...p, completed: false, completedDate: null })));
    } catch (err) {
      if (err instanceof z3.ZodError) {
        return res.status(400).json({ message: "Invalid query parameters" });
      }
      throw err;
    }
  });
  app2.get(api.parks.stats.path, async (req, res) => {
    if (req.session?.userId) {
      const stats2 = await storage.getStatsForUser(req.session.userId, req.query);
      return res.json(stats2);
    }
    const stats = await storage.getParkStats(req.query);
    res.json({ ...stats, completed: 0, percentage: 0 });
  });
  app2.get(api.parks.filterOptions.path, async (req, res) => {
    const options = await storage.getFilterOptions();
    res.json(options);
  });
  app2.get("/api/parks/ambiguous", async (req, res) => {
    try {
      const parks3 = await storage.getAmbiguousParks();
      res.json(parks3);
    } catch (err) {
      console.error("Error fetching ambiguous parks:", err);
      res.status(500).json({ message: err instanceof Error ? err.message : "Unknown error" });
    }
  });
  app2.get(api.parks.get.path, async (req, res) => {
    const park = await storage.getPark(Number(req.params.id));
    if (!park) {
      return res.status(404).json({ message: "Park not found" });
    }
    res.json(park);
  });
  app2.post(api.parks.create.path, async (req, res) => {
    try {
      const input = api.parks.create.input.parse(req.body);
      const park = await storage.createPark(input);
      res.status(201).json(park);
    } catch (err) {
      if (err instanceof z3.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join(".")
        });
      }
      throw err;
    }
  });
  app2.put(api.parks.update.path, async (req, res) => {
    try {
      const input = api.parks.update.input.parse(req.body);
      const park = await storage.updatePark(Number(req.params.id), input);
      if (!park) {
        return res.status(404).json({ message: "Park not found" });
      }
      res.json(park);
    } catch (err) {
      if (err instanceof z3.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join(".")
        });
      }
      throw err;
    }
  });
  app2.delete(api.parks.delete.path, async (req, res) => {
    const park = await storage.getPark(Number(req.params.id));
    if (!park) {
      return res.status(404).json({ message: "Park not found" });
    }
    await storage.deletePark(Number(req.params.id));
    res.status(204).send();
  });
  app2.patch(api.parks.toggleComplete.path, async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Connect Strava to track park completions" });
    }
    const id = Number(req.params.id);
    const { completed } = req.body;
    const park = await storage.getPark(id);
    if (!park) {
      return res.status(404).json({ message: "Park not found" });
    }
    if (completed) {
      const { db: db2 } = await Promise.resolve().then(() => (init_db(), db_exports));
      const { parkVisits: parkVisits2, stravaActivities: stravaActivities2 } = await Promise.resolve().then(() => (init_schema(), schema_exports));
      const { eq: eq4, and: and3 } = await import("drizzle-orm");
      const existingVisits = await db2.select().from(parkVisits2).innerJoin(stravaActivities2, eq4(parkVisits2.activityId, stravaActivities2.id)).where(and3(eq4(parkVisits2.parkId, id), eq4(stravaActivities2.userId, req.session.userId)));
      if (existingVisits.length === 0) {
        const [activity] = await db2.insert(stravaActivities2).values({
          stravaId: `manual-${req.session.userId}-${Date.now()}`,
          userId: req.session.userId,
          name: "Manual completion",
          activityType: "Run",
          startDate: /* @__PURE__ */ new Date(),
          distance: 0,
          movingTime: 0
        }).returning();
        await db2.insert(parkVisits2).values({
          parkId: id,
          activityId: activity.id,
          visitDate: /* @__PURE__ */ new Date()
        });
      }
    } else {
      const { db: db2 } = await Promise.resolve().then(() => (init_db(), db_exports));
      const { parkVisits: parkVisits2, stravaActivities: stravaActivities2 } = await Promise.resolve().then(() => (init_schema(), schema_exports));
      const { eq: eq4, and: and3, inArray: inArray2 } = await import("drizzle-orm");
      const userActivityIds = await db2.select({ id: stravaActivities2.id }).from(stravaActivities2).where(eq4(stravaActivities2.userId, req.session.userId));
      if (userActivityIds.length > 0) {
        await db2.delete(parkVisits2).where(
          and3(
            eq4(parkVisits2.parkId, id),
            inArray2(parkVisits2.activityId, userActivityIds.map((a) => a.id))
          )
        );
      }
    }
    const updatedParks = await storage.getParksForUser(req.session.userId);
    const updatedPark = updatedParks.find((p) => p.id === id);
    res.json(updatedPark || park);
  });
  app2.post("/api/parks/:id/confirm-polygon", async (req, res) => {
    const id = Number(req.params.id);
    const { polygonIndex, noMatch } = req.body;
    const park = await storage.getPark(id);
    if (!park) {
      return res.status(404).json({ message: "Park not found" });
    }
    if (noMatch) {
      await storage.updatePark(id, {
        polygon: null,
        osmMatchStatus: "no_match",
        alternativePolygons: null
      });
      return res.json({ success: true });
    }
    const alternatives = park.alternativePolygons || [];
    if (polygonIndex === 0) {
      await storage.updatePark(id, {
        osmMatchStatus: "matched",
        alternativePolygons: null
      });
    } else if (polygonIndex > 0 && polygonIndex <= alternatives.length) {
      const selected = alternatives[polygonIndex - 1];
      await storage.updatePark(id, {
        polygon: selected.polygon,
        osmId: selected.osmId,
        osmMatchScore: selected.nameScore,
        osmMatchStatus: "matched",
        alternativePolygons: null
      });
    }
    res.json({ success: true });
  });
  app2.post("/api/import-ai-results", async (req, res) => {
    try {
      const results = req.body;
      console.log(`\u{1F4E5} Importing ${results.length} AI verification results...`);
      let updated = 0;
      let skipped = 0;
      for (const result of results) {
        let status = "ambiguous";
        if (result.recommendation === "confirm") status = "verified";
        if (result.recommendation === "alternative_found") status = "verified_alternative";
        if (result.recommendation === "reject") status = "rejected";
        if (result.recommendation === "manual_review") status = "manual_review";
        const existing = await storage.getPark(result.parkId);
        if (existing && existing.osmMatchStatus === "verified") {
          skipped++;
          continue;
        }
        await storage.updatePark(result.parkId, {
          osmMatchStatus: status,
          adminNotes: result.reasoning
        });
        updated++;
        if (updated % 100 === 0) {
          console.log(`  Processed ${updated}/${results.length}...`);
        }
      }
      console.log(`\u2705 Import complete: ${updated} updated, ${skipped} skipped`);
      res.json({ success: true, updated, skipped });
    } catch (error) {
      console.error("Import error:", error);
      res.status(500).json({ error: "Import failed" });
    }
  });
  app2.post("/api/parks/fun-facts", async (req, res) => {
    try {
      const { parkIds, activityData } = req.body;
      if (!Array.isArray(parkIds) || parkIds.length === 0) {
        return res.status(400).json({ error: "parkIds array required" });
      }
      const parkDetails = await Promise.all(
        parkIds.slice(0, 10).map((id) => storage.getPark(Number(id)))
      );
      const validParks = parkDetails.filter(Boolean);
      if (validParks.length === 0) {
        return res.json({ facts: [], stravaPost: "" });
      }
      const client2 = new Anthropic();
      const parkDescriptions = validParks.map((p) => {
        const parts = [`ID: ${p.id}
Name: ${p.name}
Borough: ${p.borough}
Type: ${p.siteType}`];
        if (p.gardensTrustInfo) parts.push(`Gardens Trust info: ${p.gardensTrustInfo}`);
        if (p.address) parts.push(`Address: ${p.address}`);
        return parts.join("\n");
      }).join("\n\n");
      const runContext = activityData ? `Run: ${activityData.name}, ${(activityData.distance / 1e3).toFixed(1)}km, ${Math.floor(activityData.moving_time / 60)}min, ${activityData.newParksCount} new park(s), ${activityData.totalParksVisited} total park(s) visited.` : "";
      const message = await client2.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1200,
        messages: [{
          role: "user",
          content: `You are a knowledgeable guide to London's green spaces. A runner just completed a run through some London parks.

${runContext}

Parks visited:

${parkDescriptions}

Do two things and format your response EXACTLY as shown \u2014 two clearly separated sections:

FACTS_JSON:
{"facts":[{"parkId":<id>,"parkName":"<name>","facts":["fact 1","fact 2"]}]}

STRAVA_POST:
<A short, fun, first-person Strava caption. 2-3 sentences. Mention the parks and boroughs by name. Enthusiastic but natural, like something a real runner would post.>

Rules:
- The FACTS_JSON section must be valid JSON, nothing else
- The STRAVA_POST section is plain text, no quotes around it
- Do not add any other text`
        }]
      });
      const content = message.content[0];
      if (content.type !== "text") {
        return res.status(500).json({ error: "Unexpected AI response format" });
      }
      const raw = content.text;
      const factsMatch = raw.match(/FACTS_JSON:\s*(\{[\s\S]*?\})\s*(?:STRAVA_POST:|$)/);
      const postMatch = raw.match(/STRAVA_POST:\s*([\s\S]+)/);
      let facts = [];
      if (factsMatch) {
        try {
          const parsed = JSON.parse(factsMatch[1]);
          facts = parsed.facts || [];
        } catch (e) {
          console.error("Failed to parse facts JSON:", e);
        }
      }
      const stravaPost = postMatch ? postMatch[1].trim() : "";
      res.json({ facts, stravaPost });
    } catch (error) {
      console.error("Error generating fun facts:", error);
      res.status(500).json({ error: "Failed to generate fun facts" });
    }
  });
  app2.post("/api/marathon/chat", async (req, res) => {
    try {
      const { question, context } = req.body;
      if (!question || typeof question !== "string") {
        return res.status(400).json({ error: "question is required" });
      }
      const today = (/* @__PURE__ */ new Date()).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
      let prompt = `You are a personal marathon running coach with deep knowledge of training science. Answer in 3\u20135 sentences. Be specific and direct. Reference the runner's actual numbers when relevant. Plain text only \u2014 no markdown, no bullet points, no asterisks.

Runner's training data (today: ${today}):
- Last 4 weeks: ${context.total4wk} km total (avg ${(context.total4wk / 4).toFixed(1)} km/week)
- 8-week average: ${context.avg8wk} km/week
- Longest run ever: ${context.longestEver} km
- Recent long run (last 4 weeks): ${context.currentLongRun} km`;
      if (context.last4Weeks?.length) {
        prompt += `
- Last 4 weekly totals: ${context.last4Weeks.join(", ")} km`;
      }
      if (context.goal) {
        const { raceDate, goalHours, goalMinutes, weeksLeft, targetLongRun, racePaceSec } = context.goal;
        const paceMin = Math.floor(racePaceSec / 60);
        const paceSec = Math.round(racePaceSec % 60);
        const paceStr = `${paceMin}:${String(paceSec).padStart(2, "0")} /km`;
        prompt += `
- Target race: ${new Date(raceDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} (${weeksLeft} weeks away)`;
        prompt += `
- Goal finish time: ${goalHours}h ${String(goalMinutes).padStart(2, "0")}m (${paceStr} pace)`;
        prompt += `
- Long run: ${context.currentLongRun} km vs ${targetLongRun} km target`;
      }
      prompt += `

Question: ${question}`;
      const client2 = new Anthropic();
      const message = await client2.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }]
      });
      const content = message.content[0];
      if (content.type !== "text") {
        return res.status(500).json({ error: "Unexpected AI response format" });
      }
      res.json({ answer: content.text });
    } catch (error) {
      console.error("Error in marathon chat:", error);
      res.status(500).json({ error: "Failed to get coaching response" });
    }
  });
  return httpServer2;
}

// server/static.ts
import express from "express";
import fs from "fs";
import path from "path";
function serveStatic(app2) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app2.use(express.static(distPath));
  app2.use("/{*path}", (_req, res) => {
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}

// server/index.ts
import { createServer } from "http";
var app = express2();
app.set("trust proxy", 1);
var httpServer = createServer(app);
app.use(
  express2.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    }
  })
);
app.use(express2.urlencoded({ extended: false }));
var PgSession = connectPgSimple(session2);
app.use(session2({
  store: new PgSession({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true
  }),
  secret: process.env.SESSION_SECRET || "dev-secret-change-in-prod",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1e3
    // 30 days
  }
}));
function log(message, source = "express") {
  const formattedTime = (/* @__PURE__ */ new Date()).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
  console.log(`${formattedTime} [${source}] ${message}`);
}
app.use((req, res, next) => {
  const start = Date.now();
  const path4 = req.path;
  let capturedJsonResponse = void 0;
  const originalResJson = res.json;
  res.json = function(bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path4.startsWith("/api")) {
      let logLine = `${req.method} ${path4} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }
      log(logLine);
    }
  });
  next();
});
(async () => {
  await registerRoutes(httpServer, app);
  app.use((err, _req, res, next) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";
    console.error("Internal Server Error:", err);
    if (res.headersSent) {
      return next(err);
    }
    return res.status(status).json({ message });
  });
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite: setupVite2 } = await init_vite().then(() => vite_exports);
    await setupVite2(httpServer, app);
  }
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(port, () => {
    log(`serving on port ${port}`);
  });
})().catch((err) => {
  console.error("=== STARTUP CRASH ===");
  console.error("Error:", err.message);
  console.error("Stack:", err.stack);
  console.error("=====================");
  process.exit(1);
});
export {
  log
};
