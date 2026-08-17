import {
  haversineMeters,
  metersToLatDelta,
  metersToLngDelta,
  type LatLng,
} from '../geo'
import type { KeepAwayZone } from '../keepaway/store'
import { cellToLatLng, indexOf, type WalkGrid } from './grid'

function blockRadius(
  copy: Uint8Array,
  grid: WalkGrid,
  center: LatLng,
  radiusM: number,
): void {
  const latPad = metersToLatDelta(radiusM)
  const lngPad = metersToLngDelta(radiusM, center.lat)
  const c0 = Math.max(
    0,
    Math.floor((center.lng - lngPad - grid.originLng) / grid.dLng) - 1,
  )
  const c1 = Math.min(
    grid.cols - 1,
    Math.ceil((center.lng + lngPad - grid.originLng) / grid.dLng) + 1,
  )
  const r0 = Math.max(
    0,
    Math.floor((center.lat - latPad - grid.originLat) / grid.dLat) - 1,
  )
  const r1 = Math.min(
    grid.rows - 1,
    Math.ceil((center.lat + latPad - grid.originLat) / grid.dLat) + 1,
  )

  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = indexOf(grid, c, r)
      if (!copy[i]) continue
      if (haversineMeters(cellToLatLng(grid, c, r), center) <= radiusM) {
        copy[i] = 0
      }
    }
  }
}

/** Copy walkable and hard-block cells inside any keep-away zone. */
export function applyKeepAway(
  walkable: Uint8Array,
  grid: WalkGrid,
  zones: KeepAwayZone[],
): Uint8Array {
  const copy = walkable.slice()
  for (const z of zones) {
    if (z.radiusM <= 0) continue
    blockRadius(copy, grid, { lat: z.lat, lng: z.lng }, z.radiusM)
  }
  return copy
}
