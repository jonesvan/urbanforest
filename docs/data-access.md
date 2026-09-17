# Getting the Urban Atlas Street Tree Layer (STL)

How to obtain the ESA Copernicus **Urban Atlas Street Tree Layer** for this project.

## What the data is

- **Product:** Urban Atlas Street Tree Layer (STL)
- **Provider:** European Environment Agency (EEA) for the Copernicus Land Monitoring Service (CLMS)
- **Content:** vector polygons of contiguous rows or patches of trees over "Artificial surfaces" (nomenclature class 1) inside Functional Urban Areas (FUAs) — i.e. street trees and urban tree groups
- **Minimum Mapping Unit (MMU):** 0.05 ha (500 m²)
- **Minimum Mapping Width (MMW):** 10 m
- **Format:** FlatGeobuf (`.fgb`) in the Copernicus Data Space Ecosystem; SQLite geodatabase in the legacy CLMS portal packages
- **Native CRS:** EPSG:3035 (LAEA Europe); some legacy packages ship EPSG:32620 / 32740
- **Reference years:** 2012, 2015, 2018, 2021 (3- to 6-yearly updates)
- **Coverage:** ~788 FUAs across EEA38 + UK
- **License:** Copernicus open data

> Note: the STL is a *layer*, not a per-tree inventory. "Individual trees" appear only where a tree (group) reaches the 500 m² / 10 m thresholds. For true single-tree positions, combine with, or fall back to, OpenStreetMap `natural=tree` (see bottom).

## Official sources

| Source | URL | Notes |
| --- | --- | --- |
| Product page | https://land.copernicus.eu/en/products/urban-atlas/street-tree-layer-stl-2018 | General info, WMS, REST API, download by FUA |
| Urban Atlas (new catalogue) | https://land.copernicus.eu/en/products/urban-atlas?tab=street_tree_layer | Current product family |
| STAC API (recommended) | https://stac.dataspace.copernicus.eu/v1 | Machine access, per-FUA items |
| STAC Browser (GUI) | https://browser.stac.dataspace.copernicus.eu/collections/clms_urban-atlas_street-tree-layer_europe_V005ha_vector_static_v01 | Browse items on a map |
| EEA SDI record | https://sdi.eea.europa.eu/catalogue/copernicus/api/records/205691b3-7ae9-41dd-abf1-1fbf60d72c8c | ISO metadata, DOI `10.2909/205691b3-7ae9-41dd-abf1-1fbf60d72c8c` |
| EEA download layers (ArcGIS) | https://image.discomap.eea.europa.eu/arcgis/rest/services/DownloadLayers/UA_UrbanAtlas_2018_DL/MapServer | FUA geometry + links to packages |
| CLMS download API | https://land.copernicus.eu/en/how-to-guides (Data download API) | Pre-packaged per-FUA downloads |

## Option A — STAC API (recommended)

Collection ID:

```
clms_urban-atlas_street-tree-layer_europe_V005ha_vector_static_v01
```

### 1. Find the FUA item

Search by bounding box (`bbox=minLon,minLat,maxLon,maxLat`) and/or by item id:

```bash
# by area
curl -s "https://stac.dataspace.copernicus.eu/v1/collections/clms_urban-atlas_street-tree-layer_europe_V005ha_vector_static_v01/items?bbox=16.2,48.1,16.6,48.3&limit=5" | jq '.features[].id'

# by FUA name embedded in the item id (CQL2 filter)
curl -s -G "https://stac.dataspace.copernicus.eu/v1/collections/clms_urban-atlas_street-tree-layer_europe_V005ha_vector_static_v01/items" \
  --data-urlencode "filter=id LIKE '%WIEN%'" | jq '.features[].id'
```

The collection's queryables are limited to `id`, `datetime`, and `geometry` — the human-readable `region:name` / `fuaName` are **not** server-side filterable, which is why filtering goes through the item `id` (which encodes the FUA code and name).

Each item is one FUA and carries useful properties:

- `properties.region:name` — FUA name (e.g. `"Wien"`)
- `properties.region:country` — ISO country code
- `properties._private.odata.fuaCode` / `fuaName`
- `properties.datetime` — reference year
- `properties.proj:code` — `EPSG:3035`

Example item IDs: `CLMS_UA_STL_S2021_V005ha_AT001L1_WIEN_03035_V01_R02_20251121`

### 2. Read the asset URLs

Each item has assets:

| Asset | Content |
| --- | --- |
| `data` | Street Tree Layer, FlatGeobuf (`application/flatgeobuf`) |
| `data-urban-mask` | Urban Mask auxiliary layer (defines the FUA's urban extent) |
| `metadata` | ISO XML metadata |

The asset `href` values are S3 URIs, e.g.:

```
s3://eodata/CLMS/land_cover_use_in_priority_areas/urban_atlas/
  clms_ua_street-tree-layer_europe_V005ha_3yearly_v1/2021/01/01/
  CLMS_UA_STL_S2021_V005ha_AT001L1_WIEN_03035_V01_R02_20251121/
  CLMS_UA_STL_S2021_V005ha_AT001L1_WIEN_03035_V01_R02_20251121.fgb
```

### 3. Download

The `data` asset is a FlatGeobuf stored on the Copernicus Data Space Ecosystem object
storage. Two storage backends are advertised by the STAC item:

- `cdse-s3` → `https://eodata.dataspace.copernicus.eu` (free)
- `creodias-s3` → `https://eodata.cloudferro.com` (requester pays)

The object store is **S3**, so a plain OIDC bearer token is **not** accepted
(a bearer-authenticated request returns `403 InvalidAccessKeyId`). You need S3
access keys. Two ways to get them:

**a) Long-lived keys (dashboard):** log in at
<https://eodata-s3keysmanager.dataspace.copernicus.eu/> with your CDSE account,
click **Add Credentials**, choose an expiry, and copy the Access Key + Secret Key.

**b) Temporary keys via API** (what the pipeline uses): exchange your bearer token
for short-lived S3 credentials:

```bash
TOKEN=$(curl -s -X POST \
  "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token" \
  -d "client_id=cdse-public" \
  -d "username=$CDSE_USER" -d "password=$CDSE_PASS" \
  -d "grant_type=password" | jq -r .access_token)

curl -s -X POST "https://s3-keys-manager.cloudferro.com/api/user/credentials" \
  -H "Authorization: Bearer $TOKEN" -H "Accept: application/json"
# -> { "access_id": "...", "secret": "..." }
```

Then fetch the object with any S3 client (path-style, bucket `eodata`):

```bash
# example with the AWS CLI
AWS_ACCESS_KEY_ID=<access_id> AWS_SECRET_ACCESS_KEY=<secret> \
  aws s3 cp --endpoint-url https://eodata.dataspace.copernicus.eu \
  "s3://eodata/CLMS/land_cover_use_in_priority_areas/urban_atlas/clms_ua_street-tree-layer_europe_V005ha_3yearly_v1/2021/01/01/CLMS_UA_STL_S2021_V005ha_DE021L1_GOTTINGEN_03035_V01_R02_20251121/CLMS_UA_STL_S2021_V005ha_DE021L1_GOTTINGEN_03035_V01_R02_20251121.fgb" \
  gottingen-stl.fgb
```

> Newly created temporary keys can take a few seconds to become active; retry on the
> first `403`/`AccessDenied`.

`scripts/fetch-stl.mjs` wraps this whole flow: STAC lookup → bearer token → temporary
S3 credentials → download.

```bash
CDSE_USER=you@example.com CDSE_PASS=... \
  node scripts/fetch-stl.mjs --fua=GOTTINGEN --out=data-src/gottingen-stl.fgb
```

## Option B — Pre-packaged download (portal account)

The CLMS portal offers per-FUA packages (GPKG / SQLite geodatabase) directly, as an
alternative to STAC + S3:

1. Open https://land.copernicus.eu/en/products/urban-atlas/street-tree-layer-stl-2018
2. Under **Download → Download by area**, pick a Functional Urban Area
3. Or use **Download full dataset** / the CLMS download API for bulk

These archives are per-FUA and larger than the single STL FlatGeobuf. Direct downloads
are **not anonymous** — the API returns `401 Unauthorized` without a
`land.copernicus.eu` bearer token, and the generated download links come back through a
background job. The STAC + S3 route (Option A) is simpler to automate.

## Option C — WMS (no download, no vector)

For a quick visual overlay without vector data:

```
https://mapserver.dataspace.copernicus.eu/ogc?SERVICE=WMS
  &VERSION=1.3.0&REQUEST=GetMap
  &LAYERS=CLMS_UA_STL_S2021_V005ha
  &CRS=EPSG:3857&BBOX=...&WIDTH=256&HEIGHT=256&FORMAT=image/png
```

Available layers: `CLMS_UA_STL_S2021_V005ha` (street trees) and `CLMS_UA_UM_S2021_V005ha` (urban mask). Leaflet can consume this as a `L.tileLayer.wms`. Not used by default here (we want vector GeoJSON), but handy for comparison.

## Converting to GeoJSON

The web app consumes EPSG:4326 GeoJSON. `scripts/convert-stl.mjs` decodes the
FlatGeobuf and reprojects it, using the pure-JS `flatgeobuf` and `proj4` packages (no
GDAL required):

```bash
node scripts/convert-stl.mjs data-src/gottingen-stl.fgb public/data/gottingen-street-trees.geojson
```

The EPSG:3035 definition used for the projection is the standard ETRS89 / LAEA Europe
(`+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +units=m`).

If you have GDAL installed you can equivalently run `ogr2ogr -f GeoJSON -t_srs EPSG:4326
out.geojson in.fgb`.

## Attribute schema

Each Street Tree Layer feature carries these attributes (kept as-is by the converter):

| Field | Meaning |
| --- | --- |
| `area` | polygon area in m² (computed in EPSG:3035) |
| `perimeter` | polygon perimeter in m (EPSG:3035) |
| `country` | ISO country code, e.g. `DE` |
| `fua_code` | Functional Urban Area code, e.g. `DE021L1` |
| `fua_name` | FUA name, e.g. `GOTTINGEN` |
| `STL` | thematic class value (tree layer) |

Inspect an example:

```bash
node -e "const f=JSON.parse(require('fs').readFileSync('public/data/gottingen-street-trees.geojson','utf8')); \
  console.log(f.features[0].properties)"
```

## OpenStreetMap complement / validation

For individual trees and cross-checking coverage, use OSM:

- Overpass API query for `natural=tree` (optionally `leaf_type`, `height`, `diameter_crown`):

```bash
curl -G "https://overpass-api.de/api/interpreter" \
  --data-urlencode 'data=[out:json][timeout:60];
    node["natural"="tree"](48.1,16.2,48.3,16.6);
    out geom;'
```

- OSM basemap tiles provide the Leaflet base layer.

Comparing STL patches against OSM point trees highlights where the satellite-derived layer adds or misses street greenery.

## Licensing / attribution

Copernicus data is free to use with attribution. Cite the dataset as:

> European Environment Agency, Copernicus Land Monitoring Service — Urban Atlas Street Tree Layer, DOI 10.2909/205691b3-7ae9-41dd-abf1-1fbf60d72c8c

OpenStreetMap data: © OpenStreetMap contributors, ODbL.
