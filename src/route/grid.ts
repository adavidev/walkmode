import {
  expandBBox,
  haversineMeters,
  metersToLatDelta,
  metersToLngDelta,
  type BBox,
  type LatLng,
} from '../geo'
import { getElevationSampler } from '../elevation/terrarium'
import {
  applyLimitedAccess,
  blockPolygonsOnGrid,
  fetchObstacles,
  type BarrierRoad,
  type Crossing,
  type Polygon,
} from '../osm/overpass'

export type WalkGrid = {
  cols: number
  rows: number
  cellSizeM: number
  originLat: number
  originLng: number
  dLat: number
  dLng: number
  elev: Float32Array
  /** 0 = impassable (water/keep-away/limited-access), 1 = open, 2 = building (costly) */
  walkable: Uint8Array
  bbox: BBox
  water: Polygon[]
  buildings: Polygon[]
  barriers: BarrierRoad[]
  crossings: Crossing[]
  osmCached: boolean
}

export type GridBuildOptions = {
  targetCellsAlong: number
  minCellM: number
  maxCellM: number
  padFraction: number
  minPadM: number
  cliffGrade: number
  elevZoom: number
}

export const DEFAULT_GRID_OPTIONS: GridBuildOptions = {
  targetCellsAlong: 180,
  minCellM: 10,
  maxCellM: 40,
  padFraction: 0.45,
  minPadM: 1000,
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

  const maxR = Math.max(12, Math.ceil(520 / grid.cellSizeM))
  let best: { col: number; row: number } | null = null
  let bestD = Infinity
  for (
    let r = Math.max(0, base.row - maxR);
    r <= Math.min(grid.rows - 1, base.row + maxR);
    r++
  ) {
    for (
      let c = Math.max(0, base.col - maxR);
      c <= Math.min(grid.cols - 1, base.col + maxR);
      c++
    ) {
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

  const padM = Math.max(straight * opts.padFraction, opts.minPadM)
  const bbox = expandBBox(start, end, padM)
  const midLat = (bbox.south + bbox.north) / 2
  const dLat = metersToLatDelta(cellSizeM)
  const dLng = metersToLngDelta(cellSizeM, midLat)

  const cols = Math.max(3, Math.ceil((bbox.east - bbox.west) / dLng) + 1)
  const rows = Math.max(3, Math.ceil((bbox.north - bbox.south) / dLat) + 1)
  const originLat = bbox.south
  const originLng = bbox.west

  onProgress?.('Fetching water, buildings, and crossings…')
  let water: Polygon[] = []
  let buildings: Polygon[] = []
  let barriers: BarrierRoad[] = []
  let crossings: Crossing[] = []
  let osmCached = false
  try {
    const obstacles = await fetchObstacles(bbox)
    water = obstacles.water
    buildings = obstacles.buildings
    barriers = obstacles.barriers
    crossings = obstacles.crossings
    osmCached = obstacles.fromCache
    if (osmCached) onProgress?.('Using cached OSM…')
  } catch {
    // Overpass can flake; continue without OSM barriers
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
  const sampler = getElevationSampler(opts.elevZoom)
  const elev = await sampler.sampleMany(points, opts.elevZoom)

  const walkable = new Uint8Array(cols * rows)
  walkable.fill(1)
  blockPolygonsOnGrid(
    walkable,
    cols,
    rows,
    originLat,
    originLng,
    dLat,
    dLng,
    water,
    0,
  )
  blockPolygonsOnGrid(
    walkable,
    cols,
    rows,
    originLat,
    originLng,
    dLat,
    dLng,
    buildings,
    2,
  )
  applyLimitedAccess(
    walkable,
    cols,
    rows,
    originLat,
    originLng,
    dLat,
    dLng,
    cellSizeM,
    barriers,
    crossings,
  )

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
    buildings,
    barriers,
    crossings,
    osmCached,
  }
}
