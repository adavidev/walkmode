import { findRoute, type RouteParams, type RouteResult } from './astar'
import type { WalkGrid } from './grid'

export type WorkerRequest = {
  id: number
  grid: {
    cols: number
    rows: number
    cellSizeM: number
    originLat: number
    originLng: number
    dLat: number
    dLng: number
    elev: Float32Array
    walkable: Uint8Array
  }
  start: { col: number; row: number }
  end: { col: number; row: number }
  params: Partial<RouteParams>
}

export type WorkerResponse =
  | { id: number; ok: true; result: RouteResult }
  | { id: number; ok: false; error: string }

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const { id, grid: g, start, end, params } = ev.data
  const grid: WalkGrid = {
    ...g,
    bbox: {
      south: g.originLat,
      west: g.originLng,
      north: g.originLat + g.rows * g.dLat,
      east: g.originLng + g.cols * g.dLng,
    },
    water: [],
    buildings: [],
    barriers: [],
    crossings: [],
    osmCached: false,
  }
  const result = findRoute(grid, start, end, params)
  if ('error' in result) {
    const res: WorkerResponse = { id, ok: false, error: result.error }
    self.postMessage(res)
    return
  }
  const res: WorkerResponse = { id, ok: true, result }
  self.postMessage(res)
}
