import { useEffect } from "react";
import { useMap } from "react-leaflet";
import L from "leaflet";

/**
 * The background map (streets, water, place names) under the parks.
 *
 * "map" uses OpenFreeMap's free vector tiles — no API key, no usage limits, commercial use allowed,
 * attribution required (https://openfreemap.org). We restyle them to match Detour's colours and
 * draw them with MapLibre inside Leaflet, so Leaflet still handles the parks, routes and clicks.
 * MapLibre is only downloaded when the map first shows, so it doesn't slow the first page load.
 *
 * If the phone can't do WebGL (or the tiles fail to load) we fall back to plain image tiles:
 * CARTO when the site has a CARTO key (production does), otherwise OpenStreetMap's own tiles.
 *
 * "satellite" uses Esri's World Imagery tiles, as before.
 */
export type BaseMapMode = "map" | "satellite";

const PARKS_CREDIT = 'Parks &copy; <a href="https://www.gigl.org.uk/" target="_blank" rel="noreferrer">GiGL</a> (OGL v3)';
const OFM_CREDIT =
  '<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OpenFreeMap</a> &copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

const STYLE_URL = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
};

type Paint = Record<string, unknown>;
type StyleLayer = { id: string; type: string; paint?: Paint; layout?: Paint };
type Style = { layers: StyleLayer[] } & Record<string, unknown>;

/** Recolour OpenFreeMap's styles so streets stay quiet and our park shapes do the talking. */
function tuneStyle(style: Style, dark: boolean): Style {
  const c = dark
    ? { land: "#161714", water: "#0E1B22", green: "#1A201A", building: "#1D1E1B", buildingLine: "#24251F", minor: "#23241F", major: "#2B2C27", path: "#22231F" }
    : { land: "#F1F0EB", water: "#C9DCE6", green: "#E2E8DD", building: "#E6E4DD", buildingLine: "#DCDAD2", minor: "#FFFFFF", major: "#FFFFFF", path: "#E7E5DE" };

  const set = (id: string, paint: Paint, drop: string[] = []) => {
    const layer = style.layers.find((l) => l.id === id);
    if (!layer) return;
    layer.paint = { ...(layer.paint ?? {}), ...paint };
    drop.forEach((k) => delete layer.paint![k]);
  };

  set("background", { "background-color": c.land });
  set("water", { "fill-color": c.water });
  set("waterway", { "line-color": c.water });
  set("park", { "fill-color": c.green });
  set("landuse_park", { "fill-color": c.green });
  set("landcover_wood", { "fill-color": c.green }, ["fill-pattern"]);
  set("landuse_residential", { "fill-color": c.land, "fill-opacity": 0.4 });
  set("road_area_pier", { "fill-color": c.land });
  set("building", { "fill-color": c.building, "fill-outline-color": c.buildingLine });
  set("highway_minor", { "line-color": c.minor });
  set("highway_major_inner", { "line-color": c.major });
  set("highway_path", { "line-color": c.path });
  return style;
}

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

// Styles are small JSON files; keep each one after the first download.
const styleCache = new Map<string, Promise<Style>>();
function loadStyle(dark: boolean): Promise<Style> {
  const url = dark ? STYLE_URL.dark : STYLE_URL.light;
  if (!styleCache.has(url)) {
    styleCache.set(
      url,
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`Map style failed to load (${r.status})`);
        return r.json();
      }),
    );
  }
  // Clone so tuning one theme never mutates the cached original
  return styleCache.get(url)!.then((s) => tuneStyle(structuredClone(s), dark));
}

async function createVectorLayer(dark: boolean): Promise<L.Layer> {
  if (!hasWebGL()) throw new Error("WebGL not available");
  const [maplibre, workerUrl, plugin, style] = await Promise.all([
    import("maplibre-gl"),
    // MapLibre draws tiles in a background "worker". Tell it where the bundler put that file,
    // otherwise it looks next to itself and can't find it.
    import("maplibre-gl/dist/maplibre-gl-worker.mjs?url").then((m) => m.default as string),
    import("@maplibre/maplibre-gl-leaflet"),
    loadStyle(dark),
    import("maplibre-gl/dist/maplibre-gl.css"),
  ]);
  maplibre.setWorkerUrl(workerUrl);
  const layer = plugin.maplibreGL({
    style: style as any,
    // Our own credit line (the plugin reads customAttribution for Leaflet's attribution box)
    attributionControl: { customAttribution: `${OFM_CREDIT} | ${PARKS_CREDIT}` } as any,
    className: "detour-basemap",
  } as any);
  return layer;
}

function createRasterFallback(dark: boolean, cartoApiKey?: string | null): L.Layer {
  if (cartoApiKey) {
    return L.tileLayer(
      `https://{s}.basemaps.cartocdn.com/${dark ? "dark_all" : "voyager"}/{z}/{x}/{y}{r}.png?key=${cartoApiKey}`,
      {
        attribution: `&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a> | ${PARKS_CREDIT}`,
        maxZoom: 20,
      },
    );
  }
  return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: `&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | ${PARKS_CREDIT}`,
    maxZoom: 19,
  });
}

function createSatellite(): L.Layer {
  return L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    attribution: `Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community | ${PARKS_CREDIT}`,
    maxZoom: 19,
  });
}

interface BaseMapProps {
  mode?: BaseMapMode;
  dark?: boolean;
  cartoApiKey?: string | null;
}

/** Drop inside a react-leaflet <MapContainer>. */
export function BaseMap({ mode = "map", dark = false, cartoApiKey }: BaseMapProps) {
  const map = useMap();

  useEffect(() => {
    let layer: L.Layer | null = null;
    let cancelled = false;

    const show = (next: L.Layer) => {
      if (cancelled) return;
      layer = next;
      next.addTo(map);
    };

    if (mode === "satellite") {
      show(createSatellite());
    } else {
      createVectorLayer(dark)
        .then(show)
        .catch((err) => {
          console.warn("Vector basemap unavailable, using image tiles instead:", err);
          show(createRasterFallback(dark, cartoApiKey));
        });
    }

    return () => {
      cancelled = true;
      if (layer) map.removeLayer(layer);
    };
  }, [map, mode, dark, cartoApiKey]);

  return null;
}
