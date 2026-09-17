# Future tasks

Open work and decisions after the current state (STL patches + OSM points for Göttingen,
plus the failed DOP20 detection pilot). Grouped by the three questions: viewport
performance, data sources, and model choice.

## Current baseline (for reference)

| File | Features | Geometry | Size |
| --- | --- | --- | --- |
| `gottingen-street-trees.geojson` (STL) | 8,824 | MultiPolygon | 4.7 MB |
| `gottingen-trees.geojson` (OSM) | 23,746 | Point | 3.0 MB |
| `gottingen-crowns-pilot.geojson` (DeepForest, not served) | 17,353 | Polygon | 7.2 MB |

Today the app fetches both served files on load and adds every feature to a Leaflet map
using the default SVG renderer, with no clustering, simplification or compression.

---

## 1. Make the viewport faster

### 1.1 Measure first
- Add a repeatable benchmark: page load (network transfer waterfall), parse time,
  time-to-first-render, and pan/zoom FPS with both layers on.
- Record on a mid-range laptop and a phone. Track against the current baseline.
- Tools: Chrome DevTools performance/network, Lighthouse, `?debug=1` overlay that prints
  feature counts and render time.

### 1.2 Rendering (frontend)
| Task | Why | Effort |
| --- | --- | --- |
| `preferCanvas: true` on the map | SVG DOM nodes are the main cost for 20k+ points; canvas is far cheaper | S |
| Add `Leaflet.markercluster` for the OSM/tree points | Avoids drawing all 23k markers at low zoom; clusters are also better UX | S |
| WebGL points (e.g. `Leaflet.glify`) if clustering is not enough | Handles 100k+ points at 60 fps | M |
| Zoom-dependent layers (hide dense points when `zoom < N`) | Fewer features to draw when zoomed out | S |
| Simplify STL polygons (`mapshaper -simplify`) + drop unused attributes | Smaller files, fewer vertices to render | S |

### 1.3 Data delivery (backend)
| Task | Why | Effort |
| --- | --- | --- |
| **Vector tiles** via geojson-vt → MVT, served statically | **Done for crowns** (`scripts/build-crown-tiles.mjs` → `public/tiles/crowns`); still to do for OSM trees/STL | M–L |
| Serve FlatGeobuf directly (range requests + spatial index) instead of GeoJSON | Leaflet/`flatgeobuf` reader fetches only the needed bbox; no tiling build step | M |
| PHP bbox API (`api/layers.php?bbox=…&layer=…`) with a spatial index | Simple dynamic filtering; needs a fast spatial store (SQLite/R-tree) or pre-tiling | M |
| Gzip/Brotli + cache headers (`Cache-Control`, `ETag`) | GeoJSON compresses ~5–10×; the PHP dev server does neither | S |
| Reduce coordinate precision (6 → 5–6 decimals) and trim properties | Smaller payloads | S |
| Lazy-load: only fetch a layer when toggled on (already partly done) | Avoids loading hidden layers | S |

**Recommended sequence:** canvas + clustering + gzip (quick wins) → vector tiles or
FlatGeobuf (structural fix). Benchmark after each step.

### 1.4 Acceptance criteria
- Pan/zoom stays ≥ 50 fps with all layers on, on a mid-range laptop.
- Initial transfer < 1 MB (compressed) for the default view.
- Time-to-interactive < 2 s on a fast connection.

---

## 2. Is this the best data source?

### 2.1 Criteria
Coverage, spatial resolution, temporal freshness, licence, cost, and whether it contains
the thing we actually want (individual trees vs. patches).

### 2.2 Individual trees — alternatives to OSM
| Source | Pros | Cons | Status |
| --- | --- | --- | --- |
| OSM `natural=tree` (current) | Open, attributed, has species sometimes | Incomplete and uneven; volunteer-driven | In use |
| **Municipal tree cadastre** (Baumkataster) | Authoritative, species/age/height, per-tree | Not always open; often WFS/GeoJSON; coverage limited to public trees | **Investigate** for Göttingen / Lower Saxony |
| **LiDAR CHM** (DOM1 − DGM1) | Leaf-independent, complete canopy, open | Crowns, not species; needs segmentation | **Validated** (88.8% OSM agreement) |
| bDOM20 − DGM1 (20 cm image DSM) | 20 cm heights, open COG via STAC | Photogrammetric — **fails over bare leaf-off deciduous trees** (median 0.4 m at OSM trees) | Rejected |
| Commercial VHR imagery + detection | Leaf-on possible, high detail | Licensing/cost | Not open |
| National/regional inventories | Authoritative where they exist | Rarely per-tree, licence varies | Investigate |

**Task:** check whether Göttingen or Lower Saxony publishes an open tree cadastre (search
govdata.de, the state geodata portal, and the city's open-data portal) and, if so, add it
as a layer with `source`, `species`, `height`, `planted_year`.

### 2.3 Tree patches — is STL the best?
- STL is the pan-European authoritative **patch** product (500 m² MMU) — good as a coarse
  green-structure layer.
- Alternatives/possible additions: national land cover, a DOP20 NDVI/tree-cover mask,
  Sentinel-2 canopy cover. These add freshness/resolution but none give individual trees.
- **Task:** document the accuracy limits of STL vs. OSM vs. LiDAR in the UI (a short "about
  the data" panel), so users do not read patches as trees.

### 2.4 Imagery — the leaf-on gap
- The open LGLN DOP20 is leaf-off (Jan–Apr). No open sub-metre **leaf-on** source was
  found for Göttingen.
- **Task:** survey leaf-on options (LGLN special flights, other states, Copernicus VHR,
  commercial) and record licence/cost. This is the gating question for any imagery-based
  detection.

---

## 3. Is this the best model?

Current attempt: **DeepForest** (RetinaNet), pretrained on summer canopies. It failed on
leaf-off imagery (see `docs/tree-detection.md`).

### 3.1 Alternatives
| Approach | Input | Fit here | Notes |
| --- | --- | --- | --- |
| **CHM local maxima + watershed / `detectree2`** | LiDAR/DSM CHM (DOM1−DGM1 or bDOM20−DGM1) | **Best next** | Leaf-independent; bDOM20 gives 20 cm heights |
| DeepForest fine-tuned on local labels | Leaf-off DOP20 | Medium | Needs ~hundreds of delineated crowns; accuracy degrades without foliage |
| SAM / DINOv2 / foundation segmentation + prompt | VHR imagery | Explore | Strong generalisation; needs tuning and labels |
| Mask R-CNN / YOLOv8-seg | Imagery | Explore | Need local training data |
| U-Net / DeepLab semantic seg + watershed | Imagery | Explore | Splitting touching crowns is the hard part |
| Ensemble (CHM seeds + imagery refinement) | LiDAR + imagery | Long term | Highest quality, most work |

### 3.2 How to choose (evaluation protocol)
- Build a small **local reference set**: ~30–50 tiles with manually delineated crowns,
  including hard cases (adjacent crowns, shadows, hedges).
- Metrics: crown-level precision/recall/F1 at IoU ≥ 0.5, plus height/area error where LiDAR
  is available.
- Report per source; require ≥ 0.7/0.7 for a layer to be user-facing.
- Track model version, weights, thresholds, and imagery date in the output metadata.

### 3.3 Tasks
- [ ] Implement the LiDAR CHM pipeline (`DOM1 − DGM1`, local maxima, watershed/`detectree2`).
- [ ] Create the labelled reference set and the evaluation script.
- [ ] Only then compare a fine-tuned imagery model against the CHM baseline.
- [ ] Pin model provenance (weights id/version) in the GeoJSON properties.

---

## 4. Engineering & hygiene

- **Reproducible Python env:** add `requirements.txt` / `uv.lock` for the detection
  pipeline (DeepForest, torch, rasterio, geopandas, detectree2). Today only `.venv` exists.
- **Data licences & attribution in the UI:** Copernicus STL (EEA/CLMS DOI), OSM (ODbL,
  "© OpenStreetMap contributors"), LGLN DOP20/DOM1 (CC0 / DL-DE-BY-2.0), DeepForest (MIT).
  Add an "About the data" panel with per-layer licence and date.
- **Provenance/versioning:** each GeoJSON should carry `source`, `source_date`,
  `pipeline_version`, `generated_at`.
- **Tests/CI:** basic checks that scripts run and GeoJSON validates; lint the frontend.
- **Coordinates/precision policy:** consistent 6-decimal output; document CRS per layer.
- **Accessibility:** keyboard layer toggles, colour contrast, no colour-only encoding.

---

## Priority (suggested)

| # | Task | Impact | Effort |
| --- | --- | --- | --- |
| 1 | Tune CHM crown detector (over-merge/splitting) | High | M |
| 2 | Investigate municipal tree cadastre | High | S |
| 3 | Leaf-on imagery survey (gating for imagery models) | High | S |
| 4 | Canvas + clustering + gzip for the GeoJSON layers | Medium | S |
| 5 | Labelled reference set + evaluation (P/R/F1, not just OSM agreement) | Medium | M |
| 6 | Licensing/attribution panel + provenance fields | Medium | S |
| 7 | Python lockfile + CI | Low | S |
