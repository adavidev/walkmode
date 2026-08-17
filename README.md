# walkmode

Bird-flies walkable routing — ignore roads, contour hills, go around buildings, and keep a distance from pins you drop.

## Run

```bash
npm install
npm run dev
```

## How it works

1. Click start, then end on the map.
2. Builds a local walkability grid from Mapzen Terrarium DEM plus OSM water and buildings (Overpass).
3. Water is impassable. Buildings are expensive, so A* prefers streets and gaps.
4. Multi-lane arterials and `foot=no` roads are crossable only at OSM crosswalks.
5. Keep-away pins (0–500 m) are hard blocks. You can drop several; they persist in this browser.
6. A* with asymmetric uphill cost prefers going around hills. The slider re-routes on the same grid.

## Deploy demo to [adavidev.github.io](https://adavidev.github.io/demos/walkmode/)

Pushing to `main` triggers a rebuild on the profile site via GitHub Actions. Add a repo secret **`SITE_DISPATCH_TOKEN`**: a fine-grained PAT with **Actions: Read and write** on `adavidev/adavidev.github.io`.

Elevation tiles and OSM polygons are cached locally so repeat routes in the same area do not hit S3/Overpass every time.

Elevation tiles: `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`
