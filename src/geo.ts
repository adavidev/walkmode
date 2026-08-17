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

/** Distance from a point to a polyline in meters (equirectangular). */
export function pointToPolylineMeters(point: LatLng, line: LatLng[]): number {
  if (line.length === 0) return Infinity
  if (line.length === 1) return equirectMeters(point, line[0])
  let best = Infinity
  for (let i = 1; i < line.length; i++) {
    const d = pointToSegmentMeters(point, line[i - 1], line[i])
    if (d < best) best = d
  }
  return best
}

export function pointToSegmentMeters(p: LatLng, a: LatLng, b: LatLng): number {
  const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180)
  const mx = Math.cos(midLat) * EARTH_RADIUS_M * (Math.PI / 180)
  const my = EARTH_RADIUS_M * (Math.PI / 180)
  const bx = (b.lng - a.lng) * mx
  const by = (b.lat - a.lat) * my
  const px = (p.lng - a.lng) * mx
  const py = (p.lat - a.lat) * my
  const ab2 = bx * bx + by * by
  if (ab2 < 1e-6) return Math.hypot(px, py)
  let t = (px * bx + py * by) / ab2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  return Math.hypot(px - t * bx, py - t * by)
}

/** Move from `origin` along `bearingRad` (east=0, north=π/2) by `meters`. */
export function offsetMeters(
  origin: LatLng,
  bearingRad: number,
  meters: number,
): LatLng {
  const latRad = (origin.lat * Math.PI) / 180
  const dLat = (meters * Math.cos(bearingRad)) / EARTH_RADIUS_M
  const dLng =
    (meters * Math.sin(bearingRad)) /
    (EARTH_RADIUS_M * Math.cos(latRad))
  return {
    lat: origin.lat + (dLat * 180) / Math.PI,
    lng: origin.lng + (dLng * 180) / Math.PI,
  }
}

/** Segment intersection in local meters; returns lat/lng or null. */
export function segmentIntersection(
  a: LatLng,
  b: LatLng,
  c: LatLng,
  d: LatLng,
): LatLng | null {
  const midLat = ((a.lat + b.lat + c.lat + d.lat) / 4) * (Math.PI / 180)
  const mx = Math.cos(midLat) * EARTH_RADIUS_M * (Math.PI / 180)
  const my = EARTH_RADIUS_M * (Math.PI / 180)
  const toXY = (p: LatLng) => ({
    x: (p.lng - a.lng) * mx,
    y: (p.lat - a.lat) * my,
  })
  const p1 = toXY(a)
  const p2 = toXY(b)
  const p3 = toXY(c)
  const p4 = toXY(d)
  const den =
    (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x)
  if (Math.abs(den) < 1e-9) return null
  const t =
    ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / den
  const u =
    ((p1.x - p3.x) * (p1.y - p2.y) - (p1.y - p3.y) * (p1.x - p2.x)) / den
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return {
    lat: a.lat + (t * (b.lat - a.lat)),
    lng: a.lng + (t * (b.lng - a.lng)),
  }
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
