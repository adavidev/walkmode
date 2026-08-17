import { haversineMeters, type BBox, type LatLng } from '../geo'
import { idbGet, idbPut } from '../cache/idb'

export type Ring = LatLng[]
export type Polygon = { outer: Ring; holes: Ring[] }

type OsmGeom = { lat: number; lon: number }
type OsmNode = { type: 'node'; id: number; lat: number; lon: number }
type OsmWay = {
  type: 'way'
  id: number
  nodes?: number[]
  geometry?: OsmGeom[]
  tags?: Record<string, string>
}
type OsmMember = {
  type: string
  ref: number
  role: string
  geometry?: OsmGeom[]
}
type OsmRelation = {
  type: 'relation'
  id: number
  members: OsmMember[]
  tags?: Record<string, string>
}
type OsmElement = OsmNode | OsmWay | OsmRelation

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
]

function closeRing(ring: Ring): Ring | null {
  if (ring.length < 3) return null
  const first = ring[0]
  const last = ring[ring.length - 1]
  const already =
    first.lat === last.lat && first.lng === last.lng
  if (already) return ring.length >= 4 ? ring : null
  // Only close a tiny gap. Force-closing a long open way makes a city-sized
  // polygon that seals every street in the bbox.
  if (haversineMeters(first, last) > 20) return null
  return [...ring, { lat: first.lat, lng: first.lng }]
}

function ringFromGeometry(geom?: OsmGeom[]): Ring | null {
  if (!geom || geom.length < 3) return null
  return closeRing(geom.map((g) => ({ lat: g.lat, lng: g.lon })))
}

function ringFromNodes(
  nodeIds: number[],
  nodes: Map<number, OsmNode>,
): Ring | null {
  const ring: Ring = []
  for (const id of nodeIds) {
    const n = nodes.get(id)
    if (!n) return null
    ring.push({ lat: n.lat, lng: n.lon })
  }
  return closeRing(ring)
}

function ringFromWay(way: OsmWay, nodes: Map<number, OsmNode>): Ring | null {
  const fromGeom = ringFromGeometry(way.geometry)
  if (fromGeom) return fromGeom
  if (!way.nodes || way.nodes.length < 4) return null
  if (way.nodes[0] !== way.nodes[way.nodes.length - 1]) return null
  return ringFromNodes(way.nodes, nodes)
}

function ringFromMember(
  member: OsmMember,
  ways: Map<number, OsmWay>,
  nodes: Map<number, OsmNode>,
): Ring | null {
  const fromGeom = ringFromGeometry(member.geometry)
  if (fromGeom) return fromGeom
  const way = ways.get(member.ref)
  if (!way) return null
  return ringFromWay(way, nodes)
}

/** Ray-cast point-in-ring (lng/lat as x/y). */
export function pointInRing(point: LatLng, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lng
    const yi = ring[i].lat
    const xj = ring[j].lng
    const yj = ring[j].lat
    const intersect =
      yi > point.lat !== yj > point.lat &&
      point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function pointInPolygon(point: LatLng, poly: Polygon): boolean {
  if (!pointInRing(point, poly.outer)) return false
  for (const hole of poly.holes) {
    if (pointInRing(point, hole)) return false
  }
  return true
}

export function pointInPolygons(point: LatLng, polygons: Polygon[]): boolean {
  for (const poly of polygons) {
    if (pointInPolygon(point, poly)) return true
  }
  return false
}

export function ringBBox(ring: Ring): BBox {
  let south = Infinity
  let west = Infinity
  let north = -Infinity
  let east = -Infinity
  for (const p of ring) {
    if (p.lat < south) south = p.lat
    if (p.lat > north) north = p.lat
    if (p.lng < west) west = p.lng
    if (p.lng > east) east = p.lng
  }
  return { south, west, north, east }
}

function parseOverpass(
  elements: OsmElement[],
  keep: (tags?: Record<string, string>) => boolean,
): Polygon[] {
  const nodes = new Map<number, OsmNode>()
  const ways = new Map<number, OsmWay>()
  const relations: OsmRelation[] = []

  for (const el of elements) {
    if (el.type === 'node') nodes.set(el.id, el)
    else if (el.type === 'way') ways.set(el.id, el)
    else if (el.type === 'relation') relations.push(el)
  }

  const polygons: Polygon[] = []
  const usedWays = new Set<number>()

  for (const rel of relations) {
    if (!keep(rel.tags)) continue
    const outers: Ring[] = []
    const holes: Ring[] = []
    for (const m of rel.members) {
      if (m.type !== 'way') continue
      const ring = ringFromMember(m, ways, nodes)
      if (!ring) continue
      usedWays.add(m.ref)
      if (m.role === 'inner') holes.push(ring)
      else outers.push(ring)
    }
    for (const outer of outers) {
      polygons.push({ outer, holes })
    }
  }

  for (const way of ways.values()) {
    if (usedWays.has(way.id)) continue
    if (!keep(way.tags)) continue
    const ring = ringFromWay(way, nodes)
    if (ring) polygons.push({ outer: ring, holes: [] })
  }

  return polygons
}

function isWater(tags?: Record<string, string>): boolean {
  if (!tags) return false
  return (
    tags.natural === 'water' ||
    tags.natural === 'bay' ||
    tags.waterway === 'riverbank' ||
    tags.landuse === 'reservoir' ||
    tags.landuse === 'basin'
  )
}

function isBuilding(tags?: Record<string, string>): boolean {
  const value = tags?.building
  return Boolean(value) && value !== 'no'
}

async function postOverpass(query: string): Promise<OsmElement[]> {
  let lastError: Error | null = null
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams({ data: query }).toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      if (!res.ok) {
        lastError = new Error(`Overpass ${url} failed: ${res.status}`)
        continue
      }
      const json = (await res.json()) as { elements?: OsmElement[] }
      return json.elements ?? []
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
    }
  }
  throw lastError ?? new Error('Overpass query failed')
}

function bboxClause(bbox: BBox): string {
  const { south, west, north, east } = bbox
  return `(${south},${west},${north},${east})`
}

function waterQuery(b: string): string {
  return `
[out:json][timeout:60][maxsize:67108864];
(
  way["natural"="water"]${b};
  relation["natural"="water"]${b};
  way["waterway"="riverbank"]${b};
  relation["waterway"="riverbank"]${b};
  way["landuse"="reservoir"]${b};
  relation["landuse"="reservoir"]${b};
  way["landuse"="basin"]${b};
  way["natural"="bay"]${b};
);
out geom;
`
}

function buildingQuery(b: string): string {
  return `
[out:json][timeout:60][maxsize:67108864];
(
  way["building"]${b};
  relation["building"]${b};
);
out geom;
`
}

function combinedQuery(b: string): string {
  return `
[out:json][timeout:60][maxsize:67108864];
(
  way["natural"="water"]${b};
  relation["natural"="water"]${b};
  way["waterway"="riverbank"]${b};
  relation["waterway"="riverbank"]${b};
  way["landuse"="reservoir"]${b};
  relation["landuse"="reservoir"]${b};
  way["landuse"="basin"]${b};
  way["natural"="bay"]${b};
  way["building"]${b};
  relation["building"]${b};
);
out geom;
`
}

function snapBBox(bbox: BBox): BBox {
  const snap = 1000
  return {
    south: Math.floor(bbox.south * snap) / snap,
    west: Math.floor(bbox.west * snap) / snap,
    north: Math.ceil(bbox.north * snap) / snap,
    east: Math.ceil(bbox.east * snap) / snap,
  }
}

function osmCacheKey(bbox: BBox): string {
  const b = snapBBox(bbox)
  return `osm-v2:${b.south},${b.west},${b.north},${b.east}`
}

type ObstacleSet = { water: Polygon[]; buildings: Polygon[] }

const osmMemory = new Map<string, ObstacleSet>()

async function queryObstacles(bbox: BBox): Promise<ObstacleSet> {
  const b = bboxClause(bbox)
  try {
    const els = await postOverpass(combinedQuery(b))
    return {
      water: parseOverpass(els, isWater),
      buildings: parseOverpass(els, isBuilding),
    }
  } catch {
    const [waterEls, buildingEls] = await Promise.all([
      postOverpass(waterQuery(b)).catch(() => [] as OsmElement[]),
      postOverpass(buildingQuery(b)).catch(() => [] as OsmElement[]),
    ])
    return {
      water: parseOverpass(waterEls, isWater),
      buildings: parseOverpass(buildingEls, isBuilding),
    }
  }
}

export async function fetchObstacles(
  bbox: BBox,
): Promise<ObstacleSet & { fromCache: boolean }> {
  const snapped = snapBBox(bbox)
  const key = osmCacheKey(snapped)
  const mem = osmMemory.get(key)
  if (mem) return { ...mem, fromCache: true }

  try {
    const stored = await idbGet<ObstacleSet>(key)
    if (stored) {
      osmMemory.set(key, stored)
      return { ...stored, fromCache: true }
    }
  } catch {
    // IndexedDB can be missing in private/blocked contexts.
  }

  const fetched = await queryObstacles(snapped)
  osmMemory.set(key, fetched)
  try {
    await idbPut(key, fetched)
  } catch {
    // Ignore persist failures; memory cache still helps this session.
  }
  return { ...fetched, fromCache: false }
}

/** Mark cells whose center sits inside any polygon with `value`. */
export function blockPolygonsOnGrid(
  walkable: Uint8Array,
  cols: number,
  rows: number,
  originLat: number,
  originLng: number,
  dLat: number,
  dLng: number,
  polygons: Polygon[],
  value = 0,
): void {
  for (const poly of polygons) {
    const box = ringBBox(poly.outer)
    const c0 = Math.max(0, Math.floor((box.west - originLng) / dLng) - 1)
    const c1 = Math.min(cols - 1, Math.ceil((box.east - originLng) / dLng) + 1)
    const r0 = Math.max(0, Math.floor((box.south - originLat) / dLat) - 1)
    const r1 = Math.min(rows - 1, Math.ceil((box.north - originLat) / dLat) + 1)
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * cols + c
        if (!walkable[i]) continue
        if (
          pointInPolygon(
            { lat: originLat + r * dLat, lng: originLng + c * dLng },
            poly,
          )
        ) {
          walkable[i] = value
        }
      }
    }
  }
}
