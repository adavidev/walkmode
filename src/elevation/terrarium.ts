import { latLngToTile, type LatLng } from '../geo'

const TILE_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'

function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768
}

export class ElevationSampler {
  private cache = new Map<string, ImageData>()
  private inflight = new Map<string, Promise<ImageData>>()
  private zoom: number

  constructor(zoom = 12) {
    this.zoom = zoom
  }

  private key(z: number, x: number, y: number): string {
    return `${z}/${x}/${y}`
  }

  private async loadTile(z: number, x: number, y: number): Promise<ImageData> {
    const k = this.key(z, x, y)
    const cached = this.cache.get(k)
    if (cached) return cached

    const pending = this.inflight.get(k)
    if (pending) return pending

    const promise = (async () => {
      const url = TILE_URL.replace('{z}', String(z))
        .replace('{x}', String(x))
        .replace('{y}', String(y))
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Elevation tile ${k} failed: ${res.status}`)
      const blob = await res.blob()
      const bitmap = await createImageBitmap(blob)
      const canvas = document.createElement('canvas')
      canvas.width = 256
      canvas.height = 256
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('Canvas 2D unavailable')
      ctx.drawImage(bitmap, 0, 0)
      bitmap.close()
      const data = ctx.getImageData(0, 0, 256, 256)
      this.cache.set(k, data)
      this.inflight.delete(k)
      return data
    })().catch((err) => {
      this.inflight.delete(k)
      throw err
    })

    this.inflight.set(k, promise)
    return promise
  }

  async sample(point: LatLng, zoom = this.zoom): Promise<number> {
    const { x, y, px, py } = latLngToTile(point.lat, point.lng, zoom)
    const data = await this.loadTile(zoom, x, y)
    const ix = Math.min(255, Math.max(0, Math.floor(px)))
    const iy = Math.min(255, Math.max(0, Math.floor(py)))
    const i = (iy * 256 + ix) * 4
    return decodeTerrarium(data.data[i], data.data[i + 1], data.data[i + 2])
  }

  async sampleMany(points: LatLng[], zoom = this.zoom): Promise<Float32Array> {
    const out = new Float32Array(points.length)
    // Prefetch unique tiles
    const tiles = new Set<string>()
    for (const p of points) {
      const t = latLngToTile(p.lat, p.lng, zoom)
      tiles.add(this.key(zoom, t.x, t.y))
    }
    await Promise.all(
      [...tiles].map((k) => {
        const [z, x, y] = k.split('/').map(Number)
        return this.loadTile(z, x, y)
      }),
    )
    for (let i = 0; i < points.length; i++) {
      out[i] = await this.sample(points[i], zoom)
    }
    return out
  }

  clear(): void {
    this.cache.clear()
  }
}
