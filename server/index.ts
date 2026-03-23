import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./db";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

// Extend express-session types for our custom session data
declare module "express-session" {
  interface SessionData {
    userId: string;
    athleteName: string;
  }
}

const app = express();
// Trust Railway/Caddy reverse proxy so req.get("host") and req.get("x-forwarded-proto") work
app.set("trust proxy", 1);
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// Session middleware — persists to PostgreSQL so sessions survive restarts
const PgSession = connectPgSimple(session);
app.use(session({
  store: new PgSession({
    pool: pool,  // Reuse the same pg Pool as Drizzle — guarantees same database
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || "dev-secret-change-in-prod",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
}));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        // Large responses (e.g. /api/parks with 3000+ parks + polygon arrays) would
        // take seconds to JSON.stringify, blocking the event loop and making every
        // subsequent request slow. For arrays, just log the count. For small objects,
        // log the full body truncated to 200 chars.
        if (Array.isArray(capturedJsonResponse)) {
          logLine += ` :: [${capturedJsonResponse.length} items]`;
        } else {
          const body = JSON.stringify(capturedJsonResponse);
          logLine += ` :: ${body.length > 200 ? body.slice(0, 200) + "…" : body}`;
        }
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
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
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
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
