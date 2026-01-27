import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, FileText, AlertCircle } from "lucide-react";
import Papa from "papaparse";
import { useCreatePark } from "@/hooks/use-parks";
import { useToast } from "@/hooks/use-toast";

// Parse numeric value, handling potential issues in CSV
function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  // Remove any non-numeric characters except digits and minus sign
  const cleaned = value.toString().replace(/[^\d-]/g, '');
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? null : num;
}

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
      skipEmptyLines: true,
      complete: async (results) => {
        let successCount = 0;
        let failCount = 0;
        let skippedCount = 0;

        for (const row of results.data as any[]) {
          // Support both old format and new London Parks format
          const name = row["Site Name"] || row.name;
          const borough = row["Borough"] || row.borough;
          
          if (!name || !borough) {
            skippedCount++;
            continue;
          }

          try {
            // Parse easting/northing from the London Parks CSV format
            const easting = parseNumber(row["Grid ref easting"]);
            const northing = parseNumber(row["Grid ref northing"]);
            
            // Map fields from CSV to our schema
            const siteType = row["Type of Site"] || row.site_type || row.siteType || "Park";
            const openToPublic = row["Open to Public"] || row.open_to_public || row.openToPublic || "Yes";
            const address = row["Site Address"] || row.address || null;
            const postcode = row["Postcode"] || row.postcode || null;
            const openingTimes = row["Opening times"] || row.opening_times || null;
            const siteRef = row["Site Ref"] || row.site_ref || null;

            // Parse polygon if available (for backwards compatibility)
            let polygon = null;
            try {
              if (row.polygon) polygon = JSON.parse(row.polygon);
            } catch (e) {
              // Ignore polygon parse errors
            }

            await createPark.mutateAsync({
              name,
              borough,
              siteType,
              openToPublic,
              easting,
              northing,
              address,
              postcode,
              openingTimes,
              siteRef,
              polygon,
            });
            successCount++;
          } catch (error: any) {
            // Check if it's a duplicate error (expected for already-imported parks)
            if (error?.message?.includes("duplicate") || error?.message?.includes("already exists")) {
              skippedCount++;
            } else {
              console.error("Failed to import row", row, error);
              failCount++;
            }
          }
        }

        const message = `Imported ${successCount} parks.${skippedCount > 0 ? ` Skipped ${skippedCount} (duplicates/invalid).` : ''}${failCount > 0 ? ` Failed: ${failCount}.` : ''}`;
        
        toast({
          title: "Import Complete",
          description: message,
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
        <p>Supports London Parks CSV format with Grid ref easting/northing columns</p>
      </div>
    </div>
  );
}
