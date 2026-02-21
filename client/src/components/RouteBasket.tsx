import { useRef, useState } from "react";
import type { ParkResponse } from "@shared/routes";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, GripVertical, Wand2, ExternalLink, Download, Route } from "lucide-react";
import { optimizeRoute, buildGoogleMapsUrl, generateGpx } from "@/lib/route-utils";

interface RouteBasketProps {
  parks: ParkResponse[];
  onClose: () => void;
  onReorder: (parks: ParkResponse[]) => void;
  onRemove: (id: number) => void;
}

export function RouteBasket({ parks, onClose, onReorder, onRemove }: RouteBasketProps) {
  const [isLoop, setIsLoop] = useState(false);
  const dragIdx = useRef<number | null>(null);
  const dragOverIdx = useRef<number | null>(null);

  const newParksCount = parks.filter((p) => !p.completed).length;
  const completedInRoute = parks.length - newParksCount;

  function handleOptimize() {
    onReorder(optimizeRoute(parks));
  }

  function handleGoogleMaps() {
    const url = buildGoogleMapsUrl(parks, isLoop);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function handleDownloadGpx() {
    const gpx = generateGpx(parks, isLoop);
    const blob = new Blob([gpx], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "park-route.gpx";
    a.click();
    URL.revokeObjectURL(url);
  }

  function onDragStart(idx: number) {
    dragIdx.current = idx;
  }

  function onDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;
    if (dragOverIdx.current === idx) return;
    dragOverIdx.current = idx;

    const reordered = [...parks];
    const [moved] = reordered.splice(dragIdx.current, 1);
    reordered.splice(idx, 0, moved);
    dragIdx.current = idx;
    onReorder(reordered);
  }

  function onDragEnd() {
    dragIdx.current = null;
    dragOverIdx.current = null;
  }

  return (
    <div className="absolute right-0 top-0 h-full w-72 bg-background/97 backdrop-blur-sm border-l border-border shadow-2xl z-[999] flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <Route className="w-4 h-4 text-primary" />
          <h2 className="font-bold text-sm">Route Builder</h2>
          {parks.length > 0 && (
            <span className="bg-primary text-primary-foreground text-xs font-bold px-1.5 py-0.5 rounded-full leading-none">
              {parks.length}
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7">
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Stats */}
      {parks.length > 0 && (
        <div className="px-4 py-3 bg-muted/30 border-b border-border flex-shrink-0 space-y-0.5">
          <p className="text-sm font-medium">
            <span className="text-green-600 dark:text-green-400 font-bold">{newParksCount}</span>{" "}
            new {newParksCount === 1 ? "park" : "parks"} covered
          </p>
          {completedInRoute > 0 && (
            <p className="text-xs text-muted-foreground">
              {completedInRoute} already completed
            </p>
          )}
        </div>
      )}

      {/* Park list */}
      <ScrollArea className="flex-1">
        {parks.length === 0 ? (
          <div className="p-6 text-center text-muted-foreground mt-4">
            <Route className="w-8 h-8 mx-auto mb-3 opacity-20" />
            <p className="text-sm font-medium">No parks added yet</p>
            <p className="text-xs mt-1 leading-relaxed">
              Click any park on the map to add it to your route
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {parks.map((park, idx) => (
              <div
                key={park.id}
                draggable
                onDragStart={() => onDragStart(idx)}
                onDragOver={(e) => onDragOver(e, idx)}
                onDragEnd={onDragEnd}
                className="flex items-center gap-2 p-2 rounded-lg bg-card border border-border hover:border-primary/40 transition-colors cursor-grab active:cursor-grabbing active:opacity-60 group"
              >
                <GripVertical className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />

                {/* Completion indicator square */}
                <div
                  className={`w-3 h-3 rounded-sm flex-shrink-0 ${
                    park.completed
                      ? "bg-yellow-500"
                      : "bg-green-500"
                  }`}
                  title={park.completed ? "Already completed" : "New park"}
                />

                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate leading-tight">{park.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{park.borough}</p>
                </div>

                <span className="text-xs text-muted-foreground/50 flex-shrink-0 font-mono w-4 text-right">
                  {idx + 1}
                </span>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => onRemove(park.id)}
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Footer actions */}
      <div className="p-4 border-t border-border space-y-3 flex-shrink-0">
        {parks.length >= 2 && (
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleOptimize}
          >
            <Wand2 className="w-3.5 h-3.5 mr-1.5" />
            Auto-optimize order
          </Button>
        )}

        <div className="flex items-center justify-between">
          <Label htmlFor="route-loop-toggle" className="text-sm cursor-pointer select-none">
            Make it a loop
          </Label>
          <Switch
            id="route-loop-toggle"
            checked={isLoop}
            onCheckedChange={setIsLoop}
          />
        </div>

        <Button
          className="w-full"
          onClick={handleDownloadGpx}
          disabled={parks.length === 0}
        >
          <Download className="w-3.5 h-3.5 mr-1.5" />
          Download GPX for Komoot
        </Button>

        <Button
          variant="outline"
          className="w-full"
          onClick={handleGoogleMaps}
          disabled={parks.length === 0}
        >
          <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
          Open in Google Maps
        </Button>
      </div>
    </div>
  );
}
