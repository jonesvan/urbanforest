# Trees API

Read-only HTTP API for the detected individual trees (LiDAR crown centroids). No key,
CORS enabled.

```
GET /api/trees/?bbox=minLon,minLat,maxLon,maxLat[&limit=1000]
```

Base URL: `https://urbanforest.fly.dev` (local: `http://localhost:8000`).

## Parameters

| Name | Required | Description |
| --- | --- | --- |
| `bbox` | yes | Bounding box in WGS84 degrees: `minLon,minLat,maxLon,maxLat`. Must satisfy `minLon < maxLon` and `minLat < maxLat`. |
| `limit` | no | Maximum number of features to return. Default `1000`, maximum `10000`. |

The bbox may span at most 256 internal tiles (~600 km²). Narrow it for larger areas.

## Response

`Content-Type: application/geo+json`. A GeoJSON `FeatureCollection`:

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "height_max": 22.21, "area_m2": 197 },
      "geometry": { "type": "Point", "coordinates": [9.931524, 51.537258] }
    }
  ],
  "numberReturned": 1,
  "limit": 1000,
  "bbox": [9.93, 51.53, 9.94, 51.54]
}
```

Each feature is one detected tree crown, located at its **centroid**:

| Property | Type | Description |
| --- | --- | --- |
| `height_max` | number \| null | Highest CHM pixel in the crown (m above ground). |
| `area_m2` | number \| null | Crown area (m²). |

Foreign members: `numberReturned` (features in this response), `limit` (effective limit),
`bbox` (echo of the requested box).

## Examples

```bash
# a few trees around the Göttingen centre
curl "https://urbanforest.fly.dev/api/trees/?bbox=9.93,51.53,9.94,51.54&limit=3"
```

```js
const url = 'https://urbanforest.fly.dev/api/trees/?bbox=9.93,51.53,9.94,51.54&limit=1000';
const trees = await (await fetch(url)).json();
console.log(trees.numberReturned, trees.features[0].properties);
```

```python
import geopandas as gpd
gdf = gpd.read_file(
    "https://urbanforest.fly.dev/api/trees/?bbox=9.93,51.53,9.94,51.54&limit=10000"
)
```

## Errors

Errors are JSON (`{"error": "..."}`) with a `4xx` status:

| Status | Cause |
| --- | --- |
| `400` | Missing/invalid `bbox`, or the box spans more than 256 tiles. |
| `405` | Method other than `GET`/`HEAD`/`OPTIONS`. |

## Data & pipeline

- Source: LGLN OpenGeoData LiDAR (`DOM1 − DGM1`, 1 m, 2016), watershed crown detection.
- Coverage: Göttingen city boundary (~117 km²), 905,088 crowns.
- Backing data: gzipped per-tile GeoJSON in `public/data/trees/`, built with
  `npm run tiles:trees -- --input=<crowns.geojson> --out-dir=public/data/trees`.
- See [`tree-detection.md`](tree-detection.md) for the method and its limits.

Attribution: © LGLN Niedersachsen (CC0 / DL-DE-BY-2.0); map data © OpenStreetMap
contributors (ODbL). Detected crowns are *detectable* trees only — occluded or young
trees will be missing.
