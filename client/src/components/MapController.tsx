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
      // Check for polygon data
      const polygon = park.polygon as unknown as [number, number][];
      if (Array.isArray(polygon) && polygon.length > 0) {
        polygon.forEach((coord) => {
          bounds.extend(coord);
          hasValidBounds = true;
        });
      } else if (park.latitude && park.longitude) {
        // Use point location if no polygon
        bounds.extend([park.latitude, park.longitude]);
        hasValidBounds = true;
      }
    });

    if (hasValidBounds) {
      map.fitBounds(bounds, { padding: [50, 50] });
    } else {
      // Default to London center if no valid park data
      map.setView([51.505, -0.09], 11);
    }
  }, [parks, map]);

  return null;
}
