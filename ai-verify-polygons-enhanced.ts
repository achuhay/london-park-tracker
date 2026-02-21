import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "./server/db.js";
import { parks } from "./shared/schema.js";
import { eq, inArray } from "drizzle-orm";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

/**
 * Get Gardens Trust info from database (pre-fetched)
 * No HTTP requests - data is already stored in parks.gardensTrustInfo
 */
function getGardensTrustInfo(park: Park): string | null {
  return park.gardensTrustInfo || null;
}


interface Park {
  id: number;
  name: string;
  borough: string;
  siteType: string;
  osmId: string | null;
  osmMatchScore: number | null;
  osmMatchStatus: string | null;
  wikidataVerified: boolean | null;
  wikidataScore: number | null;
  wikidataId: string | null;
  latitude: number | null;
  longitude: number | null;
  polygon: any;
  alternativePolygons: any;
}

interface OverpassPolygon {
  osmId: string;
  name: string;
  type: string;
  tags: Record<string, string>;
  polygon: [number, number][];
  area: number;
  center: [number, number];
  distance: number;
}

interface VerificationResult {
  parkId: number;
  parkName: string;
  recommendation: "confirm" | "reject" | "manual_review" | "alternative_found";
  confidence: number;
  reasoning: string;
  selectedOsmId?: string;
  selectedPolygon?: [number, number][];
  alternativesFound: number;
}

/**
 * Query Overpass API for park-like polygons near the given coordinates
 */
async function findAlternativePolygons(
  lat: number,
  lon: number,
  radiusMeters: number = 500
): Promise<OverpassPolygon[]> {
  // Overpass query to find parks, gardens, and green spaces
  const query = `
    [out:json][timeout:25];
    (
      way["leisure"="park"](around:${radiusMeters},${lat},${lon});
      way["leisure"="garden"](around:${radiusMeters},${lat},${lon});
      way["leisure"="nature_reserve"](around:${radiusMeters},${lat},${lon});
      way["landuse"="recreation_ground"](around:${radiusMeters},${lat},${lon});
      way["landuse"="village_green"](around:${radiusMeters},${lat},${lon});
      relation["leisure"="park"](around:${radiusMeters},${lat},${lon});
      relation["leisure"="garden"](around:${radiusMeters},${lat},${lon});
    );
    out geom;
  `;

  try {
    const response = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: query,
    });

    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.statusText}`);
    }

    const data = await response.json();
    const polygons: OverpassPolygon[] = [];

    for (const element of data.elements) {
      let coords: [number, number][] = [];
      let elementType = "";

      if (element.type === "way" && element.geometry) {
        elementType = "way";
        coords = element.geometry.map((node: any) => [node.lon, node.lat]);
      } else if (element.type === "relation" && element.members) {
        elementType = "relation";
        // For relations, extract outer way coordinates
        for (const member of element.members) {
          if (member.role === "outer" && member.geometry) {
            coords = coords.concat(member.geometry.map((node: any) => [node.lon, node.lat]));
          }
        }
      }

      if (coords.length > 0) {
        // Calculate polygon center
        const lats = coords.map((c) => c[1]);
        const lons = coords.map((c) => c[0]);
        const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
        const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;

        // Calculate distance from search point
        const distance = calculateDistance(lat, lon, centerLat, centerLon);

        // Estimate area (rough calculation)
        const area = estimatePolygonArea(coords);

        polygons.push({
          osmId: `${elementType}/${element.id}`,
          name: element.tags?.name || "Unnamed",
          type: element.tags?.leisure || element.tags?.landuse || "unknown",
          tags: element.tags || {},
          polygon: coords,
          area,
          center: [centerLon, centerLat],
          distance,
        });
      }
    }

    // Sort by distance (closest first)
    return polygons.sort((a, b) => a.distance - b.distance).slice(0, 5); // Max 5 alternatives
  } catch (error) {
    console.error("Error querying Overpass API:", error);
    return [];
  }
}

/**
 * Calculate distance between two coordinates in meters (Haversine formula)
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Estimate polygon area (simplified calculation)
 */
function estimatePolygonArea(coords: [number, number][]): number {
  let area = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    area += coords[i][0] * coords[i + 1][1] - coords[i + 1][0] * coords[i][1];
  }
  return Math.abs(area / 2);
}

/**
 * Calculate name similarity score (simple Levenshtein-based)
 */
function calculateNameSimilarity(name1: string, name2: string): number {
  const s1 = name1.toLowerCase().trim();
  const s2 = name2.toLowerCase().trim();

  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) return 0.8;

  // Simple character overlap score
  const chars1 = new Set(s1.split(""));
  const chars2 = new Set(s2.split(""));
  const intersection = new Set([...chars1].filter((x) => chars2.has(x)));
  const union = new Set([...chars1, ...chars2]);

  return intersection.size / union.size;
}

async function verifyParkWithAlternatives(park: Park): Promise<VerificationResult> {
  // If no coordinates, can't search for alternatives
  if (!park.latitude || !park.longitude) {
    return {
      parkId: park.id,
      parkName: park.name,
      recommendation: "manual_review",
      confidence: 0,
      reasoning: "No coordinates available for this park, cannot search for alternatives",
      alternativesFound: 0,
    };
  }

  // Get Gardens Trust context from database (pre-fetched)
  let gardensTrustContext = '';
  const gardensTrustInfo = getGardensTrustInfo(park);
  if (gardensTrustInfo) {
    gardensTrustContext = `\n\nADDITIONAL CONTEXT from London Gardens Trust inventory:\n${gardensTrustInfo}`;
    console.log(`  ✓ Using Gardens Trust data from database`);
  }

  console.log(`  → Searching for alternative polygons...`);

  // Find alternative polygons via Overpass API (1000m radius for better coverage)
  const alternatives = await findAlternativePolygons(park.latitude, park.longitude, 1000);

  console.log(`  → Found ${alternatives.length} alternative polygons`);

  // Calculate name similarity scores for alternatives
  const alternativesWithScores = alternatives.map((alt) => ({
    ...alt,
    nameScore: calculateNameSimilarity(park.name, alt.name),
  }));

  // Build context for Claude
  const currentPolygonInfo = park.polygon
    ? `Current matched polygon: ${park.osmId} (OSM score: ${park.osmMatchScore})`
    : `No current polygon`;

  const alternativesInfo = alternativesWithScores
    .map(
      (alt, idx) =>
        `${idx + 1}. OSM ID: ${alt.osmId}
   Name: "${alt.name}" (similarity: ${(alt.nameScore * 100).toFixed(0)}%)
   Type: ${alt.type}
   Distance: ${alt.distance.toFixed(0)}m from park center
   Area: ${alt.area.toFixed(0)} units
   Tags: ${JSON.stringify(alt.tags)}`
    )
    .join("\n\n");

  const prompt = `You are analyzing park polygon matches from OpenStreetMap data. Your task is to determine the BEST polygon match for this park from all available options.

PARK DETAILS:
- Name: ${park.name}
- Borough: ${park.borough}
- Type: ${park.siteType}
- Location: ${park.latitude}, ${park.longitude}
${gardensTrustContext}

CURRENT MATCH:
${currentPolygonInfo}
- Wikidata Verified: ${park.wikidataVerified ? "Yes" : "No"}
- Wikidata Score: ${park.wikidataScore || "N/A"}

ALTERNATIVE POLYGONS FOUND (within 500m):
${alternativesInfo || "No alternatives found"}

POLYGON SELECTION RULES (CRITICAL - FOLLOW THESE):

1. SIZE & SCOPE PRIORITY:
   - For large parks (>10 hectares), ALWAYS prefer the LARGEST comprehensive polygon
   - Major London parks (Hampstead Heath, Richmond Park, Bushy Park, Hyde Park, Regent's Park, Greenwich Park, etc.) must be single unified polygons
   - Reject smaller subset polygons (specific features, ponds, sections within parks)
   - The polygon should represent the FULL extent of the park as a complete entity

2. COMMONS & HEATHS:
   - Clapham Common, Tooting Common, Wandsworth Common, etc. should be complete unified areas
   - Never accept fragmented sections

3. NAME MATCHING:
   - Ignore "The" prefix ("The Regent's Park" = "Regent's Park")
   - Match with/without apostrophes ("St James's" = "St James")
   - "X Square" matches "X Square Gardens"
   - Exact park name match, not street names containing the word (e.g., "Hampstead Heath" ≠ "Heath Street")

4. PARK TYPE VALIDATION:
   - Public Parks → expect large unified areas
   - Private Gardens → small single polygons acceptable
   - Churchyards → small bounded areas
   - Large cemeteries (Highgate, Kensal Green) → full areas
   - Nature Reserves → prefer unified but fragmented OK if necessary

5. OSM TAG PREFERENCES:
   - Prefer leisure=park for major parks
   - Accept landuse=recreation_ground for appropriate cases
   - Reject polygons tagged as buildings, parking, sports pitches

6. POLYGON QUALITY:
   - Must be closed polygon (complete boundary)
   - Linear parks (canal paths, riverside) can be long/thin - that's OK
   - Don't reject based on unusual aspect ratios for linear parks

7. DUPLICATE DETECTION:
   - If current and alternative have >80% geographic overlap, they're the same park
   - Choose the one with better name match

ANALYSIS TASK:
Compare ALL polygons (current + alternatives) and determine:

1. Which polygon is the BEST match for "${park.name}"? Apply ALL rules above. Consider:
   - Name similarity (exact match preferred, apply name rules)
   - Polygon size (prefer largest comprehensive area for major parks)
   - Geographic proximity
   - Park type appropriateness
   - OSM tag quality
   - Boundary completeness
   - Wikidata verification (if available)

2. Provide a recommendation:
   - "confirm": The current polygon is correct (>80% certain)
   - "alternative_found": One of the alternatives is better (specify which OSM ID)
   - "reject": ONLY if NO alternatives exist AND current is clearly wrong
   - "manual_review": Uncertain, requires human verification

IMPORTANT: If alternatives exist and current polygon seems wrong, you MUST choose "alternative_found" 
with the best alternative. Do NOT use "reject" when alternatives are available - always pick the 
best available option instead.

3. Provide a confidence score (0-100)

4. Explain your reasoning briefly

Respond ONLY with a JSON object in this exact format (no markdown, no extra text):
{
  "recommendation": "confirm|alternative_found|reject|manual_review",
  "confidence": 85,
  "reasoning": "Brief explanation",
  "selectedOsmId": "way/12345 or relation/67890 (only if recommendation is confirm or alternative_found)"
}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const responseText = message.content[0].type === "text" ? message.content[0].text : "";

    // Strip markdown code blocks if present
    const cleanedText = responseText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const result = JSON.parse(cleanedText);

    // Find the selected polygon if an alternative was chosen
    let selectedPolygon: [number, number][] | undefined;
    if (result.recommendation === "alternative_found" && result.selectedOsmId) {
      const selected = alternativesWithScores.find((alt) => alt.osmId === result.selectedOsmId);
      if (selected) {
        selectedPolygon = selected.polygon;
      }
    }

    // Store alternatives in database
    const alternativesForDb = alternativesWithScores.map((alt) => ({
      osmId: alt.osmId,
      name: alt.name,
      type: alt.type,
      polygon: alt.polygon,
      area: alt.area,
      nameScore: alt.nameScore,
      distance: alt.distance,
    }));

    await db
      .update(parks)
      .set({ alternativePolygons: alternativesForDb })
      .where(eq(parks.id, park.id));

    return {
      parkId: park.id,
      parkName: park.name,
      recommendation: result.recommendation,
      confidence: result.confidence,
      reasoning: result.reasoning,
      selectedOsmId: result.selectedOsmId,
      selectedPolygon,
      alternativesFound: alternatives.length,
    };
  } catch (error) {
    console.error(`Error verifying park ${park.id} (${park.name}):`, error);
    return {
      parkId: park.id,
      parkName: park.name,
      recommendation: "manual_review",
      confidence: 0,
      reasoning: `Error during AI verification: ${error instanceof Error ? error.message : "Unknown error"}`,
      alternativesFound: alternatives.length,
    };
  }
}

async function main() {
  console.log("🤖 Enhanced AI Polygon Verification Script (with Overpass Search)");
  console.log("================================================================\n");

  // TEST MODE - Set to true for testing, false for full run
  const TEST_MODE = false;
  const TEST_SAMPLE_SIZE = 20; // Increased sample size
  
  // AUTO UPDATE - Set to true to update database automatically
  const AUTO_UPDATE = true;
  
  // CONFIDENCE THRESHOLDS
  const CONFIRM_THRESHOLD = 85; // Auto-confirm if ≥85%
  const ALTERNATIVE_THRESHOLD = 70; // Accept alternatives if ≥70%
  const REJECT_THRESHOLD = 90; // Auto-reject if ≥90%

  if (TEST_MODE) {
    console.log("⚠️  TEST MODE ENABLED - Running on sample only\n");
  }

  // Fetch ONLY old ambiguous parks (exclude new imports)
  const allAmbiguous = await db
    .select()
    .from(parks)
    .where(
      inArray(parks.osmMatchStatus, ["ambiguous", "ambiguous_new"] as any)
    );

  // Filter out new imports
  let ambiguousParks = allAmbiguous.filter(
    p => p.siteRef !== 'OSM_IMPORT' && p.siteRef !== 'OSM_IMPORT_MANUAL'
  );

  // Filter to only include parks open to public
  const ALLOWED_ACCESS = ['Yes', 'Partially', 'Occasionally'];
  
  const beforeFilter = ambiguousParks.length;
  ambiguousParks = ambiguousParks.filter(
    p => ALLOWED_ACCESS.includes(p.openToPublic)
  );
  const excluded = beforeFilter - ambiguousParks.length;

  // In test mode, take only a small sample
  if (TEST_MODE) {
    ambiguousParks = ambiguousParks.slice(0, TEST_SAMPLE_SIZE);
  }

  console.log(`Found ${allAmbiguous.length} total ambiguous parks`);
  if (TEST_MODE) {
    console.log(`  - Running TEST on ${ambiguousParks.length} sample parks`);
  } else {
    console.log(`  - ${ambiguousParks.length} old ambiguous parks (will verify)`);
  }
  console.log(`  - ${excluded} excluded (not publicly accessible)`);
  console.log(`  - ${allAmbiguous.filter(p => p.siteRef === 'OSM_IMPORT' || p.siteRef === 'OSM_IMPORT_MANUAL').length} newly imported parks (skipping for now)\n`);

  if (ambiguousParks.length === 0) {
    console.log("✅ No ambiguous parks found!");
    return;
  }

  console.log("This will:");
  console.log("1. Search Overpass API for alternative polygons (FREE)");
  console.log("2. Use Anthropic API to compare and verify (PAID)");
  console.log(`Estimated cost: $${(ambiguousParks.length * 0.003).toFixed(2)}`);
  
  if (TEST_MODE) {
    console.log(`\n🧪 TEST MODE: Verifying ${ambiguousParks.length} sample parks`);
    console.log(`   Set TEST_MODE = false to run on all ${allAmbiguous.filter(p => p.siteRef !== 'OSM_IMPORT' && p.siteRef !== 'OSM_IMPORT_MANUAL').length} old parks\n`);
  } else {
    console.log(`\nNote: Verifying ${ambiguousParks.length} OLD ambiguous parks only`);
    console.log(`      Skipping ${allAmbiguous.filter(p => p.siteRef === 'OSM_IMPORT' || p.siteRef === 'OSM_IMPORT_MANUAL').length} newly imported parks for now\n`);
  }

  // MODE: Change this to control behavior
  const MODE: "test" | "batch" | "cancel" = "batch";

  if (MODE === "cancel") {
    console.log("❌ Cancelled");
    return;
  }

  const parksToReview = MODE === "test" ? ambiguousParks.slice(0, TEST_SAMPLE_SIZE) : ambiguousParks;
  console.log(`\n📊 Reviewing ${parksToReview.length} parks...\n`);

  const results: VerificationResult[] = [];

  for (let i = 0; i < parksToReview.length; i++) {
    const park = parksToReview[i];
    console.log(`[${i + 1}/${parksToReview.length}] Analyzing: ${park.name} (${park.borough})`);

    const result = await verifyParkWithAlternatives(park);
    results.push(result);

    const emoji =
      result.recommendation === "confirm"
        ? "✅"
        : result.recommendation === "alternative_found"
          ? "🔄"
          : result.recommendation === "reject"
            ? "❌"
            : "🤔";

    console.log(
      `  ${emoji} ${result.recommendation.toUpperCase()} (${result.confidence}% confidence)`
    );
    console.log(`  → ${result.reasoning}`);
    if (result.selectedOsmId) {
      console.log(`  → Selected polygon: ${result.selectedOsmId}`);
    }
    console.log();

    // Auto-update database if enabled
    if (AUTO_UPDATE) {
      if (result.recommendation === "confirm" && result.confidence >= 85) {
        await db.update(parks).set({ osmMatchStatus: "verified" }).where(eq(parks.id, park.id));
        console.log(`  ✅ Auto-confirmed in database\n`);
      } else if (
        result.recommendation === "alternative_found" &&
        result.confidence >= 85 &&
        result.selectedOsmId &&
        result.selectedPolygon
      ) {
        await db
          .update(parks)
          .set({
            osmId: result.selectedOsmId,
            polygon: result.selectedPolygon,
            osmMatchStatus: "verified",
            osmMatchScore: 1.0,
          })
          .where(eq(parks.id, park.id));
        console.log(`  🔄 Auto-updated to alternative polygon in database\n`);
      } else if (result.recommendation === "reject" && result.confidence >= 90) {
        await db
          .update(parks)
          .set({
            osmMatchStatus: "no_match",
            polygon: null,
            osmId: null,
          })
          .where(eq(parks.id, park.id));
        console.log(`  ❌ Auto-rejected in database\n`);
      }
    }

    // Rate limiting: wait 2 seconds between requests (Overpass API + Anthropic API)
    if (i < parksToReview.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("📈 SUMMARY");
  console.log("=".repeat(60));

  const confirmCount = results.filter((r) => r.recommendation === "confirm").length;
  const alternativeCount = results.filter((r) => r.recommendation === "alternative_found").length;
  const rejectCount = results.filter((r) => r.recommendation === "reject").length;
  const manualCount = results.filter((r) => r.recommendation === "manual_review").length;

  console.log(`Total reviewed: ${results.length}`);
  console.log(
    `Confirm current: ${confirmCount} (${((confirmCount / results.length) * 100).toFixed(1)}%)`
  );
  console.log(
    `Alternative found: ${alternativeCount} (${((alternativeCount / results.length) * 100).toFixed(1)}%)`
  );
  console.log(`Reject: ${rejectCount} (${((rejectCount / results.length) * 100).toFixed(1)}%)`);
  console.log(
    `Manual review: ${manualCount} (${((manualCount / results.length) * 100).toFixed(1)}%)`
  );

  const avgAlternatives =
    results.reduce((sum, r) => sum + r.alternativesFound, 0) / results.length;
  console.log(`\nAverage alternatives found per park: ${avgAlternatives.toFixed(1)}`);

  // Categorize manual review reasons
  if (manualCount > 0) {
    console.log(`\n📋 Manual Review Breakdown (${manualCount} parks):`);
    
    const manualReviews = results.filter(r => r.recommendation === "manual_review");
    
    // Categorize by common issues
    const reasons = {
      noAlternatives: manualReviews.filter(r => r.alternativesFound === 0).length,
      lowNameSimilarity: manualReviews.filter(r => 
        r.reasoning.toLowerCase().includes('name') && 
        (r.reasoning.toLowerCase().includes('mismatch') || r.reasoning.toLowerCase().includes('similarity'))
      ).length,
      typeMismatch: manualReviews.filter(r => 
        r.reasoning.toLowerCase().includes('type') && 
        r.reasoning.toLowerCase().includes('mismatch')
      ).length,
      tooDistant: manualReviews.filter(r => 
        r.reasoning.toLowerCase().includes('distance') || 
        r.reasoning.toLowerCase().includes('distant') ||
        r.reasoning.toLowerCase().includes('away')
      ).length,
      lowOsmScore: manualReviews.filter(r => 
        r.reasoning.toLowerCase().includes('osm score of 0') ||
        r.reasoning.toLowerCase().includes('poor confidence')
      ).length,
      unmappedInOsm: manualReviews.filter(r =>
        r.reasoning.toLowerCase().includes('unmapped') ||
        r.reasoning.toLowerCase().includes('not exist in osm') ||
        r.reasoning.toLowerCase().includes('missing from osm')
      ).length,
    };
    
    console.log(`  - No alternatives found: ${reasons.noAlternatives}`);
    console.log(`  - Low name similarity: ${reasons.lowNameSimilarity}`);
    console.log(`  - Type mismatch: ${reasons.typeMismatch}`);
    console.log(`  - Too distant from center: ${reasons.tooDistant}`);
    console.log(`  - Low OSM score (0): ${reasons.lowOsmScore}`);
    console.log(`  - Possibly unmapped in OSM: ${reasons.unmappedInOsm}`);
  }

  // High confidence actions
  const highConfidenceConfirms = results.filter(
    (r) => r.recommendation === "confirm" && r.confidence >= 85
  );
  const highConfidenceAlternatives = results.filter(
    (r) => r.recommendation === "alternative_found" && r.confidence >= 85
  );
  const highConfidenceRejects = results.filter(
    (r) => r.recommendation === "reject" && r.confidence >= 90
  );

  console.log(`\nHigh confidence confirmations (≥85%): ${highConfidenceConfirms.length}`);
  console.log(`High confidence alternatives (≥85%): ${highConfidenceAlternatives.length}`);
  console.log(`High confidence rejects (≥90%): ${highConfidenceRejects.length}`);

  if (AUTO_UPDATE) {
    const totalUpdated =
      highConfidenceConfirms.length + highConfidenceAlternatives.length + highConfidenceRejects.length;
    console.log(`\n✅ Database updated for ${totalUpdated} high-confidence results`);
  } else {
    console.log(`\n💡 Set AUTO_UPDATE=true in script to automatically update database`);
  }

  // Export results to JSON
  const fs = await import("fs");
  const outputPath = "./ai-verification-enhanced-results.json";
  await fs.promises.writeFile(outputPath, JSON.stringify(results, null, 2));
  console.log(`\n📄 Full results exported to: ${outputPath}`);
}

main().catch(console.error);
