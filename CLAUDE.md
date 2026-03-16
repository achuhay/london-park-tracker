# London Park Tracker — Claude Instructions

## What this project is
A public-facing web app for tracking London parks you've run through. Users can mark parks as completed, build routes, and connect Strava to auto-sync runs. Built with React (frontend), Express (backend), PostgreSQL (database), and Leaflet for the map.

---

## How to communicate with me (the user)
- I am a **complete beginner** — always explain what you're doing and why, in plain English
- No jargon without a quick explanation of what it means
- When something breaks: tell me **what broke, why it broke, and what you did to fix it** so I learn
- When making a non-obvious decision, briefly say why you chose that approach

---

## Git & commit rules
- **After every meaningful chunk of work: commit and push automatically** — no need to ask
- Write commit messages in plain English (e.g. "Add Strava button to sidebar", not "feat(strava): add CTA component")
- Never commit `.env` — it contains secrets and is already in .gitignore
- Always work on a branch — never commit directly to `main`
- If we've been building something for a while without committing, remind me

---

## Dev server rules
- After making code changes, always verify the dev server still works before finishing
- Check the map loads and parks appear — that's the core of the app
- If the server crashes, explain why before restarting it

---

## Technical gotchas (hard rules — do not change these)
- **Port:** Dev server must use port **3001** — port 5000 is permanently taken by macOS AirPlay Receiver
- **`.env` in worktrees:** The `.env` file is not tracked by git, so it must be manually copied into any new git worktree
- **Vite config:** `fs.strict` must be `false` in `server/vite.ts` — Leaflet image assets resolve to the main repo's `node_modules`, which is outside the worktree's Vite root
- **Vite logger:** Do not add `process.exit(1)` to the Vite custom error logger — it will crash the server on non-fatal warnings
- **Auth:** Replit OIDC auth is disabled in development (`NODE_ENV !== 'production'`) — this is intentional

---

## Key file locations
- Frontend pages: `client/src/pages/`
- Frontend components: `client/src/components/`
- API routes: `server/routes.ts`
- Dev server setup: `server/index.ts`, `server/vite.ts`
- Shared types & API schema: `shared/`
- Database schema: `shared/schema.ts`
- Environment variables: `.env` (not in git — copy manually to new worktrees)
- Dev server config: `.claude/launch.json` (port 3001)
