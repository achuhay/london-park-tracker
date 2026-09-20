import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Loader2, Upload, TreePine } from "lucide-react";

export interface MatchedPark {
  id: number;
  name: string;
  borough: string;
  siteType: string;
}

interface RoutePreviewProps {
  onRouteLoaded: (
    coords: [number, number][],
    matchedParkIds: Set<number>,
    matchedParks: MatchedPark[]
  ) => void;
  hasActivePreview: boolean;
  matchedCount: number;
}

/**
 * Parse a GPX file string and return an array of [lat, lng] coordinate pairs.
 * Handles both <trkpt> (track) and <rtept> (route) elements.
 * If the file has more than 3000 points, it samples down to ~1500 to keep things fast.
 */
function parseGpx(gpxText: string): [number, number][] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(gpxText, "application/xml");

  const points = Array.from(doc.querySelectorAll("trkpt, rtept"));

  const coords: [number, number][] = [];
  for (const point of points) {
    const lat = parseFloat(point.getAttribute("lat") ?? "");
    const lon = parseFloat(point.getAttribute("lon") ?? "");
    if (!isNaN(lat) && !isNaN(lon)) {
      coords.push([lat, lon]);
    }
  }

  // Sample down if very dense (keeps the network request small)
  if (coords.length > 3000) {
    const step = Math.ceil(coords.length / 1500);
    return coords.filter((_, i) => i % step === 0);
  }

  return coords;
}

export function RoutePreview({
  onRouteLoaded,
  hasActivePreview,
  matchedCount,
}: RoutePreviewProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setLoading(true);

    try {
      const text = await file.text();
      const coords = parseGpx(text);

      if (coords.length < 2) {
        setError(
          "Couldn't find any route points in this file. Make sure you're uploading a .gpx route or track exported from Komoot."
        );
        setLoading(false);
        return;
      }

      const res = await fetch("/api/route-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coordinates: coords }),
        credentials: "include",
      });

      if (!res.ok) throw new Error("Server error");

      const data = await res.json();
      const matchedIds = new Set<number>(
        (data.matchedParks as MatchedPark[]).map((p) => p.id)
      );

      onRouteLoaded(coords, matchedIds, data.matchedParks);
      setDialogOpen(false);
    } catch {
      setError("Something went wrong checking your route. Please try again.");
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <Button
        variant={hasActivePreview ? "default" : "outline"}
        size="sm"
        className={`shadow-lg gap-1.5 ${
          hasActivePreview
            ? "bg-blue-600 hover:bg-blue-700 text-white border-blue-600"
            : "bg-background/95 backdrop-blur-sm"
        }`}
        onClick={() => setDialogOpen(true)}
      >
        <TreePine className="w-4 h-4" />
        <span className="hidden md:inline">
          {hasActivePreview ? `${matchedCount} parks` : "Komoot Preview"}
        </span>
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Preview Komoot Route</DialogTitle>
            <DialogDescription>
              Upload a GPX file from Komoot to see which parks your planned
              route passes through — so you can adjust it before you run.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground space-y-2">
              <p className="font-medium text-foreground">
                How to export from Komoot:
              </p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Open your planned route on Komoot</li>
                <li>
                  Click the three-dot menu (⋯) or the Share / Export button
                </li>
                <li>Choose "Export as GPX"</li>
                <li>Upload the downloaded .gpx file below</li>
              </ol>
            </div>

            {error && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-lg p-3">
                {error}
              </p>
            )}

            <label
              className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-8 cursor-pointer transition-colors ${
                loading
                  ? "opacity-50 pointer-events-none"
                  : "hover:bg-muted/30 border-border hover:border-primary/50"
              }`}
            >
              {loading ? (
                <>
                  <Loader2 className="w-8 h-8 animate-spin text-muted-foreground mb-2" />
                  <span className="text-sm text-muted-foreground">
                    Checking parks on route…
                  </span>
                </>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-muted-foreground mb-2" />
                  <span className="text-sm font-medium">
                    Click to upload GPX file
                  </span>
                  <span className="text-xs text-muted-foreground mt-1">
                    .gpx files only
                  </span>
                </>
              )}
              <input
                ref={fileRef}
                type="file"
                accept=".gpx,application/gpx+xml"
                className="sr-only"
                onChange={handleFileChange}
                disabled={loading}
              />
            </label>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
