type Props = {
  elevations: number[]
  distances: number[]
}

export function ElevationProfile({ elevations, distances }: Props) {
  if (elevations.length < 2) {
    return <div className="profile empty">No profile yet</div>
  }

  const w = 320
  const h = 72
  const pad = 4
  const minE = Math.min(...elevations)
  const maxE = Math.max(...elevations)
  const range = Math.max(1, maxE - minE)
  const maxD = distances[distances.length - 1] || 1

  const points = elevations
    .map((e, i) => {
      const x = pad + (distances[i] / maxD) * (w - pad * 2)
      const y = h - pad - ((e - minE) / range) * (h - pad * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <div className="profile">
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} aria-label="Elevation profile">
        <polyline
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          points={points}
        />
      </svg>
      <div className="profile-meta">
        <span>{Math.round(minE)} m</span>
        <span>{Math.round(maxE)} m</span>
      </div>
    </div>
  )
}
