import { equirectMeters, type LatLng } from '../geo'
import { cellToLatLng, indexOf, type WalkGrid } from './grid'

export type RouteParams = {
  kUp: number
  kDown: number
  cliffGrade: number
  maxNodes: number
}

export const DEFAULT_ROUTE_PARAMS: RouteParams = {
  kUp: 8,
  kDown: 0.4,
  cliffGrade: 0.4,
  maxNodes: 250_000,
}

/** Map hill-avoidance slider 0..100 → kUp. */
export function kUpFromAvoidance(slider: number): number {
  // 0 → mild (2), 50 → default (8), 100 → aggressive (28)
  const t = Math.min(100, Math.max(0, slider)) / 100
  return 2 + t * 26
}

export type RouteResult = {
  path: LatLng[]
  colsRows: { col: number; row: number }[]
  distanceM: number
  ascentM: number
  descentM: number
  maxGrade: number
  elevations: number[]
  distances: number[]
  nodesExpanded: number
}

const NEIGHBORS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
]

function edgeCost(
  dist: number,
  dElev: number,
  params: RouteParams,
): number | null {
  if (dist <= 0) return null
  const grade = Math.abs(dElev) / dist
  if (grade > params.cliffGrade) return null
  if (dElev > 0) {
    return dist * (1 + params.kUp * (dElev / dist))
  }
  return dist * (1 + params.kDown * (-dElev / dist))
}

class MinHeap {
  private data: { i: number; f: number }[] = []

  get size(): number {
    return this.data.length
  }

  push(i: number, f: number): void {
    this.data.push({ i, f })
    this.bubbleUp(this.data.length - 1)
  }

  pop(): { i: number; f: number } | undefined {
    if (this.data.length === 0) return undefined
    const top = this.data[0]
    const last = this.data.pop()!
    if (this.data.length > 0) {
      this.data[0] = last
      this.bubbleDown(0)
    }
    return top
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >> 1
      if (this.data[parent].f <= this.data[idx].f) break
      ;[this.data[parent], this.data[idx]] = [this.data[idx], this.data[parent]]
      idx = parent
    }
  }

  private bubbleDown(idx: number): void {
    const n = this.data.length
    while (true) {
      let smallest = idx
      const l = idx * 2 + 1
      const r = l + 1
      if (l < n && this.data[l].f < this.data[smallest].f) smallest = l
      if (r < n && this.data[r].f < this.data[smallest].f) smallest = r
      if (smallest === idx) break
      ;[this.data[smallest], this.data[idx]] = [
        this.data[idx],
        this.data[smallest],
      ]
      idx = smallest
    }
  }
}

export function findRoute(
  grid: WalkGrid,
  start: { col: number; row: number },
  end: { col: number; row: number },
  params: Partial<RouteParams> = {},
): RouteResult | { error: string } {
  const p = { ...DEFAULT_ROUTE_PARAMS, ...params }
  const startI = indexOf(grid, start.col, start.row)
  const endI = indexOf(grid, end.col, end.row)

  if (!grid.walkable[startI]) {
    return { error: 'Start is not walkable (water or blocked).' }
  }
  if (!grid.walkable[endI]) {
    return { error: 'End is not walkable (water or blocked).' }
  }

  const n = grid.cols * grid.rows
  const gScore = new Float64Array(n).fill(Infinity)
  const cameFrom = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)
  const open = new MinHeap()

  const endLL = cellToLatLng(grid, end.col, end.row)
  const heuristic = (col: number, row: number): number => {
    const ll = cellToLatLng(grid, col, row)
    return equirectMeters(ll, endLL)
  }

  gScore[startI] = 0
  open.push(startI, heuristic(start.col, start.row))

  let nodesExpanded = 0

  while (open.size > 0) {
    const current = open.pop()!
    if (closed[current.i]) continue
    closed[current.i] = 1
    nodesExpanded++
    if (nodesExpanded > p.maxNodes) {
      return { error: 'Search budget exceeded — try a shorter span.' }
    }
    if (current.i === endI) break

    const c = current.i % grid.cols
    const r = (current.i / grid.cols) | 0
    const elevA = grid.elev[current.i]
    const llA = cellToLatLng(grid, c, r)

    for (const [dc, dr] of NEIGHBORS) {
      const nc = c + dc
      const nr = r + dr
      if (nc < 0 || nr < 0 || nc >= grid.cols || nr >= grid.rows) continue
      const ni = indexOf(grid, nc, nr)
      if (closed[ni] || !grid.walkable[ni]) continue

      const llB = cellToLatLng(grid, nc, nr)
      const dist = equirectMeters(llA, llB)
      const dElev = grid.elev[ni] - elevA
      const step = edgeCost(dist, dElev, p)
      if (step == null) continue

      const tentative = gScore[current.i] + step
      if (tentative >= gScore[ni]) continue
      cameFrom[ni] = current.i
      gScore[ni] = tentative
      open.push(ni, tentative + heuristic(nc, nr))
    }
  }

  if (cameFrom[endI] === -1 && startI !== endI) {
    return { error: 'No walkable path found.' }
  }

  const indices: number[] = []
  let cur = endI
  indices.push(cur)
  while (cur !== startI) {
    cur = cameFrom[cur]
    if (cur < 0) {
      return { error: 'No walkable path found.' }
    }
    indices.push(cur)
  }
  indices.reverse()

  const path: LatLng[] = []
  const colsRows: { col: number; row: number }[] = []
  const elevations: number[] = []
  const distances: number[] = [0]
  let distanceM = 0
  let ascentM = 0
  let descentM = 0
  let maxGrade = 0

  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i]
    const col = idx % grid.cols
    const row = (idx / grid.cols) | 0
    const ll = cellToLatLng(grid, col, row)
    path.push(ll)
    colsRows.push({ col, row })
    elevations.push(grid.elev[idx])
    if (i > 0) {
      const prev = path[i - 1]
      const stepDist = equirectMeters(prev, ll)
      distanceM += stepDist
      distances.push(distanceM)
      const dElev = elevations[i] - elevations[i - 1]
      if (dElev > 0) ascentM += dElev
      else descentM += -dElev
      if (stepDist > 0) {
        maxGrade = Math.max(maxGrade, Math.abs(dElev) / stepDist)
      }
    }
  }

  return {
    path,
    colsRows,
    distanceM,
    ascentM,
    descentM,
    maxGrade,
    elevations,
    distances,
    nodesExpanded,
  }
}
