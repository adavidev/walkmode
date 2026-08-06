import {
  expandBBox,
  haversineMeters,
  metersToLatDelta,
  metersToLngDelta,
  type BBox,
  type LatLng,
} from '../geo'
import { ElevationSampler } from '../elevation/terrarium'
import { fetchWaterPolygons, pointInPolygons, type Polygon } from '../osm/water'

export type WalkGrid = {
  cols: number
  rows: number
  cellSizeM: number
  originLat: number
  originLng: number
  dLat: number
  dLng: number
  elev: Float32Array
  /** 0 = impassable (water/cliff/out), 1 = walkable */
  walkable: Uint8Array
  bbox: BBox
  water: Polygon[]
}

export type GridBuildOptions = {
  targetCellsAlong: number
  minCellM: number
  maxCellM: number
  padFraction: number
  cliffGrade: number
  elevZoom: number
}

export const DEFAULT_GRID_OPTIONS: GridBuildOptions = {
  targetCellsAlong: 180,
  minCellM: 10,
  maxCellM: 40,
  padFraction: 0.45,
  cliffGrade: 0.4,
  elevZoom: 12,
}

export function cellToLatLng(grid: WalkGrid, col: number, row: number): LatLng {
  return {
    lat: grid.originLat + row * grid.dLat,
    lng: grid.originLng + col * grid.dLng,
  }
}

export function indexOf(grid: WalkGrid, col: number, row: number): number {
  return row * grid.cols + col
}

export function nearestCell(
  grid: WalkGrid,
  point: LatLng,
): { col: number; row: number } | null {
  const col = Math.round((point.lng - grid.originLng) / grid.dLng)
  const row = Math.round((point.lat - grid.originLat) / grid.dLat)
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return null
  return { col, row }
}

/** Prefer the clicked cell; otherwise nearest walkable within a small radius. */
export function nearestWalkable(
  grid: WalkGrid,
  point: LatLng,
): { col: number; row: number } | null {
  const base = nearestCell(grid, point)
  if (!base) return null
  if (grid.walkable[indexOf(grid, base.col, base.row)]) return base

  const maxR = 12
  let best: { col: number; row: number } | null = null
  let bestD = Infinity
  for (let r = Math.max(0, base.row - maxR); r <= Math.min(grid.rows - 1, base.row + maxR); r++) {
    for (let c = Math.max(0, base.col - maxR); c <= Math.min(grid.cols - 1, base.col + maxR); c++) {
      if (!grid.walkable[indexOf(grid, c, r)]) continue
      const d = (c - base.col) ** 2 + (r - base.row) ** 2
      if (d < bestD) {
        bestD = d
        best = { col: c, row: r }
      }
    }
  }
  return best
}

export async function buildWalkGrid(
  start: LatLng,
  end: LatLng,
  options: Partial<GridBuildOptions> = {},
  onProgress?: (msg: string) => void,
): Promise<WalkGrid> {
  const opts = { ...DEFAULT_GRID_OPTIONS, ...options }
  const straight = haversineMeters(start, end)
  const cellSizeM = Math.min(
    opts.maxCellM,
    Math.max(opts.minCellM, straight / opts.targetCellsAlong),
  )

  const bbox = expandBBox(start, end, opts.padFraction)
  const midLat = (bbox.south + bbox.north) / 2
  const dLat = metersToLatDelta(cellSizeM)
  const dLng = metersToLngDelta(cellSizeM, midLat)

  const cols = Math.max(3, Math.ceil((bbox.east - bbox.west) / dLng) + 1)
  const rows = Math.max(3, Math.ceil((bbox.north - bbox.south) / dLat) + 1)
  const originLat = bbox.south
  const originLng = bbox.west

  onProgress?.('Fetching water…')
  let water: Polygon[] = []
  try {
    water = await fetchWaterPolygons(bbox)
  } catch {
    // Overpass can flake; continue without water barriers
    water = []
  }

  const points: LatLng[] = new Array(cols * rows)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      points[r * cols + c] = {
        lat: originLat + r * dLat,
        lng: originLng + c * dLng,
      }
    }
  }

  onProgress?.('Sampling elevation…')
  const sampler = new ElevationSampler(opts.elevZoom)
  const elev = await sampler.sampleMany(points, opts.elevZoom)

  const walkable = new Uint8Array(cols * rows)
  for (let i = 0; i < walkable.length; i++) {
    walkable[i] = pointInPolygons(points[i], water) ? 0 : 1
  }

  return {
    cols,
    rows,
    cellSizeM,
    originLat,
    originLng,
    dLat,
    dLng,
    elev,
    walkable,
    bbox,
    water,
  }
}
