import { formatDistance, formatElevation } from '../geo'
import type { RouteResult } from '../route/astar'
import { ElevationProfile } from './ElevationProfile'

type Props = {
  hillAvoidance: number
  onHillAvoidance: (v: number) => void
  showGrid: boolean
  onShowGrid: (v: boolean) => void
  status: string
  error: string | null
  result: RouteResult | null
  clickMode: 'start' | 'end'
  onClear: () => void
  onReroute: () => void
  canReroute: boolean
  busy: boolean
}

export function Controls({
  hillAvoidance,
  onHillAvoidance,
  showGrid,
  onShowGrid,
  status,
  error,
  result,
  clickMode,
  onClear,
  onReroute,
  canReroute,
  busy,
}: Props) {
  return (
    <aside className="panel">
      <header className="brand">
        <h1>walkmode</h1>
        <p>As the bird flies — contour the hills.</p>
      </header>

      <p className="hint">
        Click map to set <strong>{clickMode}</strong>
        {clickMode === 'start' ? ', then end.' : '. Path routes automatically.'}
      </p>

      <label className="slider-label">
        <span>Hill avoidance</span>
        <span className="slider-value">{hillAvoidance}</span>
      </label>
      <input
        className="slider"
        type="range"
        min={0}
        max={100}
        value={hillAvoidance}
        onChange={(e) => onHillAvoidance(Number(e.target.value))}
      />

      <label className="check">
        <input
          type="checkbox"
          checked={showGrid}
          onChange={(e) => onShowGrid(e.target.checked)}
        />
        Show grid
      </label>

      <div className="actions">
        <button type="button" onClick={onClear} disabled={busy}>
          Clear
        </button>
        <button
          type="button"
          className="primary"
          onClick={onReroute}
          disabled={!canReroute || busy}
        >
          {busy ? 'Routing…' : 'Route'}
        </button>
      </div>

      {status && <p className="status">{status}</p>}
      {error && <p className="error">{error}</p>}

      {result && (
        <div className="stats">
          <div>
            <span className="stat-label">Distance</span>
            <span>{formatDistance(result.distanceM)}</span>
          </div>
          <div>
            <span className="stat-label">Ascent</span>
            <span>{formatElevation(result.ascentM)}</span>
          </div>
          <div>
            <span className="stat-label">Descent</span>
            <span>{formatElevation(result.descentM)}</span>
          </div>
          <div>
            <span className="stat-label">Max grade</span>
            <span>{(result.maxGrade * 100).toFixed(0)}%</span>
          </div>
          <ElevationProfile
            elevations={result.elevations}
            distances={result.distances}
          />
        </div>
      )}
    </aside>
  )
}
