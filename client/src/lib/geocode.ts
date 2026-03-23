/**
 * Geocode a UK address/place-name using the Nominatim API (no API key needed).
 * Returns [lat, lng] or null if nothing was found.
 */
export async function geocodeAddress(
  query: string
): Promise<[number, number] | null> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/search` +
      `?q=${encodeURIComponent(query)}` +
      `&countrycodes=gb` +
      `&limit=1` +
      `&format=json`;

    const res = await fetch(url, {
      headers: {
        "Accept-Language": "en",
        // Nominatim requires a User-Agent identifying the application
        "User-Agent": "ParkRunLDN/1.0 (parkrun.ldn)",
      },
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;

    const { lat, lon } = data[0];
    return [parseFloat(lat), parseFloat(lon)];
  } catch {
    return null;
  }
}
