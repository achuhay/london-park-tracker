/**
 * British National Grid (OSGB36) to WGS84 (GPS) coordinate converter
 * 
 * This converts easting/northing values to latitude/longitude.
 * Uses simplified Helmert transformation for accuracy within ~5 meters.
 */

// Ellipsoid parameters
const AIRY_1830 = {
  a: 6377563.396,  // Semi-major axis
  b: 6356256.909,  // Semi-minor axis
};

const WGS84 = {
  a: 6378137.0,
  b: 6356752.3142,
};

// National Grid origin
const E0 = 400000;  // Easting of true origin
const N0 = -100000; // Northing of true origin
const F0 = 0.9996012717; // Scale factor on central meridian
const PHI0 = 49 * Math.PI / 180; // Latitude of true origin (radians)
const LAMBDA0 = -2 * Math.PI / 180; // Longitude of true origin (radians)

// Helmert transformation parameters (OSGB36 to WGS84)
const TX = 446.448;
const TY = -125.157;
const TZ = 542.060;
const RX = 0.1502 / 3600 * Math.PI / 180;
const RY = 0.2470 / 3600 * Math.PI / 180;
const RZ = 0.8421 / 3600 * Math.PI / 180;
const S = -20.4894 / 1e6;

function toRadians(degrees: number): number {
  return degrees * Math.PI / 180;
}

function toDegrees(radians: number): number {
  return radians * 180 / Math.PI;
}

/**
 * Convert OSGB36 National Grid coordinates to lat/lon on Airy ellipsoid
 */
function osgb36ToLatLon(E: number, N: number): { lat: number; lon: number } {
  const { a, b } = AIRY_1830;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);
  const n2 = n * n;
  const n3 = n * n * n;

  let phi = PHI0;
  let M = 0;

  // Iterate to find latitude
  do {
    phi = (N - N0 - M) / (a * F0) + phi;
    
    const Ma = (1 + n + (5/4) * n2 + (5/4) * n3) * (phi - PHI0);
    const Mb = (3 * n + 3 * n2 + (21/8) * n3) * Math.sin(phi - PHI0) * Math.cos(phi + PHI0);
    const Mc = ((15/8) * n2 + (15/8) * n3) * Math.sin(2 * (phi - PHI0)) * Math.cos(2 * (phi + PHI0));
    const Md = (35/24) * n3 * Math.sin(3 * (phi - PHI0)) * Math.cos(3 * (phi + PHI0));
    M = b * F0 * (Ma - Mb + Mc - Md);
  } while (Math.abs(N - N0 - M) > 0.00001);

  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const sin2Phi = sinPhi * sinPhi;
  const tanPhi = Math.tan(phi);
  const tan2Phi = tanPhi * tanPhi;
  const tan4Phi = tan2Phi * tan2Phi;
  const tan6Phi = tan4Phi * tan2Phi;

  const nu = a * F0 / Math.sqrt(1 - e2 * sin2Phi);
  const rho = a * F0 * (1 - e2) / Math.pow(1 - e2 * sin2Phi, 1.5);
  const eta2 = nu / rho - 1;

  const VII = tanPhi / (2 * rho * nu);
  const VIII = tanPhi / (24 * rho * Math.pow(nu, 3)) * (5 + 3 * tan2Phi + eta2 - 9 * tan2Phi * eta2);
  const IX = tanPhi / (720 * rho * Math.pow(nu, 5)) * (61 + 90 * tan2Phi + 45 * tan4Phi);
  const X = 1 / (cosPhi * nu);
  const XI = 1 / (cosPhi * 6 * Math.pow(nu, 3)) * (nu / rho + 2 * tan2Phi);
  const XII = 1 / (cosPhi * 120 * Math.pow(nu, 5)) * (5 + 28 * tan2Phi + 24 * tan4Phi);
  const XIIA = 1 / (cosPhi * 5040 * Math.pow(nu, 7)) * (61 + 662 * tan2Phi + 1320 * tan4Phi + 720 * tan6Phi);

  const dE = E - E0;
  const dE2 = dE * dE;
  const dE3 = dE2 * dE;
  const dE4 = dE2 * dE2;
  const dE5 = dE4 * dE;
  const dE6 = dE3 * dE3;
  const dE7 = dE4 * dE3;

  const lat = phi - VII * dE2 + VIII * dE4 - IX * dE6;
  const lon = LAMBDA0 + X * dE - XI * dE3 + XII * dE5 - XIIA * dE7;

  return { lat: toDegrees(lat), lon: toDegrees(lon) };
}

/**
 * Convert lat/lon to cartesian coordinates on given ellipsoid
 */
function toCartesian(lat: number, lon: number, ellipsoid: { a: number; b: number }) {
  const { a, b } = ellipsoid;
  const sinPhi = Math.sin(toRadians(lat));
  const cosPhi = Math.cos(toRadians(lat));
  const sinLambda = Math.sin(toRadians(lon));
  const cosLambda = Math.cos(toRadians(lon));
  const e2 = 1 - (b * b) / (a * a);
  const nu = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);

  return {
    x: nu * cosPhi * cosLambda,
    y: nu * cosPhi * sinLambda,
    z: (1 - e2) * nu * sinPhi,
  };
}

/**
 * Convert cartesian coordinates to lat/lon on given ellipsoid
 */
function toLatLon(x: number, y: number, z: number, ellipsoid: { a: number; b: number }) {
  const { a, b } = ellipsoid;
  const e2 = 1 - (b * b) / (a * a);
  const p = Math.sqrt(x * x + y * y);
  let phi = Math.atan2(z, p * (1 - e2));
  let phiP = 2 * Math.PI;

  while (Math.abs(phi - phiP) > 1e-12) {
    const sinPhi = Math.sin(phi);
    const nu = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
    phiP = phi;
    phi = Math.atan2(z + e2 * nu * sinPhi, p);
  }

  const lon = Math.atan2(y, x);
  return { lat: toDegrees(phi), lon: toDegrees(lon) };
}

/**
 * Apply Helmert transformation from OSGB36 to WGS84
 */
function helmertTransform(x: number, y: number, z: number) {
  return {
    x: (1 + S) * x + (-RZ) * y + (RY) * z + TX,
    y: (RZ) * x + (1 + S) * y + (-RX) * z + TY,
    z: (-RY) * x + (RX) * y + (1 + S) * z + TZ,
  };
}

/**
 * Convert British National Grid (easting/northing) to WGS84 (lat/lng)
 * 
 * @param easting - Easting coordinate (e.g., 544040)
 * @param northing - Northing coordinate (e.g., 183920)
 * @returns Object with latitude and longitude in WGS84
 */
export function osgbToWgs84(easting: number, northing: number): { latitude: number; longitude: number } {
  // Step 1: Convert OSGB36 grid to lat/lon on Airy ellipsoid
  const osgb = osgb36ToLatLon(easting, northing);
  
  // Step 2: Convert to cartesian on Airy
  const cartesian = toCartesian(osgb.lat, osgb.lon, AIRY_1830);
  
  // Step 3: Apply Helmert transformation
  const wgs84Cartesian = helmertTransform(cartesian.x, cartesian.y, cartesian.z);
  
  // Step 4: Convert back to lat/lon on WGS84
  const wgs84 = toLatLon(wgs84Cartesian.x, wgs84Cartesian.y, wgs84Cartesian.z, WGS84);
  
  return { latitude: wgs84.lat, longitude: wgs84.lon };
}

/**
 * Calculate distance between two points in meters using Haversine formula
 */
export function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = toRadians(lat2 - lat1);
  const deltaLambda = toRadians(lon2 - lon1);

  const a = Math.sin(deltaPhi / 2) ** 2 +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}
