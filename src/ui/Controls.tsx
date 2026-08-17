import { formatDistance, formatElevation } from '../geo'
import type { KeepAwayZone } from '../keepaway/store'
import type { RouteResult } from '../route/astar'
import { ElevationProfile } from './ElevationProfile'

export type ClickMode = 'start' | 'end' | 'keep-away'

type Props = {
  hillAvoidance: number
  onHillAvoidance: (v: number) => void
  keepAwayRadius: number
  onKeepAwayRadius: (v: number) => void
  keepAwayZones: KeepAwayZone[]
  onPlaceKeepAway: () => void
  onRemoveZone: (id: string) => void
  onClearPins: () => void
  showGrid: boolean
  onShowGrid: (v: boolean) => void
  status: string
  error: string | null
  result: RouteResult | null
  clickMode: ClickMode
  onClear: () => void
  onReroute: () => void
  canReroute: boolean
  busy: boolean
}

export function Controls({
  hillAvoidance,
  onHillAvoidance,
  keepAwayRadius,
  onKeepAwayRadius,
  keepAwayZones,
  onPlaceKeepAway,
  onRemoveZone,
  onClearPins,
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
        <p>As the bird flies — contour hills, skip buildings.</p>
      </header>

      <p className="hint">
        {clickMode === 'keep-away' ? (
          <>
            Click map to <strong>add a keep-away pin</strong>. Click the
            button again when done.
          </>
        ) : (
          <>
            Click map to set <strong>{clickMode}</strong>
            {clickMode === 'start'
              ? ', then end.'
              : '. Path routes automatically.'}
          </>
        )}
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

      <label className="slider-label">
        <span>New keep-away</span>
        <span className="slider-value">{keepAwayRadius} m</span>
      </label>
      <input
        className="slider"
        type="range"
        min={0}
        max={500}
        step={10}
        value={keepAwayRadius}
        onChange={(e) => onKeepAwayRadius(Number(e.target.value))}
      />

      <div className="actions keep-away-actions">
        <button
          type="button"
          className={clickMode === 'keep-away' ? 'active' : undefined}
          onClick={onPlaceKeepAway}
          disabled={busy}
        >
          {clickMode === 'keep-away' ? 'Done adding' : 'Add keep-away'}
        </button>
        {(keepAwayZones?.length ?? 0) > 0 && (
          <button type="button" onClick={onClearPins} disabled={busy}>
            Clear pins
          </button>
        )}
      </div>

      {(keepAwayZones?.length ?? 0) > 0 && (
        <ul className="pin-list">
          {keepAwayZones.map((z, i) => (
            <li key={z.id}>
              <span>
                Pin {i + 1}
                <span className="pin-meta">{z.radiusM} m</span>
              </span>
              <button
                type="button"
                className="pin-remove"
                onClick={() => onRemoveZone(z.id)}
                disabled={busy}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

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
