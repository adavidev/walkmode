import { useCallback, useEffect, useState } from 'react'
import type { LatLng } from './geo'
import { MapView } from './map/MapView'
import { Controls } from './ui/Controls'
import { buildWalkGrid, nearestWalkable, type WalkGrid } from './route/grid'
import { applyKeepAway } from './route/avoid'
import { kUpFromAvoidance, type RouteResult } from './route/astar'
import { routeInWorker } from './route/runRoute'
import {
  loadKeepAwayZones,
  newKeepAwayZone,
  saveKeepAwayZones,
  type KeepAwayZone,
} from './keepaway/store'
import './App.css'

export default function App() {
  const [start, setStart] = useState<LatLng | null>(null)
  const [end, setEnd] = useState<LatLng | null>(null)
  const [keepAwayZones, setKeepAwayZones] = useState<KeepAwayZone[]>(() =>
    loadKeepAwayZones(),
  )
  const [keepAwayRadius, setKeepAwayRadius] = useState(150)
  const [placingKeepAway, setPlacingKeepAway] = useState(false)
  const [grid, setGrid] = useState<WalkGrid | null>(null)
  const [result, setResult] = useState<RouteResult | null>(null)
  const [hillAvoidance, setHillAvoidance] = useState(55)
  const [showGrid, setShowGrid] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    saveKeepAwayZones(keepAwayZones)
  }, [keepAwayZones])

  const runRoute = useCallback(
    async (
      s: LatLng,
      e: LatLng,
      avoidance: number,
      zones: KeepAwayZone[],
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

        const walkable = applyKeepAway(g.walkable, g, zones)
        const routed: WalkGrid = { ...g, walkable }

        const startCell = nearestWalkable(routed, s)
        const endCell = nearestWalkable(routed, e)
        if (!startCell || !endCell) {
          throw new Error('Start or end has no nearby walkable ground.')
        }

        setStatus('Searching path…')
        const route = await routeInWorker(routed, startCell, endCell, {
          kUp: kUpFromAvoidance(avoidance),
        })
        setResult(route)
        setStatus(
          `Done · ${route.nodesExpanded.toLocaleString()} nodes · cell ${g.cellSizeM.toFixed(0)} m · ${g.buildings.length} buildings · ${g.barriers.length} limited-access · ${g.crossings.length} crossings${g.osmCached ? ' · cached OSM' : ''}`,
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
      if (placingKeepAway) {
        setKeepAwayZones((prev) => [
          ...prev,
          newKeepAwayZone(ll.lat, ll.lng, keepAwayRadius),
        ])
        setError(null)
        setStatus(
          start && end
            ? 'Keep-away pin saved — add another or hit Route.'
            : 'Keep-away pin saved locally.',
        )
        return
      }
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
      void runRoute(start, ll, hillAvoidance, keepAwayZones, null)
    },
    [
      busy,
      placingKeepAway,
      keepAwayRadius,
      start,
      end,
      hillAvoidance,
      keepAwayZones,
      runRoute,
    ],
  )

  const onClear = () => {
    setStart(null)
    setEnd(null)
    setPlacingKeepAway(false)
    setGrid(null)
    setResult(null)
    setError(null)
    setStatus('')
  }

  const onReroute = () => {
    if (!start || !end) return
    void runRoute(start, end, hillAvoidance, keepAwayZones, grid)
  }

  const clickMode = placingKeepAway
    ? 'keep-away'
    : !start || (start && end)
      ? 'start'
      : 'end'

  return (
    <div className="app">
      <MapView
        start={start}
        end={end}
        keepAwayZones={keepAwayZones}
        result={result}
        grid={grid}
        showGrid={showGrid}
        onMapClick={onMapClick}
      />
      <Controls
        hillAvoidance={hillAvoidance}
        onHillAvoidance={setHillAvoidance}
        keepAwayRadius={keepAwayRadius}
        onKeepAwayRadius={setKeepAwayRadius}
        keepAwayZones={keepAwayZones}
        onPlaceKeepAway={() => {
          setPlacingKeepAway((on) => !on)
          setStatus(
            placingKeepAway
              ? 'Done adding keep-away pins.'
              : 'Click the map to add keep-away pins. They save in this browser.',
          )
        }}
        onRemoveZone={(id) => {
          setKeepAwayZones((prev) => prev.filter((z) => z.id !== id))
          setStatus(
            start && end
              ? 'Keep-away pin removed — hit Route.'
              : 'Keep-away pin removed.',
          )
        }}
        onClearPins={() => {
          setKeepAwayZones([])
          setPlacingKeepAway(false)
          setStatus(
            start && end
              ? 'Keep-away pins cleared — hit Route.'
              : 'Keep-away pins cleared.',
          )
        }}
        showGrid={showGrid}
        onShowGrid={setShowGrid}
        status={status}
        error={error}
        result={result}
        clickMode={clickMode}
        onClear={onClear}
        onReroute={onReroute}
        canReroute={!!start && !!end}
        busy={busy}
      />
    </div>
  )
}
