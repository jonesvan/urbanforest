# urbanforest

A web app that visualizes street trees in urban areas, combining [ESA Copernicus](https://www.copernicus.eu/) data with OpenStreetMap.

## What it does

`urbanforest` renders street and urban trees as an interactive MapLibre GL JS (WebGL) map over an [OpenFreeMap](https://openfreemap.org/) vector basemap (OpenStreetMap data). A **Base map** picker in the Layers sheet switches between several vector styles (Positron, Liberty, Bright, Dark, Fiord, and VersaTiles' *Colorful*) and the official **LGLN DOP20 airborne orthophoto** (Lower Saxony, 20 cm, open data; proxied to Web-Mercator by `public/tiles/dop20.php`). It combines three layers:

- **Tree patches** from the **Urban Atlas Street Tree Layer (STL)** — a Copernicus Land Monitoring Service product derived from high-resolution satellite imagery, mapping contiguous rows and patches of trees in European Functional Urban Areas ("Erfasst sogar Einzel- und Straßenbäume in städtischen Gebieten").
- **Individual trees** from **OpenStreetMap** (`natural=tree` nodes) — one point per mapped tree.
- **Detected tree crowns** from **LiDAR** (`DOM1 − DGM1` canopy height model + watershed) — served as MVT vector tiles and as a read-only GeoJSON API (`/api/trees/`).

> The STL is a *patch* product: its Minimum Mapping Unit is 0.05 ha (500 m²) with a 10 m minimum width, so a lone tree only appears where it reaches that size. The goal of showing **every individual tree** is therefore served by the OSM point layer, with the STL providing the satellite-derived picture of tree cover.

## Stack

- **Web app:** PHP (`public/index.php`), HTML, CSS, vanilla JavaScript + [MapLibre GL JS](https://maplibre.org/)
- **Data pipeline:** Node scripts (`scripts/*.mjs`) run once, offline
- **Data format:** preprocessed GeoJSON (WGS84 / EPSG:4326) + MVT vector tiles, served as static files

No build step and no JS framework in the frontend — a PHP-served site with MapLibre GL JS
consuming preprocessed MVT tiles and GeoJSON. Node is only used for the offline data pipeline.

## Data sources

- **ESA Copernicus Land Monitoring Service — Urban Atlas Street Tree Layer (STL)**
  - Provider: European Environment Agency (EEA) / CLMS
  - Spatial representation: **vector** (FlatGeobuf `.fgb`), native CRS **EPSG:3035**
  - Minimum Mapping Unit: 0.05 ha (500 m²); Minimum Mapping Width: 10 m
  - Coverage: ~788 Functional Urban Areas (FUAs) across Europe
  - Reference years: 2012, 2015, 2018, 2021 (3–6 yearly updates)
  - License: Copernicus open data
  - Access details: see [`docs/data-access.md`](docs/data-access.md)
- **OpenStreetMap (OSM)**
  - Basemap tiles
  - **Individual trees** as `natural=tree` nodes (via the Overpass API) — one point per tree
  - Optional attributes: `species`, `genus`, `leaf_type`, `height`, `circumference`, …
- **LGLN OpenGeoData — LiDAR terrain/surface models** (Lower Saxony, open)
  - DOM1 − DGM1 → 1 m **canopy height model** used to detect individual tree crowns
  - Public Cloud-Optimized GeoTIFFs via STAC (`dom.stac.lgln.niedersachsen.de`, `dgm.stac.lgln.niedersachsen.de`)
  - Leaf-independent (works with the leaf-off DOP20 flights)

## Pipeline

Tree patches (Copernicus STL):

1. **Fetch** — `scripts/fetch-stl.mjs` queries the Copernicus STAC API for a Functional Urban Area, gets temporary S3 credentials from the Copernicus Data Space Ecosystem, and downloads the STL FlatGeobuf.
2. **Convert** — `scripts/convert-stl.mjs` decodes the FlatGeobuf and reprojects it from EPSG:3035 to EPSG:4326 (`flatgeobuf` + `proj4`), writing GeoJSON.

Individual trees (OpenStreetMap):

3. **Fetch** — `scripts/fetch-osm-trees.mjs` queries the Overpass API for `natural=tree` nodes in a bounding box and writes them as GeoJSON points.

Render:

4. **Serve** — both GeoJSON files are placed in `public/data/` and served statically by PHP.
5. **Render** — `public/assets/js/app.js` draws patches as filled polygons and trees as point markers, with popups.

## Run

One-time setup:

```bash
npm install
```

Fetch and convert an area (free CDSE account required for STL):

```bash
export CDSE_USER=you@example.com
export CDSE_PASS=your-password

npm run fetch -- --fua=GOTTINGEN --list          # inspect available items
npm run fetch -- --fua=GOTTINGEN --out=data-src/gottingen-stl.fgb
npm run convert -- data-src/gottingen-stl.fgb public/data/gottingen-street-trees.geojson
```

Fetch individual trees (no account needed):

```bash
npm run fetch:trees -- --out=public/data/gottingen-trees.geojson
```

Detect tree crowns from LiDAR (Python env via `uv`):

```bash
uv venv --python 3.11 .venv
uv pip install --python .venv scikit-image                    # deepforest only for the RGB route
.venv/bin/python scripts/build-chm.py --bbox=51.520,9.915,51.545,9.955 --out-dir data-src/chm-dom1
node scripts/fetch-osm-buildings.mjs --bbox=51.520,9.915,51.545,9.955 --out=data-src/buildings.geojson
.venv/bin/python scripts/detect-crowns.py --input-dir data-src/chm-dom1 \
  --buildings data-src/buildings.geojson --output data-src/gottingen-crowns-full.geojson
npm run tiles -- --input=data-src/gottingen-crowns-full.geojson --out-dir=public/tiles/crowns
npm run tiles:trees -- --input=data-src/gottingen-crowns-full.geojson --out-dir=public/data/trees
```

Fetch the Copernicus climate fields (CO₂ + 2 m temperature heatmap overlays, both **off** by default):

```bash
# key-free: CAMS surface CO2 + ERA5 2 m temperature via Open-Meteo (needs numpy)
uv pip install --python .venv numpy    # only numpy; the default backend is stdlib otherwise
npm run fetch:climate -- --bbox=9.0,51.0,11.0,52.0 --date=2026-09-10 --time=12:00

# or straight from the Copernicus Climate/Atmosphere Data Stores (free accounts):
uv pip install --python .venv cdsapi xarray netcdf4
export CDSAPI_KEY=<token>   # https://cds.climate.copernicus.eu  (ERA5)
export ADSAPI_KEY=<token>   # https://ads.atmosphere.copernicus.eu  (CAMS)
.venv/bin/python scripts/fetch-climate.py --source=cds \\
  --bbox=9.0,51.0,11.0,52.0 --date=2026-09-10 --time=12:00
```

The coarse model grid (~25 km ERA5, ~11 km CAMS) is inverse-distance interpolated onto a
2048-px raster and written as a georeferenced PNG — `public/data/gottingen-temperature.png`
and `public/data/gottingen-co2.png` — that MapLibre draws as an `image` overlay above the
basemap. A plain GeoJSON copy of the source cells is saved under `data-src/climate/`. Both
layers are regional fields, not urban measurements, and appear in the Layers sheet switched
off. The Göttingen images are committed, so the layers work without rerunning the pipeline.

Serve:

```bash
npm run serve
```

Then open http://localhost:8000.

Göttingen is pre-generated and committed — `public/data/gottingen-street-trees.geojson`
(STL 2021, 8,824 tree patches), `public/data/gottingen-trees.geojson` (23,746 individual
OSM trees) and `public/tiles/crowns/` (**905,088 LiDAR-detected crowns** covering the whole
city boundary, as vector tiles) — so the map shows data without rerunning the pipeline.
The same crowns back the public API as gzipped per-tile GeoJSON in `public/data/trees/`.

The map view and basemap can be set via URL, e.g.
`?lat=51.5336&lng=9.9352&zoom=16&style=liberty` or `?basemap=aerial`.
`style` accepts any key from `map.style_options` (positron, liberty, bright, dark, fiord, colorful).

## Public API

Read-only GeoJSON API for the detected individual trees (LiDAR crown centroids):

```
GET /api/trees/?bbox=minLon,minLat,maxLon,maxLat[&limit=1000]
```

- `bbox` (required) — WGS84 degrees, `minLon,minLat,maxLon,maxLat`.
- `limit` — maximum features to return (default 1000, max 10000).
- Response: `application/geo+json` `FeatureCollection`; each feature is one detected
  crown located at its centroid, with `height_max` (m) and `area_m2` properties.
- CORS enabled (`Access-Control-Allow-Origin: *`), no key required.

```bash
curl "https://urbanforest.fly.dev/api/trees/?bbox=9.93,51.53,9.94,51.54&limit=3"
```

It is backed by gzipped per-tile GeoJSON under `public/data/trees/`, built with
`npm run tiles:trees`. Rendered documentation with a live "try it" form:
**https://urbanforest.fly.dev/api/** (source [`public/api/index.php`](public/api/index.php));
full reference: [`docs/api.md`](docs/api.md).

## Deploy

Deployed to Fly.io: **https://urbanforest.fly.dev**

- `Dockerfile` — `php:8.4-apache`, DocumentRoot `public/`, gzip for JSON.
- `fly.toml` — app `urbanforest`, region `fra`, auto stop/start, 256 MB.
- `.github/workflows/deploy.yml` — deploys on every push to `main` (and on demand)
  with `flyctl deploy --remote-only`.

One-time setup (already done for this repo):

```bash
flyctl apps create urbanforest
flyctl tokens create deploy --app urbanforest | gh secret set FLY_API_TOKEN --repo jonesvan/urbanforest
```

## Layout

```
public/            Web root
  index.php        Entry point, renders the map page
  api/trees/       Public read-only trees API (GeoJSON)
  assets/css/      Styles
  assets/js/       MapLibre GL JS map logic
  data/            Preprocessed GeoJSON layers (generated)
  data/trees/      Gzipped per-tile GeoJSON backing /api/trees/ (generated)
public/tiles/
  crowns/          Vector tiles (MVT) for the detected tree crowns (z13–z17, polygons)
  crown-points/    Low-zoom crown centroids (z6–z12), drawn as dots
  dop20.php        Web-Mercator tile proxy for the LGLN DOP20 aerial basemap
scripts/
  fetch-stl.mjs          Download STL tree patches from Copernicus for an FUA
  convert-stl.mjs        Convert .fgb -> .geojson (EPSG:3035 -> 4326)
  fetch-osm-trees.mjs    Download individual OSM trees as GeoJSON points
  fetch-osm-buildings.mjs Download OSM building footprints (used as a mask)
  fetch-dop20.mjs        Download DOP10/DOP20 orthophoto tiles via the LGLN STAC
  fetch-climate.py       Fetch ERA5 temperature + CAMS CO2 and render heatmap PNGs
  build-chm.py           Build a canopy height model (DOM1 - DGM1) from STAC COGs
  detect-crowns.py       Detect individual tree crowns from a CHM (watershed)
  build-crown-tiles.mjs  Tile a crown GeoJSON into MVT vector tiles
  build-tree-tiles.mjs   Tile crowns into gzipped per-tile GeoJSON for the API
  detect-trees.py        DeepForest RGB detection (experimental, failed on leaf-off)
docs/
  api.md              Public trees API reference
  data-access.md      How to obtain the STL data
  tree-detection.md   Scope + results for detecting every individual tree
  future-tasks.md     Performance, data-source and model decisions ahead
  webgl-performance.md GPU rendering research + MapLibre migration notes
config.php            Shared configuration
```

## Status

Working for Göttingen: STL tree patches, 23,746 individual OSM trees, and LiDAR-detected
tree crowns, rendered with MapLibre GL JS (WebGL).

Detection route (see [`docs/tree-detection.md`](docs/tree-detection.md)):
- RGB crown detection (DeepForest on DOP20) failed because the flights are leaf-off.
- **LiDAR CHM (`DOM1 − DGM1`) + watershed works** — 88% of OSM trees fall inside a
  detected crown (vs 11% for RGB), with OSM building footprints used as a mask.
- Crowns are served as **vector tiles** (`public/tiles/crowns`, 905,088 crowns across the
  city boundary, zooms 13–17) so the browser only fetches the tiles in view, and exposed
  through a public GeoJSON API at `/api/trees/`.

## Goals

- Show **all individual trees** on the map (OSM), backed by satellite-derived tree patches (Copernicus STL).
- Detect the trees OSM misses from open 20 cm aerial imagery — see [`docs/tree-detection.md`](docs/tree-detection.md).
- Enable comparison of Copernicus STL against OpenStreetMap tree coverage.
- Provide reusable open data exports (GeoJSON).
