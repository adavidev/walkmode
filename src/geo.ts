export type LatLng = { lat: number; lng: number }

export type BBox = { south: number; west: number; north: number; east: number }

const EARTH_RADIUS_M = 6371000

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = Math.PI / 180
  const dLat = (b.lat - a.lat) * toRad
  const dLng = (b.lng - a.lng) * toRad
  const lat1 = a.lat * toRad
  const lat2 = b.lat * toRad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Fast approximate meters for short steps on a local grid. */
export function equirectMeters(a: LatLng, b: LatLng): number {
  const toRad = Math.PI / 180
  const midLat = ((a.lat + b.lat) / 2) * toRad
  const dx = (b.lng - a.lng) * toRad * Math.cos(midLat) * EARTH_RADIUS_M
  const dy = (b.lat - a.lat) * toRad * EARTH_RADIUS_M
  return Math.hypot(dx, dy)
}

export function latLngToTile(
  lat: number,
  lng: number,
  z: number,
): { x: number; y: number; px: number; py: number } {
  const n = 2 ** z
  const x = ((lng + 180) / 360) * n
  const latRad = (lat * Math.PI) / 180
  const y =
    ((1 -
      Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) /
      2) *
    n
  const tileX = Math.floor(x)
  const tileY = Math.floor(y)
  return {
    x: tileX,
    y: tileY,
    px: (x - tileX) * 256,
    py: (y - tileY) * 256,
  }
}

export function metersToLatDelta(meters: number): number {
  return (meters / EARTH_RADIUS_M) * (180 / Math.PI)
}

export function metersToLngDelta(meters: number, lat: number): number {
  return (
    (meters / (EARTH_RADIUS_M * Math.cos((lat * Math.PI) / 180))) *
    (180 / Math.PI)
  )
}

/** Pad start/end by the same meters on both axes so N-S / E-W routes still have room. */
export function expandBBox(a: LatLng, b: LatLng, padMeters: number): BBox {
  const south = Math.min(a.lat, b.lat)
  const north = Math.max(a.lat, b.lat)
  const west = Math.min(a.lng, b.lng)
  const east = Math.max(a.lng, b.lng)
  const midLat = (south + north) / 2
  const latPad = metersToLatDelta(padMeters)
  const lngPad = metersToLngDelta(padMeters, midLat)
  return {
    south: south - latPad,
    west: west - lngPad,
    north: north + latPad,
    east: east + lngPad,
  }
}

/** Approximate geodesic circle as a closed lat/lng ring (meter-true at center lat). */
export function circleRing(
  center: LatLng,
  radiusM: number,
  segments = 64,
): LatLng[] {
  const dLat = metersToLatDelta(radiusM)
  const dLng = metersToLngDelta(radiusM, center.lat)
  const ring: LatLng[] = []
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2
    ring.push({
      lat: center.lat + dLat * Math.sin(a),
      lng: center.lng + dLng * Math.cos(a),
    })
  }
  return ring
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(2)} km`
}

export function formatElevation(meters: number): string {
  return `${Math.round(meters)} m`
}
