import { useMap } from "react-leaflet";
import { useEffect } from "react";

interface MapControllerProps {
  flyTo?: { lat: number; lng: number; zoom?: number } | null;
}

export function MapController({ flyTo }: MapControllerProps) {
  const map = useMap();

  useEffect(() => {
    if (flyTo) {
      map.flyTo([flyTo.lat, flyTo.lng], flyTo.zoom ?? 16, { duration: 0.8 });
    }
  }, [flyTo, map]);

  return null;
}
