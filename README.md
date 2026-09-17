# urbanforest

A web app that visualizes street trees in urban areas, combining [ESA Copernicus](https://www.copernicus.eu/) data with OpenStreetMap.

## What it does

`urbanforest` renders street and urban trees as an interactive Leaflet map over an OpenStreetMap basemap. It combines two layers:

- **Tree patches** from the **Urban Atlas Street Tree Layer (STL)** — a Copernicus Land Monitoring Service product derived from high-resolution satellite imagery, mapping contiguous rows and patches of trees in European Functional Urban Areas ("Erfasst sogar Einzel- und Straßenbäume in städtischen Gebieten").
- **Individual trees** from **OpenStreetMap** (`natural=tree` nodes) — one point per mapped tree.

> The STL is a *patch* product: its Minimum Mapping Unit is 0.05 ha (500 m²) with a 10 m minimum width, so a lone tree only appears where it reaches that size. The goal of showing **every individual tree** is therefore served by the OSM point layer, with the STL providing the satellite-derived picture of tree cover.

## Stack

- **Web app:** PHP (`public/index.php`), HTML, CSS, vanilla JavaScript + [Leaflet](https://leafletjs.com/)
- **Data pipeline:** Node scripts (`scripts/*.mjs`) run once, offline
- **Data format:** preprocessed GeoJSON (WGS84 / EPSG:4326) served as static files

No build step and no JS framework in the frontend — a PHP-served site with Leaflet
consuming preprocessed GeoJSON. Node is only used for the offline data pipeline.

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

Serve:

```bash
npm run serve
```

Then open http://localhost:8000.

Göttingen is pre-generated and committed — `public/data/gottingen-street-trees.geojson`
(STL 2021, 8,824 tree patches) and `public/data/gottingen-trees.geojson` (23,746
individual OSM trees) — so the map shows data without rerunning the pipeline.

## Layout

```
public/            Web root
  index.php        Entry point, renders the map page
  assets/css/      Styles
  assets/js/       Leaflet map logic
  data/            Preprocessed GeoJSON layers (generated)
scripts/
  fetch-stl.mjs       Download STL tree patches from Copernicus for an FUA
  convert-stl.mjs     Convert .fgb -> .geojson (EPSG:3035 -> 4326)
  fetch-osm-trees.mjs Download individual OSM trees as GeoJSON points
  fetch-dop20.mjs     Download LGLN DOP20 orthophoto tiles for a bbox
  detect-trees.py     DeepForest tree-crown detection (experimental, see docs)
docs/
  data-access.md      How to obtain the STL data
  tree-detection.md   Scope + M1 results for detecting every individual tree
config.php            Shared configuration
```

## Status

Working for Göttingen: STL tree patches and 23,746 individual OSM trees, rendered with
Leaflet.

**Detection experiment (unfinished):** the pretrained DeepForest crown model was run on
LGLN DOP20 imagery, but the available flight is **leaf-off** (2022-03-03), so the
detections are unreliable and are not served by the app. See
[`docs/tree-detection.md`](docs/tree-detection.md) for the M1 result and the recommended
LiDAR (DOM1−DGM1) route.

## Goals

- Show **all individual trees** on the map (OSM), backed by satellite-derived tree patches (Copernicus STL).
- Detect the trees OSM misses from open 20 cm aerial imagery — see [`docs/tree-detection.md`](docs/tree-detection.md).
- Enable comparison of Copernicus STL against OpenStreetMap tree coverage.
- Provide reusable open data exports (GeoJSON).
