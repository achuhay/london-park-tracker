import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

interface VerificationResult {
  parkId: number;
  parkName: string;
  recommendation: string;
  confidence: number;
  reasoning: string;
  selectedOsmId?: string;
  alternativesFound: number;
  parkLat?: number;
  parkLng?: number;
  currentPolygon?: [number, number][];
  alternatives?: Array<{
    osmId: string;
    name: string;
    polygon: [number, number][];
    distance: number;
    area: number;
    nameScore: number;
  }>;
}

interface ReviewDecision {
  parkId: number;
  action: "accept" | "reject" | "skip";
  selectedPolygon?: string;
}

export default function ReviewPage() {
  const [results, setResults] = useState<VerificationResult[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [filter, setFilter] = useState<string>("all");
  const [decisions, setDecisions] = useState<Record<number, ReviewDecision>>({});
  const [fileUploaded, setFileUploaded] = useState(false);
  const [selectedPolygon, setSelectedPolygon] = useState<string | null>(null);
  const [notes, setNotes] = useState<string>("");
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result as string);
        setResults(data);
        setFileUploaded(true);
      } catch (err) {
        alert("Error parsing JSON file");
      }
    };
    reader.readAsText(file);
  };

  // Load verification results from API on mount
  useEffect(() => {
    // Fetch parks that have been AI verified (have osmMatchStatus set)
    fetch("/api/parks")
      .then(res => res.json())
      .then((allParks: any[]) => {
        console.log('Loaded parks from API:', allParks.length);
        
        // Debug: Show unique osmMatchStatus values
        const statusCounts: Record<string, number> = {};
        allParks.forEach(park => {
          const status = park.osmMatchStatus || 'null';
          statusCounts[status] = (statusCounts[status] || 0) + 1;
        });
        console.log('osmMatchStatus breakdown:', statusCounts);
        
        // Filter to only parks that have ambiguous status OR have been AI verified
        const verifiedParks = allParks.filter(park => 
          park.osmMatchStatus === 'ambiguous' || // Unverified parks needing review
          park.osmMatchStatus === 'verified' ||
          park.osmMatchStatus === 'verified_alternative' ||
          park.osmMatchStatus === 'manual_review' ||
          park.osmMatchStatus === 'rejected'
        );
        
        console.log('Parks needing review:', verifiedParks.length);
        
        // Transform API data to match VerificationResult format
        const formattedResults = verifiedParks.map((park: any) => {
          const alternatives = Array.isArray(park.alternativePolygons) ? park.alternativePolygons : [];
          const currentPolygon = park.polygon?.coordinates?.[0];
          
          // Determine recommendation based on status
          let recommendation = "manual_review";
          if (park.osmMatchStatus === "verified") recommendation = "confirm";
          if (park.osmMatchStatus === "verified_alternative") recommendation = "alternative_found";
          if (park.osmMatchStatus === "rejected") recommendation = "reject";
          if (park.osmMatchStatus === "ambiguous") recommendation = "manual_review"; // Unverified

          return {
            parkId: park.id,
            parkName: park.name,
            parkLat: park.latitude,
            parkLng: park.longitude,
            currentPolygon,
            alternatives,
            recommendation,
            confidence: 75,
            reasoning: park.adminNotes || (park.osmMatchStatus === "ambiguous" ? "Not yet verified by AI" : "AI verified"),
            selectedOsmId: park.osmId,
            alternativesFound: alternatives.length,
          };
        });
        
        console.log('Formatted results:', formattedResults.length);
        console.log('Breakdown by recommendation:');
        const recCounts: Record<string, number> = {};
        formattedResults.forEach((r: any) => {
          recCounts[r.recommendation] = (recCounts[r.recommendation] || 0) + 1;
        });
        console.log(recCounts);
        
        setResults(formattedResults);
        setFileUploaded(true);
      })
      .catch(err => {
        console.error("Failed to load verification data:", err);
      });
  }, []);

  const filteredResults = results.filter((result) => {
    if (filter === "manual_review") return result.recommendation === "manual_review";
    if (filter === "alternative_found") return result.recommendation === "alternative_found";
    if (filter === "reject") return result.recommendation === "reject";
    if (filter === "medium_confidence") return result.confidence >= 70 && result.confidence < 85;
    return true;
  });

  const currentResult = filteredResults[currentIndex];

  // Reset selection and notes when park changes
  useEffect(() => {
    if (currentResult) {
      // Default to AI's selection if it exists
      setSelectedPolygon(currentResult.selectedOsmId || null);
      setNotes("");
    }
  }, [currentResult]);

  // Initialize map when park data is available
  useEffect(() => {
    if (!mapContainerRef.current || !currentResult) {
      console.log('No container or no park data yet');
      return;
    }
    
    if (mapRef.current) {
      console.log('Map already exists');
      return;
    }

    console.log('Creating map...');
    mapRef.current = L.map(mapContainerRef.current).setView([51.5074, -0.1278], 13);
    console.log('Map created:', mapRef.current);
    
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© OpenStreetMap contributors'
    }).addTo(mapRef.current);

    // Force map to resize after a short delay
    setTimeout(() => {
      mapRef.current?.invalidateSize();
    }, 100);
  }, [currentResult]); // Run when currentResult changes

  // Update map when park changes
  useEffect(() => {
    if (!mapRef.current || !currentResult) return;

    console.log('Updating map with park:', currentResult.parkName);
    console.log('Current polygon exists:', !!currentResult.currentPolygon);
    console.log('Alternatives:', currentResult.alternatives?.length || 0);

    // Clear existing layers
    mapRef.current.eachLayer((layer) => {
      if (layer instanceof L.Polygon || layer instanceof L.Marker) {
        mapRef.current!.removeLayer(layer);
      }
    });

    let allBounds: L.LatLngBounds | null = null;

    // Add park center marker
    if (currentResult.parkLat && currentResult.parkLng) {
      const icon = L.divIcon({
        className: "custom-marker",
        html: `<div style="background: #f59e0b; width: 16px; height: 16px; border-radius: 50%; border: 3px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
        iconSize: [16, 16],
      });
      L.marker([currentResult.parkLat, currentResult.parkLng], { icon })
        .addTo(mapRef.current)
        .bindPopup("<b>Park Center</b>");
    }

    // Add current polygon (red)
    if (currentResult.currentPolygon && currentResult.currentPolygon.length > 0) {
      console.log('Drawing current polygon with', currentResult.currentPolygon.length, 'points');
      const polygon = L.polygon(
        currentResult.currentPolygon.map(([lon, lat]) => [lat, lon]),
        {
          color: "#ef4444",
          weight: 3,
          fillOpacity: 0.2,
        }
      ).addTo(mapRef.current);
      polygon.bindPopup("<b>Current Polygon</b>");
      allBounds = polygon.getBounds();
    }

    // Add alternative polygons (blue for alternatives, green for selected)
    if (currentResult.alternatives && currentResult.alternatives.length > 0) {
      console.log('Drawing alternatives...');
      currentResult.alternatives.forEach((alt, idx) => {
        console.log(`Alt ${idx}:`, alt.name, 'points:', alt.polygon?.length);
        const isSelected = alt.osmId === selectedPolygon;
        const polygon = L.polygon(
          alt.polygon.map(([lon, lat]) => [lat, lon]),
          {
            color: isSelected ? "#10b981" : "#3b82f6",
            weight: isSelected ? 4 : 3,
            fillOpacity: isSelected ? 0.3 : 0.2,
          }
        ).addTo(mapRef.current!);
        
        polygon.bindPopup(`
          <b>${isSelected ? "✓ SELECTED<br>" : ""}Alternative ${idx + 1}</b><br>
          ${alt.name || "Unnamed"}<br>
          Distance: ${alt.distance.toFixed(0)}m
        `);
        
        // Make polygons clickable to select them
        polygon.on('click', (e) => {
          L.DomEvent.stopPropagation(e);
          setSelectedPolygon(alt.osmId);
        });

        // Extend bounds
        if (allBounds) {
          allBounds.extend(polygon.getBounds());
        } else {
          allBounds = polygon.getBounds();
        }
      });
    }

    // Fit map to show everything
    if (allBounds) {
      console.log('Fitting bounds to show all polygons');
      mapRef.current.fitBounds(allBounds, { padding: [50, 50] });
    } else if (currentResult.parkLat && currentResult.parkLng) {
      console.log('No polygons, centering on park location');
      mapRef.current.setView([currentResult.parkLat, currentResult.parkLng], 15);
    }
  }, [currentResult, selectedPolygon]);

  const updateParkMutation = useMutation({
    mutationFn: async (decision: ReviewDecision) => {
      if (decision.action === "accept") {
        const result = results.find(r => r.parkId === decision.parkId);
        if (!result) return;

        const updateData: any = {
          osmMatchStatus: selectedPolygon && selectedPolygon !== result.currentPolygon ? "verified_alternative" : "verified",
        };

        // If a polygon is selected (either AI's or user's choice)
        if (selectedPolygon) {
          const selectedAlt = result.alternatives?.find(a => a.osmId === selectedPolygon);
          if (selectedAlt) {
            updateData.osmId = selectedAlt.osmId;
            updateData.polygon = { type: "Polygon", coordinates: [selectedAlt.polygon] };
          }
        }

        // Save notes if provided
        if (notes.trim()) {
          updateData.adminNotes = notes.trim();
        }

        const response = await fetch(`/api/parks/${decision.parkId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateData),
        });

        if (!response.ok) throw new Error("Failed to update park");
      } else if (decision.action === "reject") {
        // Save notes even on reject
        const updateData: any = { 
          osmMatchStatus: "rejected",
        };
        
        if (notes.trim()) {
          updateData.adminNotes = notes.trim();
        }

        await fetch(`/api/parks/${decision.parkId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateData),
        });
      } else if (decision.action === "skip" && notes.trim()) {
        // Save notes even on skip
        await fetch(`/api/parks/${decision.parkId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adminNotes: notes.trim() }),
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/parks"] });
    },
  });

  const handleDecision = async (action: "accept" | "reject" | "skip") => {
    if (!currentResult) return;

    const decision: ReviewDecision = {
      parkId: currentResult.parkId,
      action,
    };

    setDecisions((prev) => ({ ...prev, [currentResult.parkId]: decision }));

    if (action !== "skip") {
      await updateParkMutation.mutateAsync(decision);
    }

    // Move to next park
    if (currentIndex < filteredResults.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "a") handleDecision("accept");
      if (e.key === "ArrowLeft" || e.key === "r") handleDecision("reject");
      if (e.key === " " || e.key === "s") {
        e.preventDefault();
        handleDecision("skip");
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCurrentIndex(Math.min(currentIndex + 1, filteredResults.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCurrentIndex(Math.max(currentIndex - 1, 0));
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [currentIndex, filteredResults.length, currentResult]);

  const exportDecisions = () => {
    const csv = Object.entries(decisions)
      .map(([parkId, decision]) => {
        const result = results.find((r) => r.parkId === parseInt(parkId));
        return `${parkId},${result?.parkName},${decision.action}`;
      })
      .join("\n");

    const blob = new Blob([`park_id,park_name,decision\n${csv}`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "park-review-decisions.csv";
    a.click();
  };

  if (!fileUploaded) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white p-12 rounded-lg shadow-lg max-w-md text-center">
          <h1 className="text-3xl font-bold mb-4">Park Verification Review</h1>
          <div className="text-gray-600 mb-6">
            {results.length > 0 ? (
              <>
                <div className="text-lg mb-2">Loading verification data...</div>
                <div className="text-sm">Found {results.length} parks</div>
              </>
            ) : (
              <>
                <div className="text-lg mb-2">Loading from database...</div>
                <div className="text-sm">Please wait</div>
              </>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-6">
            Or upload a JSON file manually:
          </div>
          <label className="block mt-2">
            <input
              type="file"
              accept=".json"
              onChange={handleFileUpload}
              className="hidden"
            />
            <div className="bg-gray-200 text-gray-700 px-4 py-2 rounded cursor-pointer hover:bg-gray-300 inline-block text-sm">
              Choose File
            </div>
          </label>
        </div>
      </div>
    );
  }

  if (!currentResult) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-3xl font-bold mb-4">🎉 All parks reviewed!</div>
          <div className="text-gray-600 mb-6">
            Reviewed {Object.keys(decisions).length} parks
          </div>
          <button
            onClick={exportDecisions}
            className="bg-blue-500 text-white px-6 py-3 rounded-lg hover:bg-blue-600"
          >
            Export Decisions
          </button>
        </div>
      </div>
    );
  }

  const progress = Math.round(((currentIndex + 1) / filteredResults.length) * 100);

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      <div className="flex-1 flex flex-col max-w-full px-4 py-3">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-3 mb-3 flex-shrink-0">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-xl font-bold">Park Verification Review</h1>
            <div className="flex gap-2">
              <select
                value={filter}
                onChange={(e) => {
                  setFilter(e.target.value);
                  setCurrentIndex(0);
                }}
                className="border rounded px-2 py-1 text-sm"
              >
                <option value="all">All Parks ({results.length})</option>
                <option value="manual_review">
                  Manual Review ({results.filter((r) => r.recommendation === "manual_review").length})
                </option>
                <option value="alternative_found">
                  Alternatives ({results.filter((r) => r.recommendation === "alternative_found").length})
                </option>
                <option value="reject">
                  Rejected ({results.filter((r) => r.recommendation === "reject").length})
                </option>
                <option value="medium_confidence">
                  Medium Confidence ({results.filter((r) => r.confidence >= 70 && r.confidence < 85).length})
                </option>
              </select>
              <button
                onClick={exportDecisions}
                className="bg-gray-100 px-3 py-1 rounded hover:bg-gray-200 text-sm"
              >
                Export ({Object.keys(decisions).length})
              </button>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="text-xs text-gray-600 mt-1">
            {currentIndex + 1} of {filteredResults.length} ({progress}%)
          </div>
        </div>

        {/* Main Content - Two Column Layout */}
        <div className="flex-1 bg-white rounded-lg shadow-lg overflow-hidden flex min-h-0">
          {/* Left Column - Map */}
          <div className="w-1/2 flex flex-col border-r">
            {/* Park Info Header */}
            <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white p-3 flex-shrink-0">
              <h2 className="text-xl font-bold mb-1">{currentResult.parkName}</h2>
              <div className="flex items-center gap-2 text-xs">
                <span className="bg-white/20 px-2 py-0.5 rounded-full">
                  {currentResult.recommendation.replace("_", " ").toUpperCase()}
                </span>
                <span className="bg-white/20 px-2 py-0.5 rounded-full">
                  {currentResult.confidence}% confidence
                </span>
                <span>{currentResult.alternativesFound} alternatives</span>
              </div>
            </div>

            {/* Map */}
            <div ref={mapContainerRef} className="flex-1" style={{ minHeight: '400px' }} />

            {/* Legend */}
            <div className="p-2 bg-gray-50 border-t flex-shrink-0">
              <div className="flex gap-4 text-xs flex-wrap">
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 rounded-full bg-amber-500 border border-white"></div>
                  <span>Center</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 bg-red-500 opacity-50"></div>
                  <span>Current</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 bg-blue-500 opacity-50"></div>
                  <span>Alternatives</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-3 h-3 bg-green-500 opacity-50"></div>
                  <span>Selected (Click)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - Details */}
          <div className="w-1/2 flex flex-col overflow-y-auto">
            {/* AI Reasoning */}
            <div className="p-3 border-b flex-shrink-0">
              <h3 className="font-bold text-sm mb-1">AI Analysis</h3>
              <p className="text-xs text-gray-700 leading-relaxed">{currentResult.reasoning}</p>

              {currentResult.selectedOsmId && (
                <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded">
                  <div className="font-semibold text-blue-800 text-xs">AI Recommendation:</div>
                  <div className="text-xs text-blue-700">{currentResult.selectedOsmId}</div>
                </div>
              )}
            </div>

            {/* Alternatives Selection */}
            {currentResult.alternatives && currentResult.alternatives.length > 0 && (
              <div className="p-3 border-b flex-shrink-0">
                <h3 className="font-bold text-sm mb-2">Select Polygon:</h3>
                <div className="space-y-1.5">
                  {/* Option to keep current */}
                  <label className="flex items-center gap-2 p-2 border rounded hover:bg-gray-50 cursor-pointer text-xs">
                    <input
                      type="radio"
                      name="polygon-select"
                      checked={selectedPolygon === null}
                      onChange={() => setSelectedPolygon(null)}
                      className="w-3 h-3"
                    />
                    <div className="flex-1">
                      <div className="font-medium">Keep Current</div>
                    </div>
                  </label>

                  {/* Alternative polygons */}
                  {currentResult.alternatives.map((alt, idx) => (
                    <label
                      key={alt.osmId}
                      className={`flex items-center gap-2 p-2 border rounded hover:bg-gray-50 cursor-pointer text-xs ${
                        selectedPolygon === alt.osmId ? "border-green-500 bg-green-50" : ""
                      }`}
                    >
                      <input
                        type="radio"
                        name="polygon-select"
                        checked={selectedPolygon === alt.osmId}
                        onChange={() => setSelectedPolygon(alt.osmId)}
                        className="w-3 h-3"
                      />
                      <div className="flex-1">
                        <div className="font-medium">
                          Alt {idx + 1}: {alt.name || "Unnamed"}
                          {alt.osmId === currentResult.selectedOsmId && (
                            <span className="ml-1 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                              AI
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-600">
                          {alt.distance.toFixed(0)}m • {(alt.nameScore * 100).toFixed(0)}% match
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Notes Section */}
            <div className="p-3 border-b flex-1">
              <h3 className="font-bold text-sm mb-1">Notes</h3>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes about fixes needed, questions, or reminders..."
                className="w-full border rounded p-2 text-xs min-h-[80px] focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* Action Buttons */}
            <div className="p-3 bg-gray-50 border-t flex gap-2 flex-shrink-0">
              <button
                onClick={() => handleDecision("reject")}
                className="flex-1 bg-red-500 text-white py-2 rounded font-bold text-sm hover:bg-red-600 transition"
                disabled={updateParkMutation.isPending}
              >
                Reject
              </button>
              <button
                onClick={() => handleDecision("skip")}
                className="flex-1 bg-gray-300 text-gray-700 py-2 rounded font-bold text-sm hover:bg-gray-400 transition"
              >
                Skip
              </button>
              <button
                onClick={() => handleDecision("accept")}
                className="flex-1 bg-green-500 text-white py-2 rounded font-bold text-sm hover:bg-green-600 transition disabled:opacity-50"
                disabled={updateParkMutation.isPending}
              >
                Accept
              </button>
            </div>
          </div>
        </div>

        {/* Keyboard Shortcuts Help */}
        <div className="mt-2 text-center text-xs text-gray-600 flex-shrink-0">
          <div>A = Accept • R = Reject • Space = Skip • ↑↓ = Navigate</div>
        </div>
      </div>
    </div>
  );
}
