# urbanforest

A web app that visualizes street trees in urban areas, combining [ESA Copernicus](https://www.copernicus.eu/) data with OpenStreetMap.

## What it does

`urbanforest` reads the **Urban Atlas Street Tree Layer (STL)** — a Copernicus Land Monitoring Service product derived from high-resolution satellite imagery that maps contiguous rows and patches of street trees in European Functional Urban Areas ("Erfasst sogar Einzel- und Straßenbäume in städtischen Gebieten") — and renders them as an interactive map on top of an OpenStreetMap basemap.

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
  - Optional: cross-reference with OSM `natural=tree` / `landuse=forest` features

## Pipeline

1. **Fetch** — `scripts/fetch-stl.mjs` queries the Copernicus STAC API for a Functional Urban Area, gets temporary S3 credentials from the Copernicus Data Space Ecosystem, and downloads the STL FlatGeobuf.
2. **Convert** — `scripts/convert-stl.mjs` decodes the FlatGeobuf and reprojects it from EPSG:3035 to EPSG:4326 (`flatgeobuf` + `proj4`), writing GeoJSON.
3. **Serve** — the GeoJSON is placed in `public/data/` and served as a static file by PHP.
4. **Render** — `public/assets/js/app.js` loads the GeoJSON with Leaflet and draws it over an OpenStreetMap basemap.

## Run

One-time setup:

```bash
npm install
```

Fetch and convert an area (free CDSE account required):

```bash
export CDSE_USER=you@example.com
export CDSE_PASS=your-password

npm run fetch -- --fua=GOTTINGEN --list          # inspect available items
npm run fetch -- --fua=GOTTINGEN --out=data-src/gottingen-stl.fgb
npm run convert -- data-src/gottingen-stl.fgb public/data/gottingen-street-trees.geojson

npm run serve
```

Then open http://localhost:8000.

Göttingen (`public/data/gottingen-street-trees.geojson`, STL reference year 2021) is
already generated and committed, so the map shows data without rerunning the pipeline.

## Layout

```
public/            Web root
  index.php        Entry point, renders the map page
  assets/css/      Styles
  assets/js/       Leaflet map logic
  data/            Preprocessed GeoJSON layers (generated)
scripts/
  fetch-stl.mjs    Download STL data from Copernicus for an FUA
  convert-stl.mjs  Convert .fgb -> .geojson (EPSG:3035 -> 4326)
docs/
  data-access.md   How to obtain the STL data
config.php         Shared configuration
```

## Status

Working for Göttingen: STL data fetched, converted to GeoJSON, and rendered with Leaflet.
