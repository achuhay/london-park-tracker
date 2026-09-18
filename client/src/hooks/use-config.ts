import { useQuery } from "@tanstack/react-query";

// Runtime config served by the backend (e.g. map tile API keys).
// Fetched at page load instead of baked into the build, since Railway
// only exposes secrets to the running server, not to the static frontend build.
export function useAppConfig() {
  return useQuery<{ cartoApiKey: string | null }>({
    queryKey: ["/api/config"],
    queryFn: async () => {
      const res = await fetch("/api/config", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch app config");
      return res.json();
    },
    staleTime: Infinity,
  });
}
