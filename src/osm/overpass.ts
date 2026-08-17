import {
  haversineMeters,
  offsetMeters,
  pointToPolylineMeters,
  pointToSegmentMeters,
  segmentIntersection,
  type BBox,
  type LatLng,
} from '../geo'
import { idbGet, idbPut } from '../cache/idb'

export type Ring = LatLng[]
export type Polygon = { outer: Ring; holes: Ring[] }
export type BarrierRoad = { points: LatLng[]; halfWidthM: number }
export type Crossing = { points: LatLng[] }

type OsmGeom = { lat: number; lon: number }
type OsmNode = {
  type: 'node'
  id: number
  lat: number
  lon: number
  tags?: Record<string, string>
}
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

const WALKWAY = new Set([
  'footway',
  'path',
  'steps',
  'pedestrian',
  'corridor',
  'platform',
])

const ARTERIAL = new Set([
  'trunk',
  'trunk_link',
  'primary',
  'primary_link',
  'secondary',
  'secondary_link',
  'tertiary',
])

/** Carriageways pedestrians must not jaywalk across. */
export function isBarrierRoad(tags?: Record<string, string>): boolean {
  if (!tags?.highway) return false
  const hw = tags.highway
  if (WALKWAY.has(hw)) return false
  if (hw === 'motorway' || hw === 'motorway_link') return true
  if (tags.expressway === 'yes' || tags.motorroad === 'yes') return true
  if (tags.foot === 'no' || tags.foot === 'use_sidepath') return true
  if (!ARTERIAL.has(hw)) return false
  if (tags.dual_carriageway === 'yes') return true
  const lanes = Number(tags.lanes)
  if (!Number.isFinite(lanes) || lanes <= 0) return false
  if (lanes >= 3) return true
  return tags.oneway === 'yes' && lanes >= 2
}

function isCrossing(tags?: Record<string, string>): boolean {
  if (!tags) return false
  if (tags.footway === 'crossing') return true
  if (tags.highway !== 'crossing') return false
  // Informal unmarked spots are not a legal crosswalk.
  if (tags.crossing === 'unmarked' && tags['crossing:markings'] === 'no') {
    return false
  }
  return true
}

function lineFromWay(way: OsmWay): LatLng[] | null {
  if (!way.geometry || way.geometry.length < 2) return null
  return way.geometry.map((g) => ({ lat: g.lat, lng: g.lon }))
}

function roadHalfWidthM(tags?: Record<string, string>): number {
  const lanes = Number(tags?.lanes)
  const n = Number.isFinite(lanes) && lanes > 0 ? lanes : tags?.oneway === 'yes' ? 2 : 3
  const median = n >= 3 ? 4 : 1.5
  return (n * 3.5) / 2 + median
}

function parseBarrierRoads(elements: OsmElement[]): BarrierRoad[] {
  const roads: BarrierRoad[] = []
  for (const el of elements) {
    if (el.type !== 'way' || !isBarrierRoad(el.tags)) continue
    const points = lineFromWay(el)
    if (!points) continue
    roads.push({ points, halfWidthM: roadHalfWidthM(el.tags) })
  }
  return roads
}

function parseCrossings(elements: OsmElement[]): Crossing[] {
  const crossings: Crossing[] = []
  for (const el of elements) {
    if (el.type === 'node') {
      if (!isCrossing(el.tags)) continue
      crossings.push({ points: [{ lat: el.lat, lng: el.lon }] })
      continue
    }
    if (el.type !== 'way' || !isCrossing(el.tags)) continue
    const points = lineFromWay(el)
    if (points) crossings.push({ points })
  }
  return crossings
}

function parseConnectorRoads(elements: OsmElement[]): LatLng[][] {
  const lines: LatLng[][] = []
  for (const el of elements) {
    if (el.type !== 'way') continue
    if (!el.tags?.highway || WALKWAY.has(el.tags.highway)) continue
    if (isBarrierRoad(el.tags)) continue
    const points = lineFromWay(el)
    if (points && points.length >= 2) lines.push(points)
  }
  return lines
}

function deriveCrossingsAtIntersections(
  barriers: BarrierRoad[],
  connectors: LatLng[][],
): Crossing[] {
  const seen = new Set<string>()
  const derived: Crossing[] = []
  for (const road of barriers) {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]
      const b = road.points[i]
      for (const conn of connectors) {
        for (let j = 1; j < conn.length; j++) {
          const hit = segmentIntersection(a, b, conn[j - 1], conn[j])
          if (!hit) continue
          const key = `${hit.lat.toFixed(5)},${hit.lng.toFixed(5)}`
          if (seen.has(key)) continue
          seen.add(key)
          derived.push({ points: [hit] })
        }
      }
    }
  }
  return derived
}

function crossingCenter(crossing: Crossing): LatLng {
  if (crossing.points.length === 1) return crossing.points[0]
  let lat = 0
  let lng = 0
  for (const p of crossing.points) {
    lat += p.lat
    lng += p.lng
  }
  return { lat: lat / crossing.points.length, lng: lng / crossing.points.length }
}

/** Merge crossing nodes that belong to the same intersection. */
function clusterCrossings(crossings: Crossing[], mergeM: number): LatLng[] {
  const centers = crossings.map(crossingCenter)
  const clusters: { lat: number; lng: number; n: number }[] = []
  for (const c of centers) {
    let hit: (typeof clusters)[number] | null = null
    for (const cl of clusters) {
      if (haversineMeters(c, { lat: cl.lat, lng: cl.lng }) <= mergeM) {
        hit = cl
        break
      }
    }
    if (hit) {
      hit.lat = (hit.lat * hit.n + c.lat) / (hit.n + 1)
      hit.lng = (hit.lng * hit.n + c.lng) / (hit.n + 1)
      hit.n += 1
    } else {
      clusters.push({ lat: c.lat, lng: c.lng, n: 1 })
    }
  }
  return clusters.map((cl) => ({ lat: cl.lat, lng: cl.lng }))
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

function accessQuery(b: string): string {
  return `
[out:json][timeout:45][maxsize:33554432];
(
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary)$"]${b};
  way["expressway"="yes"]${b};
  way["motorroad"="yes"]${b};
  way["highway"]["foot"="no"]${b};
  way["highway"]["foot"="use_sidepath"]${b};
  way["highway"~"^(tertiary|secondary|primary|residential|unclassified|living_street|service)$"]${b};
  node["highway"="crossing"]${b};
  way["footway"="crossing"]${b};
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
  way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary)$"]${b};
  way["expressway"="yes"]${b};
  way["motorroad"="yes"]${b};
  way["highway"]["foot"="no"]${b};
  way["highway"]["foot"="use_sidepath"]${b};
  way["highway"~"^(tertiary|secondary|primary|residential|unclassified|living_street|service)$"]${b};
  node["highway"="crossing"]${b};
  way["footway"="crossing"]${b};
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
  return `osm-v4:${b.south},${b.west},${b.north},${b.east}`
}

type ObstacleSet = {
  water: Polygon[]
  buildings: Polygon[]
  barriers: BarrierRoad[]
  crossings: Crossing[]
}

const osmMemory = new Map<string, ObstacleSet>()

function parseObstacles(els: OsmElement[]): ObstacleSet {
  const barriers = parseBarrierRoads(els)
  const connectors = parseConnectorRoads(els)
  const tagged = parseCrossings(els)
  const derived = deriveCrossingsAtIntersections(barriers, connectors)
  const crossings = [...tagged, ...derived]
  return {
    water: parseOverpass(els, isWater),
    buildings: parseOverpass(els, isBuilding),
    barriers,
    crossings,
  }
}

async function queryObstacles(bbox: BBox): Promise<ObstacleSet> {
  const b = bboxClause(bbox)
  try {
    return parseObstacles(await postOverpass(combinedQuery(b)))
  } catch {
    const [waterEls, buildingEls, accessEls] = await Promise.all([
      postOverpass(waterQuery(b)).catch(() => [] as OsmElement[]),
      postOverpass(buildingQuery(b)).catch(() => [] as OsmElement[]),
      postOverpass(accessQuery(b)).catch(() => [] as OsmElement[]),
    ])
    return {
      water: parseOverpass(waterEls, isWater),
      buildings: parseOverpass(buildingEls, isBuilding),
      barriers: parseBarrierRoads(accessEls),
      crossings: parseCrossings(accessEls),
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

function lineBBox(line: LatLng[]): BBox {
  let south = Infinity
  let west = Infinity
  let north = -Infinity
  let east = -Infinity
  for (const p of line) {
    if (p.lat < south) south = p.lat
    if (p.lat > north) north = p.lat
    if (p.lng < west) west = p.lng
    if (p.lng > east) east = p.lng
  }
  return { south, west, north, east }
}

function stampNearLines(
  mask: Uint8Array,
  cols: number,
  rows: number,
  originLat: number,
  originLng: number,
  dLat: number,
  dLng: number,
  lines: { points: LatLng[]; radiusM: number }[],
  value: number,
): void {
  for (const line of lines) {
    if (line.points.length === 0) continue
    const box = lineBBox(line.points)
    const padLat = line.radiusM / 111320 + dLat
    const padLng = line.radiusM / (111320 * Math.cos((box.south * Math.PI) / 180)) + dLng
    const c0 = Math.max(0, Math.floor((box.west - padLng - originLng) / dLng) - 1)
    const c1 = Math.min(cols - 1, Math.ceil((box.east + padLng - originLng) / dLng) + 1)
    const r0 = Math.max(0, Math.floor((box.south - padLat - originLat) / dLat) - 1)
    const r1 = Math.min(rows - 1, Math.ceil((box.north + padLat - originLat) / dLat) + 1)
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const i = r * cols + c
        const p = { lat: originLat + r * dLat, lng: originLng + c * dLng }
        if (pointToPolylineMeters(p, line.points) <= line.radiusM) {
          mask[i] = value
        }
      }
    }
  }
}

function openCrossingCorridor(
  mask: Uint8Array,
  cols: number,
  rows: number,
  originLat: number,
  originLng: number,
  dLat: number,
  dLng: number,
  cellSizeM: number,
  center: LatLng,
  barriers: BarrierRoad[],
  crossing: Crossing,
): void {
  const nearby = barriers.filter(
    (road) => pointToPolylineMeters(center, road.points) < 90,
  )
  const halfW = Math.max(14, cellSizeM * 0.85)

  if (nearby.length === 0) {
    stampNearLines(
      mask,
      cols,
      rows,
      originLat,
      originLng,
      dLat,
      dLng,
      [{ points: [center], radiusM: Math.max(30, cellSizeM * 1.5) }],
      0,
    )
    return
  }

  let bestDist = Infinity
  let roadBearing = 0
  let maxExtent = 0
  for (const road of nearby) {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1]
      const b = road.points[i]
      const dist = pointToSegmentMeters(center, a, b)
      if (dist < bestDist) {
        bestDist = dist
        const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180)
        roadBearing = Math.atan2(
          b.lat - a.lat,
          (b.lng - a.lng) * Math.cos(midLat),
        )
      }
      maxExtent = Math.max(maxExtent, dist + road.halfWidthM)
    }
  }

  const perp = roadBearing + Math.PI / 2
  const halfLen = maxExtent + cellSizeM * 2
  const p1 = offsetMeters(center, perp, -halfLen)
  const p2 = offsetMeters(center, perp, halfLen)
  stampNearLines(
    mask,
    cols,
    rows,
    originLat,
    originLng,
    dLat,
    dLng,
    [{ points: [p1, p2], radiusM: halfW }],
    0,
  )

  // Footway crossings and intersection corners: also open along the cross street.
  const crossHalf =
    crossing.points.length > 1 ? Math.max(22, cellSizeM * 1.2) : Math.max(16, cellSizeM)
  const q1 = offsetMeters(center, roadBearing, -crossHalf)
  const q2 = offsetMeters(center, roadBearing, crossHalf)
  stampNearLines(
    mask,
    cols,
    rows,
    originLat,
    originLng,
    dLat,
    dLng,
    [{ points: [q1, q2], radiusM: halfW }],
    0,
  )
}

/** Block limited-access carriageways, then reopen cells at OSM crosswalks. */
export function applyLimitedAccess(
  walkable: Uint8Array,
  cols: number,
  rows: number,
  originLat: number,
  originLng: number,
  dLat: number,
  dLng: number,
  cellSizeM: number,
  barriers: BarrierRoad[],
  crossings: Crossing[],
): void {
  if (barriers.length === 0) return
  const blocked = new Uint8Array(walkable.length)
  stampNearLines(
    blocked,
    cols,
    rows,
    originLat,
    originLng,
    dLat,
    dLng,
    barriers.map((road) => ({
      points: road.points,
      radiusM: road.halfWidthM + cellSizeM * 0.55,
    })),
    1,
  )

  const hubs = clusterCrossings(crossings, 28)
  for (const hub of hubs) {
    let nearest: Crossing = { points: [hub] }
    let nearestD = Infinity
    for (const crossing of crossings) {
      const d = haversineMeters(hub, crossingCenter(crossing))
      if (d < nearestD) {
        nearestD = d
        nearest = crossing
      }
    }
    openCrossingCorridor(
      blocked,
      cols,
      rows,
      originLat,
      originLng,
      dLat,
      dLng,
      cellSizeM,
      hub,
      barriers,
      nearest,
    )
  }

  for (let i = 0; i < walkable.length; i++) {
    if (blocked[i]) walkable[i] = 0
  }
}
