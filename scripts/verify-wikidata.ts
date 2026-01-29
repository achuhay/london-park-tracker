import { db } from "../server/db";
import { parks } from "../shared/schema";
import { eq, isNotNull, sql } from "drizzle-orm";

interface WikidataPark {
  item: string;
  itemLabel: string;
  coord: string;
  lat: number;
  lng: number;
}

async function fetchWikidataParks(): Promise<WikidataPark[]> {
  const sparqlQuery = `
    SELECT ?item ?itemLabel ?coord WHERE {
      ?item wdt:P31/wdt:P279* wd:Q22698.  # instance of park or subclass
      ?item wdt:P131* wd:Q84.              # located in London
      ?item wdt:P625 ?coord.               # has coordinates
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 5000
  `;

  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparqlQuery)}&format=json`;
  
  console.log("Fetching parks from Wikidata...");
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'ParkRunLDN/1.0 (https://replit.com)',
      'Accept': 'application/sparql-results+json'
    }
  });

  if (!response.ok) {
    throw new Error(`Wikidata query failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const results: WikidataPark[] = [];

  for (const binding of data.results.bindings) {
    const coordStr = binding.coord?.value || '';
    const match = coordStr.match(/Point\(([-\d.]+)\s+([-\d.]+)\)/);
    
    if (match) {
      results.push({
        item: binding.item.value,
        itemLabel: binding.itemLabel?.value || '',
        coord: coordStr,
        lng: parseFloat(match[1]),
        lat: parseFloat(match[2])
      });
    }
  }

  console.log(`Found ${results.length} parks in Wikidata`);
  return results;
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lng2 - lng1) * Math.PI / 180;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function normalizeForComparison(name: string): string {
  return name
    .toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\bpark\b/gi, '')
    .replace(/\bgardens?\b/gi, '')
    .replace(/\bcommon\b/gi, '')
    .replace(/\bgreen\b/gi, '')
    .replace(/\bwood\b/gi, '')
    .replace(/\bhealth?\b/gi, '')
    .replace(/\bopen\s*space\b/gi, '')
    .replace(/\brecreation\s*ground\b/gi, '')
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

function calculateNameSimilarity(name1: string, name2: string): number {
  const n1 = normalizeForComparison(name1);
  const n2 = normalizeForComparison(name2);
  
  if (n1 === n2) return 1.0;
  if (n1.includes(n2) || n2.includes(n1)) return 0.8;
  
  const words1 = new Set(n1.match(/[a-z]+/g) || []);
  const words2 = new Set(n2.match(/[a-z]+/g) || []);
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  let matches = 0;
  for (const word of words1) {
    if (words2.has(word)) matches++;
  }
  
  return matches / Math.max(words1.size, words2.size);
}

async function verifyParksWithWikidata() {
  console.log("Starting Wikidata verification...\n");
  
  const wikidataParks = await fetchWikidataParks();
  
  const allParks = await db.select().from(parks).where(
    isNotNull(parks.latitude)
  );
  
  console.log(`Verifying ${allParks.length} parks against Wikidata...\n`);
  
  let verified = 0;
  let improved = 0;
  let noMatch = 0;
  
  for (const park of allParks) {
    if (!park.latitude || !park.longitude) continue;
    
    let bestMatch: WikidataPark | null = null;
    let bestScore = 0;
    let bestDistance = Infinity;
    
    for (const wdPark of wikidataParks) {
      const distance = haversineDistance(
        park.latitude, park.longitude,
        wdPark.lat, wdPark.lng
      );
      
      if (distance > 500) continue;
      
      const nameSimilarity = calculateNameSimilarity(park.name, wdPark.itemLabel);
      const distanceScore = Math.max(0, 1 - distance / 500);
      const combinedScore = nameSimilarity * 0.7 + distanceScore * 0.3;
      
      if (combinedScore > bestScore) {
        bestScore = combinedScore;
        bestMatch = wdPark;
        bestDistance = distance;
      }
    }
    
    if (bestMatch && bestScore >= 0.5) {
      const wikidataId = bestMatch.item.split('/').pop();
      
      await db.update(parks)
        .set({
          wikidataId: wikidataId,
          wikidataVerified: true,
          wikidataScore: Math.round(bestScore * 100) / 100
        })
        .where(eq(parks.id, park.id));
      
      verified++;
      
      if (park.osmMatchStatus === 'ambiguous' && bestScore >= 0.7) {
        improved++;
        console.log(`✓ Verified: ${park.name} → ${bestMatch.itemLabel} (${Math.round(bestDistance)}m, score: ${bestScore.toFixed(2)})`);
      }
    } else {
      noMatch++;
    }
  }
  
  console.log(`\n=== Wikidata Verification Summary ===`);
  console.log(`Total parks checked: ${allParks.length}`);
  console.log(`Verified with Wikidata: ${verified}`);
  console.log(`High-confidence matches for ambiguous: ${improved}`);
  console.log(`No Wikidata match: ${noMatch}`);
}

verifyParksWithWikidata()
  .then(() => {
    console.log("\nWikidata verification complete!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Wikidata verification failed:", err);
    process.exit(1);
  });
