import { Polyline, Popup } from "react-leaflet";
import { useStoredActivities, decodePolyline } from "@/hooks/use-strava";
import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

interface RouteOverlayProps {
  visible: boolean;
  onActivityClick?: (stravaId: string) => void;
}

export function RouteOverlay({ visible, onActivityClick }: RouteOverlayProps) {
  const { data: activities = [] } = useStoredActivities();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const decodedActivities = useMemo(() => {
    if (!visible) return [];

    return activities
      .filter(a => a.polyline)
      .map(activity => ({
        ...activity,
        positions: decodePolyline(activity.polyline!),
      }));
  }, [activities, visible]);

  if (!visible || decodedActivities.length === 0) {
    return null;
  }

  const handleViewRun = (stravaId: string) => {
    if (!onActivityClick) return;
    setLoadingId(stravaId);
    onActivityClick(stravaId);
    // Loading state will clear when the popup closes / component re-renders
    setTimeout(() => setLoadingId(null), 3000);
  };

  return (
    <>
      {decodedActivities.map((activity) => (
        <Polyline
          key={activity.id}
          positions={activity.positions}
          pathOptions={{
            color: "#E85D1A",
            weight: 3,
            opacity: 0.7,
            dashArray: undefined,
          }}
        >
          <Popup>
            <div className="min-w-[180px]">
              <div className="font-semibold text-sm" style={{ color: "#2B1A0E" }}>
                {activity.name}
              </div>
              <div className="text-xs mt-1" style={{ color: "#6B8C5A" }}>
                {new Date(activity.startDate).toLocaleDateString("en-GB", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </div>
              {activity.distance && (
                <div className="text-xs mt-0.5" style={{ color: "#2B1A0E" }}>
                  {(activity.distance / 1000).toFixed(2)} km
                </div>
              )}
              {onActivityClick && (
                <button
                  onClick={() => handleViewRun(String(activity.stravaId))}
                  disabled={loadingId === String(activity.stravaId)}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-1.5 transition-colors"
                  style={{
                    backgroundColor: "#E85D1A",
                    color: "#F5EDD9",
                    cursor: loadingId === String(activity.stravaId) ? "wait" : "pointer",
                    opacity: loadingId === String(activity.stravaId) ? 0.7 : 1,
                  }}
                >
                  {loadingId === String(activity.stravaId) ? (
                    <>
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Loading...
                    </>
                  ) : (
                    "View Run Card"
                  )}
                </button>
              )}
            </div>
          </Popup>
        </Polyline>
      ))}
    </>
  );
}
