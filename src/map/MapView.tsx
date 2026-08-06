import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection } from 'geojson'
import type { LatLng } from '../geo'
import type { WalkGrid } from '../route/grid'
import { cellToLatLng } from '../route/grid'
import type { RouteResult } from '../route/astar'

type Props = {
  start: LatLng | null
  end: LatLng | null
  result: RouteResult | null
  grid: WalkGrid | null
  showGrid: boolean
  onMapClick: (ll: LatLng) => void
}

const PATH_SOURCE = 'walkmode-path'
const GRID_SOURCE = 'walkmode-grid'
const WATER_SOURCE = 'walkmode-water'

export function MapView({
  start,
  end,
  result,
  grid,
  showGrid,
  onMapClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const startMarker = useRef<maplibregl.Marker | null>(null)
  const endMarker = useRef<maplibregl.Marker | null>(null)
  const onClickRef = useRef(onMapClick)
  onClickRef.current = onMapClick

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [
              'https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution: '© OpenStreetMap © CARTO',
          },
        },
        layers: [
          {
            id: 'osm',
            type: 'raster',
            source: 'osm',
          },
        ],
      },
      center: [-105.27, 40.02],
      zoom: 12,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')

    map.on('load', () => {
      map.addSource(PATH_SOURCE, {
        type: 'geojson',
        data: emptyLine(),
      })
      map.addLayer({
        id: 'path-line',
        type: 'line',
        source: PATH_SOURCE,
        paint: {
          'line-color': '#7dcfb6',
          'line-width': 4,
          'line-opacity': 0.95,
        },
      })

      map.addSource(GRID_SOURCE, {
        type: 'geojson',
        data: emptyMulti(),
      })
      map.addLayer({
        id: 'grid-points',
        type: 'circle',
        source: GRID_SOURCE,
        paint: {
          'circle-radius': 1.5,
          'circle-color': [
            'case',
            ['==', ['get', 'walkable'], 1],
            '#2d6a4f',
            '#1d3557',
          ],
          'circle-opacity': 0.45,
        },
        layout: { visibility: 'none' },
      })

      map.addSource(WATER_SOURCE, {
        type: 'geojson',
        data: emptyMultiPoly(),
      })
      map.addLayer({
        id: 'water-fill',
        type: 'fill',
        source: WATER_SOURCE,
        paint: {
          'fill-color': '#1d4e89',
          'fill-opacity': 0.25,
        },
      })
    })

    map.on('click', (e) => {
      onClickRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng })
    })

    mapRef.current = map
    return () => {
      startMarker.current?.remove()
      endMarker.current?.remove()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (start) {
      if (!startMarker.current) {
        startMarker.current = new maplibregl.Marker({ color: '#2d6a4f' })
          .setLngLat([start.lng, start.lat])
          .addTo(map)
      } else {
        startMarker.current.setLngLat([start.lng, start.lat])
      }
    } else {
      startMarker.current?.remove()
      startMarker.current = null
    }

    if (end) {
      if (!endMarker.current) {
        endMarker.current = new maplibregl.Marker({ color: '#7dcfb6' })
          .setLngLat([end.lng, end.lat])
          .addTo(map)
      } else {
        endMarker.current.setLngLat([end.lng, end.lat])
      }
    } else {
      endMarker.current?.remove()
      endMarker.current = null
    }
  }, [start, end])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      const src = map.getSource(PATH_SOURCE) as maplibregl.GeoJSONSource | undefined
      if (!src) return
      if (!result || result.path.length < 2) {
        src.setData(emptyLine())
        return
      }
      src.setData({
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: result.path.map((p) => [p.lng, p.lat]),
        },
      })
      const bounds = new maplibregl.LngLatBounds()
      for (const p of result.path) bounds.extend([p.lng, p.lat])
      map.fitBounds(bounds, { padding: 80, maxZoom: 15 })
    }
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [result])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      const gridSrc = map.getSource(GRID_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined
      const waterSrc = map.getSource(WATER_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined
      if (!gridSrc || !waterSrc) return

      if (!grid) {
        gridSrc.setData(emptyMulti())
        waterSrc.setData(emptyMultiPoly())
        return
      }

      // Subsample grid for display
      const step = Math.max(1, Math.floor(Math.max(grid.cols, grid.rows) / 80))
      const features: Feature[] = []
      for (let r = 0; r < grid.rows; r += step) {
        for (let c = 0; c < grid.cols; c += step) {
          const i = r * grid.cols + c
          const ll = cellToLatLng(grid, c, r)
          features.push({
            type: 'Feature',
            properties: { walkable: grid.walkable[i] },
            geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] },
          })
        }
      }
      gridSrc.setData({ type: 'FeatureCollection', features })

      waterSrc.setData({
        type: 'FeatureCollection',
        features: grid.water.map((poly) => ({
          type: 'Feature' as const,
          properties: {},
          geometry: {
            type: 'Polygon' as const,
            coordinates: [
              poly.outer.map((p) => [p.lng, p.lat]),
              ...poly.holes.map((h) => h.map((p) => [p.lng, p.lat])),
            ],
          },
        })),
      })
    }
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [grid])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const apply = () => {
      if (!map.getLayer('grid-points')) return
      map.setLayoutProperty(
        'grid-points',
        'visibility',
        showGrid ? 'visible' : 'none',
      )
    }
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [showGrid])

  return <div className="map" ref={containerRef} />
}

function emptyLine(): Feature {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: [] },
  }
}

function emptyMulti(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

function emptyMultiPoly(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}
