import { Filter } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface ParkFilterProps {
  filters: {
    borough?: string;
    siteType?: string;
    openToPublic?: string;
    search?: string;
  };
  setFilters: (newFilters: any) => void;
  uniqueBoroughs: string[];
  uniqueTypes: string[];
}

export function ParkFilter({ filters, setFilters, uniqueBoroughs, uniqueTypes }: ParkFilterProps) {
  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev: any) => ({ ...prev, [key]: value === "all" ? undefined : value }));
  };

  const clearFilters = () => {
    setFilters({});
  };

  return (
    <div className="bg-card rounded-2xl border border-border shadow-sm p-4 space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground pb-2 border-b border-border/50">
        <Filter className="w-4 h-4 text-primary" />
        Filters
      </div>

      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Search</label>
          <Input 
            placeholder="Search parks..." 
            value={filters.search || ""}
            onChange={(e) => handleFilterChange("search", e.target.value)}
            className="h-9 bg-background/50"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Borough</label>
          <Select value={filters.borough || "all"} onValueChange={(val) => handleFilterChange("borough", val)}>
            <SelectTrigger className="h-9 bg-background/50">
              <SelectValue placeholder="All Boroughs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Boroughs</SelectItem>
              {uniqueBoroughs.map((b) => (
                <SelectItem key={b} value={b}>{b}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Type</label>
          <Select value={filters.siteType || "all"} onValueChange={(val) => handleFilterChange("siteType", val)}>
            <SelectTrigger className="h-9 bg-background/50">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {uniqueTypes.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Access</label>
          <Select value={filters.openToPublic || "all"} onValueChange={(val) => handleFilterChange("openToPublic", val)}>
            <SelectTrigger className="h-9 bg-background/50">
              <SelectValue placeholder="Any Access" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any Access</SelectItem>
              <SelectItem value="Yes">Public</SelectItem>
              <SelectItem value="No">Private</SelectItem>
              <SelectItem value="Occasionally">Occasionally</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        {(filters.borough || filters.siteType || filters.openToPublic || filters.search) && (
          <Button variant="outline" size="sm" onClick={clearFilters} className="w-full h-8 text-xs">
            Clear Filters
          </Button>
        )}
      </div>
    </div>
  );
}
