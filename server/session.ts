import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { RequestHandler } from "express";
import { pool } from "./db";

// What we keep in each person's session (stored in the `session` table in Postgres).
declare module "express-session" {
  interface SessionData {
    userId: string;
    athleteName: string;
    /** When we last sent the browser a fresh copy of the sign-in cookie (milliseconds). */
    renewedAt: number;
  }
}

const DAY = 24 * 60 * 60 * 1000;

/**
 * How long someone can stay away before they have to sign in again. Every visit pushes this
 * back, so anyone who keeps using the app stays signed in indefinitely. (Chrome won't keep a
 * cookie longer than 400 days, so a year is about as long as browsers allow.)
 */
export const SESSION_IDLE_LIMIT = 365 * DAY;

/** Re-send the cookie at most once a day, rather than on every request. */
const RENEW_EVERY = DAY;

/**
 * The secret the app used to sign cookies when no SESSION_SECRET was set. It is in the public
 * GitHub repo, so it is not really secret. New cookies are never signed with it once
 * SESSION_SECRET is set, but cookies already signed with it are still accepted until this date.
 * That means adding SESSION_SECRET in Railway doesn't sign anyone out: their cookie is quietly
 * re-signed with the new secret on their next visit.
 */
const LEGACY_SECRET = "dev-secret-change-in-prod";
const LEGACY_SECRET_ACCEPTED_UNTIL = Date.parse("2027-03-01T00:00:00Z");

function sessionSecrets(): string[] {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) {
    console.log("[Session] Signing cookies with SESSION_SECRET");
    return Date.now() < LEGACY_SECRET_ACCEPTED_UNTIL ? [fromEnv, LEGACY_SECRET] : [fromEnv];
  }
  if (process.env.NODE_ENV === "production") {
    console.warn(
      "[Session] WARNING: SESSION_SECRET is not set, so cookies are signed with a value that is " +
        "public on GitHub. Add a SESSION_SECRET variable in Railway (a long random string that never changes).",
    );
  }
  return [LEGACY_SECRET];
}

/**
 * Keeps people signed in while they use the app. Once a day, a signed-in visit gets a fresh cookie
 * that lasts another SESSION_IDLE_LIMIT, and the session row in the database is extended to match.
 * Changing `renewedAt` is what tells express-session to save the session and re-send the cookie.
 */
const renewSession: RequestHandler = (req, _res, next) => {
  const s = req.session;
  if (s?.userId && (!s.renewedAt || Date.now() - s.renewedAt > RENEW_EVERY)) {
    s.renewedAt = Date.now();
    // Sessions created before this change still carry the old fixed 30-day lifetime and no
    // SameSite setting. Bring them up to date so they keep working without a new sign-in.
    s.cookie.originalMaxAge = SESSION_IDLE_LIMIT;
    s.cookie.sameSite = "lax";
  }
  next();
};

/** Session middleware: sessions are stored in Postgres, so they survive restarts and deploys. */
export function sessionMiddleware(): RequestHandler[] {
  const PgSession = connectPgSimple(session);
  return [
    session({
      store: new PgSession({
        pool, // Reuse the same pg Pool as Drizzle, so it's guaranteed to be the same database
        createTableIfMissing: true,
        // Without this, every request (even for images and scripts) wrote to the database just to
        // push back the expiry. renewSession does that once a day instead.
        disableTouch: true,
      }),
      secret: sessionSecrets(),
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === "production", // HTTPS only on the live site
        httpOnly: true, // page scripts can't read it
        sameSite: "lax", // sent when Strava sends you back to us, not on other sites' requests
        maxAge: SESSION_IDLE_LIMIT,
      },
    }),
    renewSession,
  ];
}
