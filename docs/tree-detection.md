# Individual tree detection — scope

How to map **every detectable individual tree** as its own feature, beyond what the
Urban Atlas Street Tree Layer (patches) and OpenStreetMap (volunteer-mapped points)
provide.

## Problem statement

| Source | What it gives | Why it is not "every tree" |
| --- | --- | --- |
| Copernicus UA STL | Tree patches/rows ≥ 500 m², width ≥ 10 m | Single trees below the MMU never appear |
| OSM `natural=tree` | Individually mapped trees | Only where volunteers mapped them; coverage is partial and uneven |

To get a per-tree layer we must **detect tree crowns in high-resolution imagery** (and
optionally LiDAR). This is a remote-sensing segmentation task, not a download.

## Data inputs (Göttingen, Lower Saxony — all open)

### Primary: DOP20 digital orthophotos (20 cm, RGB + RGBI)
- Provider: LGLN (Landesamt für Geoinformation und Landesvermessung Niedersachsen), OpenGeoData.
- Resolution 20 cm/px, GeoTIFF, **RGB and RGBI** (near-infrared → NDVI for vegetation masks).
- Updated on a ~3-year flight cycle; Göttingen tiles are from 2023-06-03.
- CRS: **EPSG:25832** (ETRS89 / UTM 32N), 1 km × 1 km tiles.
- Licence: open (CC0 / DL-DE-BY-2.0) — verify current terms on the portal.
- Machine-readable index (52,260 tiles, direct URLs):
  `https://single-datasets.opengeodata.lgln.niedersachsen.de/pro-download-indices/dop/lgln-opengeodata-dop20.geojson`
- Example tile asset:
  `https://dop20-rgb.opengeodata.lgln.niedersachsen.de/323425816/2023-06-03/dop20rgb_32_342_5816_2_ni_2023-06-03.tif`
- Filter the index by the area of interest bbox → a few dozen tiles for the city core
  (~60 tiles ≈ 60 km²; the full FUA is ~350 km²).

### Optional: DOM1 surface model (1 m) and DGM1 terrain
- Airborne LiDAR (ALS), ≥ 4 pts/m² since 2019; DOM1 (surface) and DGM1 (terrain) open via
  OpenGeoData Niedersachsen / NUMIS.
- Enables a **canopy height model** `CHM = DOM1 − DGM1`, which makes tree/non-tree decisions
  far more robust (buildings, cars, shadows removed by height + shape).
- Delivery is through the geodata portal (not a simple S3 index like DOP20) — resolve the
  exact download/WCS endpoint at implementation time.

### Supporting layers
- **ALKIS** building footprints / LOD1–LOD2 (LOD indices are in the same OpenGeoData bucket)
  to mask roofs and paved areas.
- **OSM** (`natural=tree`, `highway`, `building`) for masking and, crucially, for validation.
- **Copernicus STL** as a coarse prior: crowns inside STL patches are dense; outside are sparse.

## Approaches

### A. Imagery-only deep learning — recommended v1
- **DeepForest** (open source, RetinaNet on RGB) → tree-crown bounding boxes per image tile.
- No LiDAR needed; pretrained weights available; runs on CPU.
- Domain gap: pretrained on US NEON data — expect recall to drop on European street trees;
  fine-tuning on a few hundred local labels is the biggest accuracy lever.
- Deliverable: crown boxes with confidence → convert to GeoJSON polygons/points.

### B. LiDAR canopy height model + watershed — highest precision
- Build CHM from DOM1−DGM1, find local maxima (tree tops), segment with watershed /
  `detectree2` (developed for exactly this), filter by height and crown size.
- Excellent for closed canopy and height; needs DOM1 coverage and more geospatial plumbing.

### C. Hybrid — best eventual quality
- Seed crowns with CHM local maxima, use imagery (DeepForest/segmentation) to refine
  boundaries; drop detections over buildings/roads via ALKIS masks.

### D. Semantic segmentation (U-Net / SAM) + watershed
- Segment "tree" vs background, split touching crowns with watershed.
- More training data and tuning than A; strongest when fine-tuned locally.

**Recommendation:** start with **A** to get an end-to-end layer fast, validate against OSM,
then add **C** (LiDAR) where precision matters.

## Pipeline (recommended v1 = approach A)

1. **Select area** — city bbox (e.g. `51.49,9.88,51.57,10.02`).
2. **Fetch imagery** — filter the DOP20 index by bbox, download RGBI (or RGB) GeoTIFFs.
3. **Preprocess** — reproject/keep EPSG:25832, tile into 512 px patches with ~20% overlap,
   optional NDVI channel from RGBI to pre-mask non-vegetation.
4. **Detect** — DeepForest inference per patch → crown boxes + confidence.
5. **Post-process** — NMS across overlapping patches; filter by crown size (e.g. 1–15 m
   diameter) and by ALKIS/OSM masks; drop scene edges.
6. **Vectorise** — boxes → GeoJSON `Polygon`/`Point` in EPSG:4326, dedupe against OSM.
7. **Validate** — see below.
8. **Serve** — write `public/data/gottingen-crowns.geojson`, loaded as a new Leaflet layer
   (the app already styles point and polygon layers).

Sketch:

```bash
# 1–2) pick tiles for the bbox from the index
curl -s ".../lgln-opengeodata-dop20.geojson" > dop20-index.geojson
# (filter features whose geometry intersects the bbox, download .rgb/.rgbi URLs)

# 3–4) DeepForest
python -m deepforest --help          # or the Python API: predict_tile / predict_image
```

## Validation

Detection is only useful if its accuracy is known.

- **Reference data:** manually label crowns on a random sample of ~30–50 image tiles
  (a few hundred crowns). Include hard cases (shadows, hedges, adjacent crowns).
- **Metrics:** precision / recall / F1 at crown level (match by IoU ≥ 0.5), plus a visual
  overlay audit.
- **Cross-check:** compare coverage vs OSM trees and STL patches — report where each source
  uniquely adds or misses trees.
- **Target (v1):** recall ≥ 0.7, precision ≥ 0.7 on tree cover; tune threshold to trade off.

## Compute & storage

- **CPU-only is fine for a pilot city** (hundreds of patches, minutes per tile). A GPU
  (Colab, one A100/T4 session) speeds iteration and fine-tuning.
- Imagery: ~60–80 MB/tile × ~60 tiles ≈ **4–6 GB** for the city core; budget 10× for the FUA.
- Output layer: crown polygons for Göttingen ≈ a few MB GeoJSON.

## Integration into urbanforest

- New layer file `public/data/gottingen-crowns.geojson`; `index.php` auto-lists it.
- `app.js` already renders polygons and points; add a distinct style/legend entry and a
  confidence-based opacity if desired.
- Proposed feature schema:
  `{ id, confidence, area_m2, diameter_m, source: "dop20-deepforest", detected_from: "<tile>" }`.

## Milestones

| Milestone | Scope | Effort |
| --- | --- | --- |
| M1 | DOP20 fetch + tiling for city bbox, DeepForest baseline, crown GeoJSON | 1–2 days |
| M2 | Validation sample + metrics, threshold tuning, Leaflet layer | 2–4 days |
| M3 | Fine-tune on local labels; hybrid with DOM1 CHM; ALKIS masking | 1–2 weeks |

## Risks & limitations

- **No source is a census.** Detection finds *detectable* crowns; occluded, young, or
  privately-planted trees will be missed. Communicate this in the UI.
- **Domain gap** of pretrained models → fine-tuning needs local labels (labelling is the
  main hidden cost).
- **Seasonality**: leaf-off imagery changes crown appearance.
- **Overlap/deduplication** with OSM and STL must be handled to avoid triple-counting.
- **Shadow / adjacent crowns** cause merges and false splits.
- **Licence/ToS** of any non-open imagery must be respected; stick to open DOP20.

## Licensing / attribution

- DOP20 / DOM1: © LGLN Niedersachsen, open data (CC0 / DL-DE-BY-2.0 — confirm current terms).
- OSM: © OpenStreetMap contributors, ODbL.
- DeepForest: MIT-licensed, cite the project and its underlying NEON-trained model.
- Copernicus STL: © EEA / CLMS, DOI 10.2909/205691b3-7ae9-41dd-abf1-1fbf60d72c8c.

## M1 baseline result (Göttingen) — negative

M1 was implemented and run. The pipeline works; the **result is not usable** and must
not be shown as tree data.

What was done:
- Fetched 6 DOP20 RGB tiles (2 km × 2 km, 10 000 × 10 000 px, 20 cm) for the city-centre
  bbox `51.520,9.915,51.545,9.955` via `scripts/fetch-dop20.mjs` (~134 MB).
- Ran the pretrained DeepForest tree-crown model (patch 400 px, overlap 0.1) via
  `scripts/detect-trees.py`, georeferenced the boxes (EPSG:25832 → 4326).
- Output: 17,353 boxes at score ≥ 0.3 (median box 35 m²), `data-src/gottingen-crowns-pilot.geojson`.

Why it fails:
- **The flight is leaf-off.** The available Göttingen DOP20 vintages are all
  Jan–Apr (2013-04, 2016-01, 2019-03, 2022-03); the most recent is **2022-03-03**. Bare
  deciduous trees have no detectable crown in RGB.
- **Domain gap.** The pretrained model learned summer canopies on US NEON plots; on bare
  trees it fires on roofs, shadows and street furniture instead.
- **Poor agreement with OSM** in the pilot bbox: only **11%** of OSM trees fall inside a
  detected crown; median distance from an OSM tree to the nearest crown is **14.7 m**.
- Visual overlay confirms the boxes miss the OSM tree rows in the park and land on
  buildings. Raising the score threshold to 0.5/0.7 removes almost everything (8/1 boxes
  in the sample), so thresholding cannot rescue it.

Conclusion: **leaf-off RGB + a summer-pretrained model is the wrong combination.** The
detection approach is not discarded, but it needs a leaf-independent or leaf-on input.

## Corrected path

1. **LiDAR CHM (approach B) — primary.** DOM1 − DGM1 gives canopy height regardless of
   foliage; local maxima + `detectree2`/watershed delineates crowns. This is the most
   promising route for the leaf-off reality of German DOP20 and is the recommended next
   milestone (M3).
2. **Leaf-on imagery** — if a leaf-on VHR orthophoto can be licensed, the imagery approach
   becomes viable; no open sub-metre leaf-on source was found for Göttingen.
3. **Fine-tune** DeepForest on local **leaf-off** labels if the RGB route is kept — needs
   several hundred manually delineated crowns and accepts degraded accuracy.

## Next step

Implement the **LiDAR CHM route**: obtain DOM1/DGM1 for Göttingen, build `CHM = DOM1 −
DGM1`, detect crown tops and delineate with watershed/`detectree2`, validate against OSM,
then emit `gottingen-crowns.geojson`. Keep the DOP20 tiles for the basemap/visual check.
