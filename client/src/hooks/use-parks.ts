import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl, type ParkInput, type ParksQueryParams } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

// Fetch all parks with optional filters
export function useParks(filters?: ParksQueryParams) {
  // Construct query key that includes filters so it refetches when they change
  const queryKey = [api.parks.list.path, filters];
  
  return useQuery({
    queryKey,
    queryFn: async () => {
      // Build query string
      const searchParams = new URLSearchParams();
      if (filters?.borough) searchParams.set("borough", filters.borough);
      if (filters?.siteType) searchParams.set("siteType", filters.siteType);
      if (filters?.accessCategory) searchParams.set("accessCategory", filters.accessCategory);
      if (filters?.search) searchParams.set("search", filters.search);

      const url = `${api.parks.list.path}?${searchParams.toString()}`;
      
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch parks");
      
      // We know it returns 200 array based on schema, but we should parse it ideally
      // For performance with large datasets, direct return is sometimes preferred if schema is trusted
      const data = await res.json();
      return api.parks.list.responses[200].parse(data);
    },
  });
}

// Fetch stats
export function useParkStats() {
  return useQuery({
    queryKey: [api.parks.stats.path],
    queryFn: async () => {
      const res = await fetch(api.parks.stats.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch stats");
      return api.parks.stats.responses[200].parse(await res.json());
    },
  });
}

// Fetch filter options (all unique values for dropdowns)
export function useFilterOptions() {
  return useQuery({
    queryKey: [api.parks.filterOptions.path],
    queryFn: async () => {
      const res = await fetch(api.parks.filterOptions.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch filter options");
      return api.parks.filterOptions.responses[200].parse(await res.json());
    },
  });
}

// Create a new park
export function useCreatePark() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: ParkInput) => {
      // Ensure polygon is valid JSON (array of coordinates)
      const res = await fetch(api.parks.create.path, {
        method: api.parks.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create park");
      }
      
      return api.parks.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.parks.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.parks.stats.path] });
      toast({ title: "Success", description: "Park created successfully" });
    },
    onError: (error) => {
      toast({ 
        title: "Error", 
        description: error instanceof Error ? error.message : "Failed to create park",
        variant: "destructive"
      });
    }
  });
}

// Update a park
export function useUpdatePark() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: number } & Partial<ParkInput>) => {
      const url = buildUrl(api.parks.update.path, { id });
      const res = await fetch(url, {
        method: api.parks.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
        credentials: "include",
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to update park");
      }
      
      return api.parks.update.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.parks.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.parks.stats.path] });
      toast({ title: "Updated", description: "Park updated successfully" });
    },
    onError: (error) => {
      toast({ 
        title: "Error", 
        description: error instanceof Error ? error.message : "Failed to update park",
        variant: "destructive"
      });
    }
  });
}

// Toggle completion status (Specialized)
export function useToggleParkComplete() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, completed }: { id: number; completed: boolean }) => {
      const url = buildUrl(api.parks.toggleComplete.path, { id });
      const res = await fetch(url, {
        method: api.parks.toggleComplete.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed }),
        credentials: "include",
      });
      
      if (!res.ok) throw new Error("Failed to update status");
      return api.parks.toggleComplete.responses[200].parse(await res.json());
    },
    onMutate: async ({ id, completed }) => {
      // Optimistic update
      await queryClient.cancelQueries({ queryKey: [api.parks.list.path] });
      const previousParks = queryClient.getQueryData([api.parks.list.path]);

      queryClient.setQueryData([api.parks.list.path], (old: any) => {
        if (!old) return old;
        // This is a rough optimistic update; exact impl depends on if queryKey has filters
        // If we are deep inside a filtered list, this might be tricky, but basic concept holds
        return old.map((park: any) => 
          park.id === id ? { ...park, completed } : park
        );
      });

      return { previousParks };
    },
    onSuccess: (data, variables) => {
      const status = variables.completed ? "completed! 🏆" : "marked incomplete.";
      toast({ 
        title: variables.completed ? "Great job!" : "Status Updated", 
        description: `Park ${status}`,
        variant: variables.completed ? "default" : "secondary"
      });
      queryClient.invalidateQueries({ queryKey: [api.parks.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.parks.stats.path] });
    },
    onError: (err, newTodo, context: any) => {
      queryClient.setQueryData([api.parks.list.path], context.previousParks);
      toast({ 
        title: "Error", 
        description: "Failed to update status",
        variant: "destructive"
      });
    }
  });
}

// Delete park
export function useDeletePark() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: number) => {
      const url = buildUrl(api.parks.delete.path, { id });
      const res = await fetch(url, {
        method: api.parks.delete.method,
        credentials: "include",
      });
      
      if (!res.ok) throw new Error("Failed to delete park");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.parks.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.parks.stats.path] });
      toast({ title: "Deleted", description: "Park removed permanently" });
    },
  });
}
