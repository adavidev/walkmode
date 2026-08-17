export type KeepAwayZone = {
  id: string
  lat: number
  lng: number
  radiusM: number
}

const KEY = 'walkmode-keepaway-v1'

export function loadKeepAwayZones(): KeepAwayZone[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (
        !item ||
        typeof item !== 'object' ||
        typeof (item as KeepAwayZone).lat !== 'number' ||
        typeof (item as KeepAwayZone).lng !== 'number' ||
        typeof (item as KeepAwayZone).radiusM !== 'number'
      ) {
        return []
      }
      const z = item as KeepAwayZone
      return [
        {
          id: typeof z.id === 'string' ? z.id : crypto.randomUUID(),
          lat: z.lat,
          lng: z.lng,
          radiusM: Math.min(500, Math.max(0, z.radiusM)),
        },
      ]
    })
  } catch {
    return []
  }
}

export function saveKeepAwayZones(zones: KeepAwayZone[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(zones))
  } catch {
    // Private mode / quota — pins still work this session.
  }
}

export function newKeepAwayZone(
  lat: number,
  lng: number,
  radiusM: number,
): KeepAwayZone {
  return { id: crypto.randomUUID(), lat, lng, radiusM }
}
