import { Polyline, Popup } from "react-leaflet";
import { useStoredActivities, decodePolyline } from "@/hooks/use-strava";
import { useMemo } from "react";

interface RouteOverlayProps {
  visible: boolean;
}

export function RouteOverlay({ visible }: RouteOverlayProps) {
  const { data: activities = [] } = useStoredActivities();

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

  return (
    <>
      {decodedActivities.map((activity) => (
        <Polyline
          key={activity.id}
          positions={activity.positions}
          pathOptions={{
            color: "hsl(220 70% 50%)",
            weight: 3,
            opacity: 0.7,
            dashArray: undefined,
          }}
        >
          <Popup>
            <div className="min-w-[150px]">
              <div className="font-semibold text-sm">{activity.name}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {new Date(activity.startDate).toLocaleDateString("en-GB", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </div>
              {activity.distance && (
                <div className="text-xs mt-1">
                  {(activity.distance / 1000).toFixed(2)} km
                </div>
              )}
            </div>
          </Popup>
        </Polyline>
      ))}
    </>
  );
}
