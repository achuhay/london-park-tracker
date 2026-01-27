## Packages
react-leaflet | Interactive maps
leaflet | Core mapping library
papaparse | CSV parsing for bulk import
@types/leaflet | TypeScript types for leaflet
@types/papaparse | TypeScript types for papaparse
clsx | Utility for constructing className strings conditionally
tailwind-merge | Utility for merging Tailwind classes

## Notes
Leaflet requires its CSS to be loaded. We will add this to index.css or index.html.
Map tiles will use OpenStreetMap (free, no API key required).
Polygon data is expected to be an array of [lat, lng] coordinates.
