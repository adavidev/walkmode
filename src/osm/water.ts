import type { BBox, LatLng } from '../geo'

export type Ring = LatLng[]
export type Polygon = { outer: Ring; holes: Ring[] }

type OsmNode = { type: 'node'; id: number; lat: number; lon: number }
type OsmWay = {
  type: 'way'
  id: number
  nodes: number[]
  tags?: Record<string, string>
}
type OsmRelation = {
  type: 'relation'
  id: number
  members: { type: string; ref: number; role: string }[]
  tags?: Record<string, string>
}
type OsmElement = OsmNode | OsmWay | OsmRelation

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

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
  if (ring.length < 3) return null
  return ring
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

export function pointInPolygons(point: LatLng, polygons: Polygon[]): boolean {
  for (const poly of polygons) {
    if (!pointInRing(point, poly.outer)) continue
    let inHole = false
    for (const hole of poly.holes) {
      if (pointInRing(point, hole)) {
        inHole = true
        break
      }
    }
    if (!inHole) return true
  }
  return false
}

function parseOverpass(elements: OsmElement[]): Polygon[] {
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
    const outers: Ring[] = []
    const holes: Ring[] = []
    for (const m of rel.members) {
      if (m.type !== 'way') continue
      const way = ways.get(m.ref)
      if (!way) continue
      const ring = ringFromNodes(way.nodes, nodes)
      if (!ring) continue
      usedWays.add(way.id)
      if (m.role === 'inner') holes.push(ring)
      else outers.push(ring)
    }
    for (const outer of outers) {
      polygons.push({ outer, holes })
    }
  }

  for (const way of ways.values()) {
    if (usedWays.has(way.id)) continue
    // Closed ways only
    if (way.nodes.length < 4) continue
    if (way.nodes[0] !== way.nodes[way.nodes.length - 1]) continue
    const ring = ringFromNodes(way.nodes, nodes)
    if (ring) polygons.push({ outer: ring, holes: [] })
  }

  return polygons
}

export async function fetchWaterPolygons(bbox: BBox): Promise<Polygon[]> {
  const { south, west, north, east } = bbox
  const query = `
[out:json][timeout:25];
(
  way["natural"="water"](${south},${west},${north},${east});
  relation["natural"="water"](${south},${west},${north},${east});
  way["waterway"="riverbank"](${south},${west},${north},${east});
  relation["waterway"="riverbank"](${south},${west},${north},${east});
  way["landuse"="reservoir"](${south},${west},${north},${east});
  relation["landuse"="reservoir"](${south},${west},${north},${east});
  way["landuse"="basin"](${south},${west},${north},${east});
  way["natural"="bay"](${south},${west},${north},${east});
);
(._;>;);
out body;
`
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: query,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  if (!res.ok) {
    throw new Error(`Overpass water query failed: ${res.status}`)
  }
  const json = (await res.json()) as { elements: OsmElement[] }
  return parseOverpass(json.elements ?? [])
}
