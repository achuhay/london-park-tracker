import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, FileText, AlertCircle } from "lucide-react";
import Papa from "papaparse";
import { useCreatePark } from "@/hooks/use-parks";
import { useToast } from "@/hooks/use-toast";

export function CsvImporter() {
  const [isProcessing, setIsProcessing] = useState(false);
  const createPark = useCreatePark();
  const { toast } = useToast();

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);

    Papa.parse(file, {
      header: true,
      complete: async (results) => {
        let successCount = 0;
        let failCount = 0;

        // Process sequentially to avoid overwhelming server, or could use Promise.all for speed
        for (const row of results.data as any[]) {
          if (!row.name || !row.borough) continue; // Skip invalid rows

          try {
            // Very basic parsing logic - expects fields to match schema or be close
            // This assumes polygon comes in as a string we need to parse, or empty array default
            let polygon = [];
            try {
              if (row.polygon) polygon = JSON.parse(row.polygon);
            } catch (e) {
              // Ignore polygon parse errors, leave empty
            }

            await createPark.mutateAsync({
              name: row.name,
              borough: row.borough,
              siteType: row.site_type || row.siteType || "Park",
              openToPublic: row.open_to_public || row.openToPublic || "Yes",
              polygon: polygon,
            });
            successCount++;
          } catch (error) {
            console.error("Failed to import row", row, error);
            failCount++;
          }
        }

        toast({
          title: "Import Complete",
          description: `Imported ${successCount} parks. Failed: ${failCount}`,
          variant: failCount > 0 ? "destructive" : "default",
        });
        setIsProcessing(false);
      },
      error: (error) => {
        console.error("CSV Error", error);
        toast({ title: "CSV Error", description: error.message, variant: "destructive" });
        setIsProcessing(false);
      }
    });
  };

  return (
    <div className="bg-card rounded-xl border border-border p-4 shadow-sm">
      <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
        <Upload className="w-4 h-4 text-primary" />
        Bulk Import
      </h3>
      
      <div className="relative">
        <input
          type="file"
          accept=".csv"
          onChange={handleFileUpload}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          disabled={isProcessing}
        />
        <div className="border-2 border-dashed border-border rounded-lg p-6 flex flex-col items-center justify-center text-center hover:bg-muted/50 transition-colors">
          <FileText className="w-8 h-8 text-muted-foreground mb-2" />
          <span className="text-sm font-medium text-foreground">
            {isProcessing ? "Importing..." : "Click to upload CSV"}
          </span>
          <span className="text-xs text-muted-foreground mt-1">
            Headers: name, borough, site_type, open_to_public, polygon
          </span>
        </div>
      </div>
      
      <div className="mt-3 text-xs text-muted-foreground bg-muted/50 p-2 rounded flex gap-2">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <p>Polygon field expects JSON array of coordinates: [[lat, lng], ...]</p>
      </div>
    </div>
  );
}
