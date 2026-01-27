import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Link2, Unlink, RefreshCw, Play, CheckCircle } from "lucide-react";
import { SiStrava } from "react-icons/si";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

interface StravaActivity {
  id: number;
  name: string;
  type: string;
  start_date: string;
  distance: number;
  moving_time: number;
}

interface SyncResult {
  parksCompleted: number[];
  message: string;
  activitiesProcessed?: number;
}

export function StravaIntegration() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [syncingActivityId, setSyncingActivityId] = useState<number | null>(null);

  const { data: status, isLoading: isLoadingStatus } = useQuery({
    queryKey: ["/api/strava/status"],
    queryFn: async () => {
      const res = await fetch("/api/strava/status", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch status");
      return res.json() as Promise<{ connected: boolean; configured: boolean }>;
    },
  });

  const { data: activities, isLoading: isLoadingActivities } = useQuery({
    queryKey: ["/api/strava/activities"],
    queryFn: async () => {
      const res = await fetch("/api/strava/activities", { credentials: "include" });
      if (!res.ok) return [];
      return res.json() as Promise<StravaActivity[]>;
    },
    enabled: status?.connected ?? false,
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/strava/disconnect", { 
        method: "POST", 
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to disconnect");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strava/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/strava/activities"] });
      toast({ title: "Disconnected", description: "Strava account has been disconnected" });
    },
  });

  const syncActivityMutation = useMutation({
    mutationFn: async (activityId: number) => {
      setSyncingActivityId(activityId);
      const res = await fetch(`/api/strava/sync/${activityId}`, { 
        method: "POST", 
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to sync activity");
      return res.json() as Promise<SyncResult>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/parks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ 
        title: data.parksCompleted.length > 0 ? "Parks Completed!" : "Synced", 
        description: data.message,
        variant: data.parksCompleted.length > 0 ? "default" : "secondary"
      });
      setSyncingActivityId(null);
    },
    onError: () => {
      setSyncingActivityId(null);
      toast({ title: "Error", description: "Failed to sync activity", variant: "destructive" });
    }
  });

  const syncAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/strava/sync-all", { 
        method: "POST", 
        credentials: "include" 
      });
      if (!res.ok) throw new Error("Failed to sync");
      return res.json() as Promise<SyncResult>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/parks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ 
        title: "Sync Complete", 
        description: data.message,
      });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to sync activities", variant: "destructive" });
    }
  });

  const formatDistance = (meters: number) => `${(meters / 1000).toFixed(2)} km`;
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const hrs = Math.floor(mins / 60);
    if (hrs > 0) return `${hrs}h ${mins % 60}m`;
    return `${mins}m`;
  };

  if (isLoadingStatus) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!status?.configured) {
    return (
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <SiStrava className="w-5 h-5 text-[#FC4C02]" />
            Strava Integration
          </CardTitle>
          <CardDescription>
            Strava API credentials are not configured. Add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET to enable automatic activity syncing.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground">
            <p className="font-medium mb-2">To set up Strava integration:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Go to <a href="https://www.strava.com/settings/api" target="_blank" rel="noopener noreferrer" className="text-primary underline">strava.com/settings/api</a></li>
              <li>Create a new application</li>
              <li>Add your Client ID and Secret as environment variables</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!status?.connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <SiStrava className="w-5 h-5 text-[#FC4C02]" />
            Strava Integration
          </CardTitle>
          <CardDescription>
            Connect your Strava account to automatically track which parks you've run through.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="bg-[#FC4C02] hover:bg-[#E34402] text-white" data-testid="button-strava-connect">
            <a href="/api/strava/connect">
              <Link2 className="w-4 h-4 mr-2" />
              Connect Strava
            </a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <SiStrava className="w-5 h-5 text-[#FC4C02]" />
              Strava Connected
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                <CheckCircle className="w-3 h-3 mr-1" /> Active
              </Badge>
            </CardTitle>
            <CardDescription>
              Your Strava account is connected. Sync your runs to auto-complete parks.
            </CardDescription>
          </div>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => disconnectMutation.mutate()}
            disabled={disconnectMutation.isPending}
            className="text-destructive hover:text-destructive"
            data-testid="button-strava-disconnect"
          >
            <Unlink className="w-4 h-4 mr-1" />
            Disconnect
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Button 
            onClick={() => syncAllMutation.mutate()}
            disabled={syncAllMutation.isPending}
            className="bg-[#FC4C02] hover:bg-[#E34402] text-white"
            data-testid="button-strava-sync-all"
          >
            {syncAllMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4 mr-2" />
            )}
            Sync All Recent Runs
          </Button>
        </div>

        {isLoadingActivities ? (
          <div className="py-4 text-center text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
            Loading activities...
          </div>
        ) : activities && activities.length > 0 ? (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-muted-foreground">Recent Runs</h4>
            <div className="max-h-64 overflow-y-auto space-y-2">
              {activities.slice(0, 10).map((activity) => (
                <div 
                  key={activity.id} 
                  className="flex items-center justify-between p-3 bg-muted/30 rounded-lg"
                  data-testid={`strava-activity-${activity.id}`}
                >
                  <div>
                    <p className="font-medium text-sm" data-testid={`text-activity-name-${activity.id}`}>{activity.name}</p>
                    <p className="text-xs text-muted-foreground" data-testid={`text-activity-details-${activity.id}`}>
                      {formatDistance(activity.distance)} - {formatDuration(activity.moving_time)} - {new Date(activity.start_date).toLocaleDateString()}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => syncActivityMutation.mutate(activity.id)}
                    disabled={syncingActivityId === activity.id}
                    data-testid={`button-sync-activity-${activity.id}`}
                  >
                    {syncingActivityId === activity.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Play className="w-3 h-3" />
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-2">No recent runs found.</p>
        )}
      </CardContent>
    </Card>
  );
}
