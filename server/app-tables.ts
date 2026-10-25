import { sql } from "drizzle-orm";
import { db } from "./db";

// Railway doesn't run `drizzle-kit push` on deploy, so tables added after launch are created
// here at server start. Every statement is "IF NOT EXISTS", so this is safe on every start.
export async function ensureAppTables(): Promise<void> {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS park_ratings (
    id serial PRIMARY KEY,
    user_id text NOT NULL,
    park_id integer NOT NULL,
    site_ref text,
    rating integer NOT NULL,
    updated_at timestamp NOT NULL DEFAULT now(),
    CONSTRAINT park_ratings_user_park UNIQUE (user_id, park_id)
  )`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS park_ratings_user_idx ON park_ratings (user_id)`);
}
