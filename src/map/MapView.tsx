import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Feature, FeatureCollection } from 'geojson'
import type { LatLng } from '../geo'
import { circleRing } from '../geo'
import type { WalkGrid } from '../route/grid'
import { cellToLatLng } from '../route/grid'
import type { RouteResult } from '../route/astar'
import type { KeepAwayZone } from '../keepaway/store'
import type { BarrierRoad, Crossing, Polygon } from '../osm/overpass'

type Props = {
  start: LatLng | null
  end: LatLng | null
  keepAwayZones: KeepAwayZone[]
  result: RouteResult | null
  grid: WalkGrid | null
  showGrid: boolean
  onMapClick: (ll: LatLng) => void
}

const PATH_SOURCE = 'walkmode-path'
const GRID_SOURCE = 'walkmode-grid'
const WATER_SOURCE = 'walkmode-water'
const BUILDING_SOURCE = 'walkmode-buildings'
const BARRIER_SOURCE = 'walkmode-barriers'
const CROSSING_SOURCE = 'walkmode-crossings'
const KEEP_AWAY_SOURCE = 'walkmode-keepaway'

export function MapView({
  start,
  end,
  keepAwayZones,
  result,
  grid,
  showGrid,
  onMapClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const startMarker = useRef<maplibregl.Marker | null>(null)
  const endMarker = useRef<maplibregl.Marker | null>(null)
  const keepAwayMarkers = useRef<maplibregl.Marker[]>([])
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

      map.addSource(BUILDING_SOURCE, {
        type: 'geojson',
        data: emptyMultiPoly(),
      })
      map.addLayer({
        id: 'building-fill',
        type: 'fill',
        source: BUILDING_SOURCE,
        paint: {
          'fill-color': '#c17f59',
          'fill-opacity': 0.4,
        },
      })
      map.addLayer({
        id: 'building-outline',
        type: 'line',
        source: BUILDING_SOURCE,
        paint: {
          'line-color': '#8a4b2e',
          'line-width': 1,
          'line-opacity': 0.7,
        },
      })

      map.addSource(BARRIER_SOURCE, {
        type: 'geojson',
        data: emptyMulti(),
      })
      map.addLayer({
        id: 'barrier-line',
        type: 'line',
        source: BARRIER_SOURCE,
        paint: {
          'line-color': '#3d405b',
          'line-width': 6,
          'line-opacity': 0.45,
        },
      })

      map.addSource(CROSSING_SOURCE, {
        type: 'geojson',
        data: emptyMulti(),
      })
      map.addLayer({
        id: 'crossing-line',
        type: 'line',
        source: CROSSING_SOURCE,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: {
          'line-color': '#e9c46a',
          'line-width': 5,
          'line-opacity': 0.9,
        },
      })
      map.addLayer({
        id: 'crossing-point',
        type: 'circle',
        source: CROSSING_SOURCE,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-color': '#e9c46a',
          'circle-radius': 5,
          'circle-opacity': 0.9,
          'circle-stroke-color': '#7dcfb6',
          'circle-stroke-width': 1.5,
        },
      })

      map.addSource(KEEP_AWAY_SOURCE, {
        type: 'geojson',
        data: emptyMultiPoly(),
      })
      map.addLayer({
        id: 'keepaway-fill',
        type: 'fill',
        source: KEEP_AWAY_SOURCE,
        paint: {
          'fill-color': '#9b2226',
          'fill-opacity': 0.22,
        },
      })
      map.addLayer({
        id: 'keepaway-outline',
        type: 'line',
        source: KEEP_AWAY_SOURCE,
        paint: {
          'line-color': '#9b2226',
          'line-width': 2,
          'line-opacity': 0.85,
        },
      })

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
            ['==', ['get', 'walkable'], 2],
            '#c17f59',
            '#1d3557',
          ],
          'circle-opacity': 0.45,
        },
        layout: { visibility: 'none' },
      })
    })

    map.on('click', (e) => {
      onClickRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng })
    })

    mapRef.current = map
    return () => {
      startMarker.current?.remove()
      endMarker.current?.remove()
      for (const m of keepAwayMarkers.current) m.remove()
      keepAwayMarkers.current = []
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

    for (const m of keepAwayMarkers.current) m.remove()
    keepAwayMarkers.current = (keepAwayZones ?? []).map((z) =>
      new maplibregl.Marker({ color: '#9b2226' })
        .setLngLat([z.lng, z.lat])
        .addTo(map),
    )

    const apply = () => {
      const src = map.getSource(KEEP_AWAY_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined
      if (!src) return
      const features = (keepAwayZones ?? [])
        .filter((z) => z.radiusM > 0)
        .map((z) => {
          const ring = circleRing({ lat: z.lat, lng: z.lng }, z.radiusM)
          return {
            type: 'Feature' as const,
            properties: {},
            geometry: {
              type: 'Polygon' as const,
              coordinates: [ring.map((p) => [p.lng, p.lat])],
            },
          }
        })
      src.setData({ type: 'FeatureCollection', features })
    }
    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [keepAwayZones])

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
      if (
        bounds.getWest() === bounds.getEast() ||
        bounds.getSouth() === bounds.getNorth()
      ) {
        const c = bounds.getCenter()
        bounds.extend([c.lng - 0.002, c.lat - 0.002])
        bounds.extend([c.lng + 0.002, c.lat + 0.002])
      }
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
      const buildingSrc = map.getSource(BUILDING_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined
      const barrierSrc = map.getSource(BARRIER_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined
      const crossingSrc = map.getSource(CROSSING_SOURCE) as
        | maplibregl.GeoJSONSource
        | undefined
      if (!gridSrc || !waterSrc || !buildingSrc || !barrierSrc || !crossingSrc) {
        return
      }

      if (!grid) {
        gridSrc.setData(emptyMulti())
        waterSrc.setData(emptyMultiPoly())
        buildingSrc.setData(emptyMultiPoly())
        barrierSrc.setData(emptyMulti())
        crossingSrc.setData(emptyMulti())
        return
      }

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
      waterSrc.setData(polygonsToCollection(grid.water))
      buildingSrc.setData(polygonsToCollection(grid.buildings))
      barrierSrc.setData(barriersToCollection(grid.barriers ?? []))
      crossingSrc.setData(crossingsToCollection(grid.crossings ?? []))
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

function barriersToCollection(roads: BarrierRoad[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: roads.map((road) => ({
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: road.points.map((p) => [p.lng, p.lat]),
      },
    })),
  }
}

function crossingsToCollection(crossings: Crossing[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: crossings.map((x) =>
      x.points.length > 1
        ? {
            type: 'Feature' as const,
            properties: {},
            geometry: {
              type: 'LineString' as const,
              coordinates: x.points.map((p) => [p.lng, p.lat]),
            },
          }
        : {
            type: 'Feature' as const,
            properties: {},
            geometry: {
              type: 'Point' as const,
              coordinates: [x.points[0].lng, x.points[0].lat],
            },
          },
    ),
  }
}

function polygonsToCollection(polygons: Polygon[]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: polygons.map((poly) => ({
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
  }
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
