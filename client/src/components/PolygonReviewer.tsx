import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, Polygon } from "react-leaflet";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronLeft, ChevronRight, Check, X, MapPin } from "lucide-react";
import { api } from "@shared/routes";
import "leaflet/dist/leaflet.css";

interface AlternativePolygon {
  osmId: string;
  name: string;
  type: string;
  polygon: [number, number][];
  area: number;
  nameScore: number;
}

interface AmbiguousPark {
  id: number;
  name: string;
  borough: string;
  siteType: string;
  latitude: number | null;
  longitude: number | null;
  polygon: [number, number][] | null;
  alternativePolygons: AlternativePolygon[] | null;
  osmId: string | null;
  osmMatchScore: number | null;
  osmMatchStatus: string | null;
}

export function PolygonReviewer() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedPolygonIndex, setSelectedPolygonIndex] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data: ambiguousParks = [], isLoading, isError, error } = useQuery<AmbiguousPark[]>({
    queryKey: ["/api/parks/ambiguous"],
    queryFn: async () => {
      const res = await fetch("/api/parks/ambiguous", { credentials: "include" });
      if (!res.ok) {
        if (res.status === 401) {
          throw new Error("Please sign in to review polygons");
        }
        throw new Error("Failed to fetch ambiguous parks");
      }
      return res.json();
    },
  });

  const confirmPolygon = useMutation({
    mutationFn: async ({ parkId, polygonIndex }: { parkId: number; polygonIndex: number | null }) => {
      const res = await fetch(`/api/parks/${parkId}/confirm-polygon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ polygonIndex }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to confirm polygon");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parks/ambiguous"] });
      queryClient.invalidateQueries({ queryKey: [api.parks.list.path] });
      setSelectedPolygonIndex(null);
      if (currentIndex >= ambiguousParks.length - 1) {
        setCurrentIndex(Math.max(0, ambiguousParks.length - 2));
      }
    },
  });

  const markNoMatch = useMutation({
    mutationFn: async (parkId: number) => {
      const res = await fetch(`/api/parks/${parkId}/confirm-polygon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noMatch: true }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to mark as no match");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parks/ambiguous"] });
      queryClient.invalidateQueries({ queryKey: [api.parks.list.path] });
      setSelectedPolygonIndex(null);
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-8 flex items-center justify-center">
          <Loader2 className="w-6 h-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <X className="w-5 h-5 text-destructive" />
            Error Loading Polygons
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">{error instanceof Error ? error.message : "Failed to load ambiguous parks"}</p>
        </CardContent>
      </Card>
    );
  }

  if (ambiguousParks.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Check className="w-5 h-5 text-green-500" />
            All Polygons Reviewed
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">No ambiguous park matches remaining.</p>
        </CardContent>
      </Card>
    );
  }

  const park = ambiguousParks[currentIndex];
  if (!park) return null;

  const currentPolygon = park.polygon;
  const alternatives = park.alternativePolygons || [];
  const allPolygons = [
    { polygon: currentPolygon, name: "Current Match", osmId: park.osmId, score: park.osmMatchScore },
    ...alternatives.map((alt) => ({ polygon: alt.polygon, name: alt.name || alt.type, osmId: alt.osmId, score: alt.nameScore })),
  ].filter((p) => p.polygon && p.polygon.length > 0);

  const convertToLeaflet = (coords: [number, number][]) =>
    coords.map(([lng, lat]) => [lat, lng] as [number, number]);

  const getCenter = (coords: [number, number][]) => {
    if (!coords || coords.length === 0) {
      return park.latitude && park.longitude ? [park.latitude, park.longitude] : [51.5, -0.1];
    }
    const lats = coords.map(([, lat]) => lat);
    const lngs = coords.map(([lng]) => lng);
    return [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2];
  };

  const mapCenter = getCenter(currentPolygon || []) as [number, number];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5 text-primary" />
            Review Ambiguous Matches
          </CardTitle>
          <Badge variant="secondary">
            {currentIndex + 1} / {ambiguousParks.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            disabled={currentIndex === 0}
          >
            <ChevronLeft className="w-4 h-4 mr-1" /> Previous
          </Button>
          <div className="text-center">
            <h3 className="font-semibold">{park.name}</h3>
            <p className="text-sm text-muted-foreground">{park.borough} - {park.siteType}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentIndex((i) => Math.min(ambiguousParks.length - 1, i + 1))}
            disabled={currentIndex === ambiguousParks.length - 1}
          >
            Next <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>

        <div className="h-[300px] rounded-lg overflow-hidden border">
          <MapContainer
            key={`${park.id}-${selectedPolygonIndex}`}
            center={mapCenter}
            zoom={15}
            className="h-full w-full"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {allPolygons.map((p, idx) => {
              const isSelected = selectedPolygonIndex === idx;
              const isCurrent = idx === 0;
              const color = isSelected ? "hsl(45 93% 47%)" : isCurrent ? "hsl(151 55% 42%)" : "hsl(220 14% 50%)";
              return (
                <Polygon
                  key={p.osmId || idx}
                  positions={convertToLeaflet(p.polygon!)}
                  pathOptions={{
                    color,
                    fillColor: color,
                    fillOpacity: isSelected ? 0.5 : 0.2,
                    weight: isSelected ? 3 : 1,
                  }}
                  eventHandlers={{
                    click: () => setSelectedPolygonIndex(idx),
                  }}
                />
              );
            })}
            {park.latitude && park.longitude && (
              <Polygon
                positions={[[park.latitude, park.longitude]]}
                pathOptions={{ color: "red", fillColor: "red", fillOpacity: 1, weight: 8 }}
              />
            )}
          </MapContainer>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Select the correct polygon:</p>
          <div className="grid grid-cols-1 gap-2 max-h-[200px] overflow-y-auto">
            {allPolygons.map((p, idx) => (
              <button
                key={p.osmId || idx}
                onClick={() => setSelectedPolygonIndex(idx)}
                className={`p-3 rounded-lg border text-left transition-all ${
                  selectedPolygonIndex === idx
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">
                    {idx === 0 ? "Current: " : ""}{p.name || "Unnamed"}
                  </span>
                  <Badge variant={idx === 0 ? "default" : "secondary"} className="text-xs">
                    {(p.score! * 100).toFixed(0)}% match
                  </Badge>
                </div>
                <span className="text-xs text-muted-foreground">{p.osmId}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={() => confirmPolygon.mutate({ parkId: park.id, polygonIndex: selectedPolygonIndex })}
            disabled={selectedPolygonIndex === null || confirmPolygon.isPending}
            className="flex-1"
          >
            {confirmPolygon.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Check className="w-4 h-4 mr-2" />}
            Confirm Selection
          </Button>
          <Button
            variant="outline"
            onClick={() => markNoMatch.mutate(park.id)}
            disabled={markNoMatch.isPending}
          >
            {markNoMatch.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
            No Match
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
