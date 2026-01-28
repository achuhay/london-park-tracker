import { Filter, X, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

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
  uniqueAccessOptions: string[];
}

function MultiSelectFilter({ 
  label, 
  options, 
  selectedValues, 
  onChange,
  placeholder 
}: { 
  label: string;
  options: string[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const toggleValue = (value: string) => {
    if (selectedValues.includes(value)) {
      onChange(selectedValues.filter(v => v !== value));
    } else {
      onChange([...selectedValues, value]);
    }
  };

  const clearAll = () => onChange([]);

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <Popover>
        <PopoverTrigger asChild>
          <Button 
            variant="outline" 
            className="w-full h-9 justify-between bg-background/50 font-normal"
            data-testid={`filter-${label.toLowerCase().replace(' ', '-')}`}
          >
            <span className="truncate">
              {selectedValues.length === 0 
                ? placeholder 
                : selectedValues.length === 1 
                  ? selectedValues[0]
                  : `${selectedValues.length} selected`}
            </span>
            <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[220px] p-0" align="start">
          <div className="max-h-[280px] overflow-y-auto">
            <div className="p-2 space-y-1">
              {options.map((option) => (
                <div 
                  key={option}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer"
                  onClick={() => toggleValue(option)}
                >
                  <Checkbox 
                    checked={selectedValues.includes(option)}
                    onClick={(e) => e.stopPropagation()}
                    onCheckedChange={() => toggleValue(option)}
                    id={`${label}-${option}`}
                  />
                  <span className="text-sm flex-1">
                    {option}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {selectedValues.length > 0 && (
            <div className="border-t p-2">
              <Button 
                variant="ghost" 
                size="sm" 
                className="w-full h-7 text-xs"
                onClick={clearAll}
              >
                Clear all
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function ParkFilter({ filters, setFilters, uniqueBoroughs, uniqueTypes, uniqueAccessOptions }: ParkFilterProps) {
  const selectedBoroughs = filters.borough ? filters.borough.split(',').filter(Boolean) : [];
  const selectedTypes = filters.siteType ? filters.siteType.split(',').filter(Boolean) : [];
  const selectedAccess = filters.openToPublic ? filters.openToPublic.split(',').filter(Boolean) : [];

  const handleMultiSelectChange = (key: string, values: string[]) => {
    setFilters((prev: any) => ({ 
      ...prev, 
      [key]: values.length > 0 ? values.join(',') : undefined 
    }));
  };

  const handleSearchChange = (value: string) => {
    setFilters((prev: any) => ({ ...prev, search: value || undefined }));
  };

  const clearFilters = () => {
    setFilters({});
  };

  const hasActiveFilters = selectedBoroughs.length > 0 || selectedTypes.length > 0 || selectedAccess.length > 0 || filters.search;

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
            onChange={(e) => handleSearchChange(e.target.value)}
            className="h-9 bg-background/50"
            data-testid="input-search"
          />
        </div>

        <MultiSelectFilter
          label="Borough"
          options={uniqueBoroughs}
          selectedValues={selectedBoroughs}
          onChange={(values) => handleMultiSelectChange('borough', values)}
          placeholder="All Boroughs"
        />

        <MultiSelectFilter
          label="Type"
          options={uniqueTypes}
          selectedValues={selectedTypes}
          onChange={(values) => handleMultiSelectChange('siteType', values)}
          placeholder="All Types"
        />

        <MultiSelectFilter
          label="Access"
          options={uniqueAccessOptions}
          selectedValues={selectedAccess}
          onChange={(values) => handleMultiSelectChange('openToPublic', values)}
          placeholder="Any Access"
        />
        
        {hasActiveFilters && (
          <Button 
            variant="outline" 
            size="sm" 
            onClick={clearFilters} 
            className="w-full h-8 text-xs"
            data-testid="button-clear-filters"
          >
            <X className="w-3 h-3 mr-1" />
            Clear Filters
          </Button>
        )}
      </div>
    </div>
  );
}
