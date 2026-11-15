import { useStravaStatus } from "@/hooks/use-strava";

/**
 * Who is using the app right now, as far as the screens need to know.
 *
 * You sign in to Detour by connecting Strava. `signedIn` means the server knows who you are;
 * `connected` means it also holds a working Strava link. When the link has died
 * (`needsReconnect`, reported by the server since the "stay connected" fix) you're still signed in
 * and keep your parks — the app just asks you to reconnect instead of treating you as new.
 *
 * Screens only ask for personal data (badges, ratings, runs) once `signedIn` is true, so
 * visitors don't trigger a burst of "not logged in" errors.
 */
export function useSession() {
  const { data, isLoading } = useStravaStatus();
  const status = data as (typeof data & { needsReconnect?: boolean }) | undefined;
  const connected = !!status?.connected;
  const needsReconnect = !connected && !!status?.needsReconnect;
  const signedIn = connected || needsReconnect || !!status?.athleteName;
  return {
    isLoading,
    configured: !!status?.configured,
    connected,
    signedIn,
    needsReconnect: needsReconnect || (signedIn && !connected),
    athleteName: status?.athleteName ?? null,
  };
}
