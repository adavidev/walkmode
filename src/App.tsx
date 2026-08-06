import { useCallback, useState } from 'react'
import type { LatLng } from './geo'
import { MapView } from './map/MapView'
import { Controls } from './ui/Controls'
import { buildWalkGrid, nearestWalkable, type WalkGrid } from './route/grid'
import { kUpFromAvoidance, type RouteResult } from './route/astar'
import { routeInWorker } from './route/runRoute'
import './App.css'

export default function App() {
  const [start, setStart] = useState<LatLng | null>(null)
  const [end, setEnd] = useState<LatLng | null>(null)
  const [grid, setGrid] = useState<WalkGrid | null>(null)
  const [result, setResult] = useState<RouteResult | null>(null)
  const [hillAvoidance, setHillAvoidance] = useState(55)
  const [showGrid, setShowGrid] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const runRoute = useCallback(
    async (
      s: LatLng,
      e: LatLng,
      avoidance: number,
      reuseGrid?: WalkGrid | null,
    ) => {
      setBusy(true)
      setError(null)
      setResult(null)
      try {
        let g = reuseGrid ?? null
        if (!g) {
          setStatus('Building walkability grid…')
          g = await buildWalkGrid(s, e, {}, (msg) => setStatus(msg))
          setGrid(g)
        }

        const startCell = nearestWalkable(g, s)
        const endCell = nearestWalkable(g, e)
        if (!startCell || !endCell) {
          throw new Error('Start or end has no nearby walkable ground.')
        }

        setStatus('Searching path…')
        const route = await routeInWorker(g, startCell, endCell, {
          kUp: kUpFromAvoidance(avoidance),
        })
        setResult(route)
        setStatus(
          `Done · ${route.nodesExpanded.toLocaleString()} nodes · cell ${g.cellSizeM.toFixed(0)} m`,
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setStatus('')
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const onMapClick = useCallback(
    (ll: LatLng) => {
      if (busy) return
      if (!start || (start && end)) {
        setStart(ll)
        setEnd(null)
        setResult(null)
        setGrid(null)
        setError(null)
        setStatus('Start set — click end point.')
        return
      }
      setEnd(ll)
      void runRoute(start, ll, hillAvoidance, null)
    },
    [busy, start, end, hillAvoidance, runRoute],
  )

  const onClear = () => {
    setStart(null)
    setEnd(null)
    setGrid(null)
    setResult(null)
    setError(null)
    setStatus('')
  }

  const onReroute = () => {
    if (!start || !end) return
    void runRoute(start, end, hillAvoidance, grid)
  }

  return (
    <div className="app">
      <MapView
        start={start}
        end={end}
        result={result}
        grid={grid}
        showGrid={showGrid}
        onMapClick={onMapClick}
      />
      <Controls
        hillAvoidance={hillAvoidance}
        onHillAvoidance={setHillAvoidance}
        showGrid={showGrid}
        onShowGrid={setShowGrid}
        status={status}
        error={error}
        result={result}
        clickMode={!start || (start && end) ? 'start' : 'end'}
        onClear={onClear}
        onReroute={onReroute}
        canReroute={!!start && !!end}
        busy={busy}
      />
    </div>
  )
}
