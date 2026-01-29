# ParkRun.LDN - London Parks Running Tracker

## Overview

A web application for tracking running progress through London's parks and green spaces. Users can visualize their completion progress on an interactive map, where parks are displayed as polygon boundaries that turn from green (incomplete) to gold (completed). The app includes filtering capabilities, progress statistics, and Strava integration for automatic park completion based on GPS route data.

## User Preferences

Preferred communication style: Simple, everyday language.

## Recent Changes (January 2026)

- Added British National Grid coordinate conversion (OSGB36 to WGS84)
- Updated schema to store easting/northing and computed lat/lng for parks
- CSV importer now supports London Parks inventory format with "Grid ref easting"/"Grid ref northing" columns
- Map displays parks as circular markers when polygon data is unavailable
- Strava sync uses 100m proximity detection for parks with point locations (no polygon)
- Added Wikidata verification for park matching (254 parks verified, 85 ambiguous parks with high confidence)
- PolygonReviewer now displays Wikidata verification badge with confidence score

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript, bundled using Vite
- **Routing**: Wouter for client-side navigation
- **State Management**: TanStack React Query for server state and caching
- **UI Components**: shadcn/ui component library with Radix UI primitives
- **Styling**: Tailwind CSS with custom CSS variables for theming
- **Mapping**: Leaflet with react-leaflet for interactive London map with polygon overlays

### Backend Architecture
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript with tsx for development
- **API Design**: RESTful endpoints under `/api/*` with Zod schema validation
- **Session Management**: Express sessions with PostgreSQL session store (connect-pg-simple)

### Data Storage
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM with drizzle-kit for migrations
- **Schema Location**: `shared/schema.ts` defines all database tables
- **Key Tables**:
  - `parks`: Stores park data with polygon boundaries, completion status, borough, and site type
  - `sessions`: Authentication session storage
  - `users`: User accounts for Replit Auth
  - `strava_tokens`: OAuth tokens for Strava integration

### Authentication
- **Provider**: Replit Auth via OpenID Connect
- **Implementation**: Passport.js with OIDC strategy
- **Session Storage**: PostgreSQL-backed sessions
- **Protected Routes**: Admin page requires authentication; public map view does not

### API Structure
- Shared route definitions in `shared/routes.ts` using Zod for type-safe API contracts
- Park CRUD operations with filtering support (borough, site type, open to public, search)
- Statistics endpoint for completion tracking
- Strava OAuth flow and activity sync endpoints

## External Dependencies

### Database
- **PostgreSQL**: Primary data store, connection via `DATABASE_URL` environment variable
- **Drizzle ORM**: Schema management and queries via `drizzle-kit push`

### Third-Party Services
- **Strava API**: OAuth2 integration for syncing running activities
  - Requires `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` environment variables
  - To set up: Create an app at https://www.strava.com/settings/api
  - OAuth flow with CSRF state parameter protection
  - Decodes activity polylines and checks intersection with park polygons using ray-casting algorithm
  - Supports both GeoJSON and simple array polygon formats
  - Tokens auto-refresh when expired
- **Komoot**: No public API available - only partner access. Users can manually export GPX files.
- **Replit Auth**: OpenID Connect authentication
  - Requires `ISSUER_URL`, `REPL_ID`, and `SESSION_SECRET` environment variables

### Mapping
- **OpenStreetMap**: Free tile provider for base map layers (no API key required)
- **Leaflet**: Client-side map rendering with polygon support

### Key npm Packages
- `drizzle-orm` / `drizzle-kit`: Database ORM and migrations
- `react-leaflet` / `leaflet`: Interactive mapping
- `papaparse`: CSV parsing for bulk park import
- `@tanstack/react-query`: Data fetching and caching
- `zod`: Runtime schema validation
- `openid-client` / `passport`: Authentication flow