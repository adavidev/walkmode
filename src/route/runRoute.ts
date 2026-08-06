import type { RouteParams, RouteResult } from './astar'
import type { WalkGrid } from './grid'
import type { WorkerRequest, WorkerResponse } from './worker'

let seq = 0

export function routeInWorker(
  grid: WalkGrid,
  start: { col: number; row: number },
  end: { col: number; row: number },
  params: Partial<RouteParams>,
): Promise<RouteResult> {
  return new Promise((resolve, reject) => {
    const id = ++seq
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    })

    const elevCopy = grid.elev.slice()
    const walkableCopy = grid.walkable.slice()

    const req: WorkerRequest = {
      id,
      grid: {
        cols: grid.cols,
        rows: grid.rows,
        cellSizeM: grid.cellSizeM,
        originLat: grid.originLat,
        originLng: grid.originLng,
        dLat: grid.dLat,
        dLng: grid.dLng,
        elev: elevCopy,
        walkable: walkableCopy,
      },
      start,
      end,
      params,
    }

    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      worker.terminate()
      const msg = ev.data
      if (msg.id !== id) return
      if (!msg.ok) {
        reject(new Error(msg.error))
        return
      }
      resolve(msg.result)
    }
    worker.onerror = (err) => {
      worker.terminate()
      reject(err)
    }

    worker.postMessage(req, [elevCopy.buffer, walkableCopy.buffer])
  })
}
