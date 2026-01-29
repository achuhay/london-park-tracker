import { useEffect } from "react";
import { useMap } from "react-leaflet";
import type { ParkResponse } from "@shared/routes";
import L from "leaflet";

interface MapControllerProps {
  parks: ParkResponse[];
}

export function MapController({ parks }: MapControllerProps) {
  const map = useMap();

  useEffect(() => {
    if (parks.length === 0) return;

    // Calculate bounds of all parks to auto-fit map
    const bounds = L.latLngBounds([]);
    let hasValidBounds = false;

    parks.forEach((park) => {
      // Check for polygon data - OSM format is [lng, lat]
      const polygon = park.polygon as unknown as [number, number][];
      if (Array.isArray(polygon) && polygon.length > 0) {
        polygon.forEach(([lng, lat]) => {
          // Convert to [lat, lng] for Leaflet
          bounds.extend([lat, lng]);
          hasValidBounds = true;
        });
      } else if (park.latitude && park.longitude) {
        // Use point location if no polygon
        bounds.extend([park.latitude, park.longitude]);
        hasValidBounds = true;
      }
    });

    if (hasValidBounds) {
      // Fit to bounds but limit to reasonable London zoom
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
    } else {
      // Default to London center if no valid park data
      map.setView([51.505, -0.09], 11);
    }
  }, [parks, map]);

  // Set initial London view on mount
  useEffect(() => {
    // Set London bounds on first load
    map.setView([51.505, -0.1], 10);
  }, []);

  return null;
}
