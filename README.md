# walkmode

Bird-flies walkable routing — ignore roads, contour around hills using elevation.

## Run

```bash
cd /Users/alandavis/src/prototypes/walkmode
npm install
npm run dev
```

## How it works

1. Click start, then end on the map.
2. Builds a local walkability grid from Mapzen Terrarium DEM + OSM water (Overpass).
3. A* with asymmetric uphill cost finds a path that prefers going around hills.
4. Hill-avoidance slider scales uphill penalty; **Route** re-runs search on the same grid.

Elevation tiles: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`
