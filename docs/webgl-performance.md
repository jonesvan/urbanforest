# WebGL / WebGPU rendering options

> **Outcome: migrated to MapLibre GL JS (WebGL2).** The app now renders the basemap,
> the MVT crown tiles and the GeoJSON layers with MapLibre, replacing Leaflet +
> VectorGrid (SVG) and the deck.gl prototype. MapLibre over-zooms the z17 vector tiles
> natively, so crowns stay crisp at every zoom with no extra tiles and no SVG fallback.
> See "Migration result" at the end. The survey below is kept for context.

Goal: render the tree layers (65,835 crown polygons + 23,746 OSM points + 8,824 STL
polygons) smoothly at **every** zoom level, without losing detail or fidelity. Before the
migration the crowns were MVT tiles rendered by Leaflet.VectorGrid with the **SVG**
renderer (`rendererFactory: L.svg.tile`). That is crisp at all zooms but the DOM cost is
real at low zooms; the earlier **canvas** renderer was blurry when over-zoomed because
Leaflet scales the canvas bitmap.

This document surveys the practical ways to move that rendering onto the GPU while keeping
Leaflet (and the PHP backend + MVT tiles) in place.

## Requirements

- Crisp vector output at z13–z19 (no bitmap scaling / pixelation).
- 65k polygons (crowns) + 23k points (OSM) + 8.8k polygons (STL) with per-feature styling
  and click/hover.
- Minimal change to the current stack (PHP + vanilla JS + Leaflet + pre-built MVT tiles).
- Optional: works without a bundler (CDN), or via the existing `npm`-based tooling.

## Option matrix

| Option | Rendering | Leaflet fit | Polygons | WebGPU | Notes |
| --- | --- | --- | --- | --- | --- |
| **Leaflet.VectorGrid (today)** | Canvas/SVG per tile | Native | Yes | No | SVG crisp but DOM-heavy; canvas blurs on over-zoom |
| **deck.gl overlaid on Leaflet** | WebGL2 | Overlay layer, camera synced | Yes (`PolygonLayer`, `MVTLayer`, `GeoJsonLayer`) | Partial (v9.4, WIP) | GPU, built-in picking; interleaving **not** supported with Leaflet |
| **Leaflet.glify** | WebGL | Native plugin | `L.glify.shapes()` | No | Renders GeoJSON directly (no tiling); GLSL; simple API |
| **Leaflet.PixiOverlay** | PixiJS (WebGL, canvas fallback) | Native plugin | `PIXI.Graphics` | No (pixi 4–7; v8 has WebGPU but overlay not updated) | Excellent for many markers (1M demo) / ~36k polygons |
| **MapLibre GL JS** | WebGL2 | Replaces Leaflet | Yes (MVT/layers) | Not yet (webgl2) | Best raw MVT performance; migration cost |
| **Raw WebGPU canvas overlay** | WebGPU | Custom pane | Custom | Yes | Max control, max effort, no Leaflet integration |

Sources: deck.gl [Base Maps](https://deck.gl/docs/get-started/using-with-map) and
[WebGPU status](https://deck.gl/docs/developer-guide/webgpu);
[Leaflet.glify](https://github.com/robertleeplummerjr/Leaflet.glify);
[Leaflet.PixiOverlay](https://github.com/manubb/Leaflet.PixiOverlay);
[MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js).

Key facts from the sources:

- **deck.gl + Leaflet** is supported as an *overlaid* canvas (Deck canvas positioned over
  the Leaflet map, cameras synchronized). Leaflet is **not** in the *interleaved* list
  (only Mapbox GL, MapLibre GL, ArcGIS, Google Maps expose the needed WebGL2 hook).
- deck.gl `MVTLayer`, `PolygonLayer`, `GeoJsonLayer`, `SolidPolygonLayer`, `TileLayer` have
  in-tree **WebGPU** implementations as of v9.4, but the docs state WebGPU support is
  **"still a work in progress and not production ready"**; picking is async, extensions and
  base-map interleaving are largely WebGL-only.
- **Leaflet.glify** renders points/lines/polygons from GeoJSON with WebGL, has `click`/
  `hover`, and `update`/`remove`. It does not consume MVT; it takes the features directly.
- **Leaflet.PixiOverlay** ships demos with **1,000,000 markers** and **36,000 polygons**,
  with a `resolution` option (retina) and `doubleBuffering`; good for points/symbols.

## Recommendation

### Primary: deck.gl overlaid on Leaflet, consuming the existing MVT tiles

We already build MVT tiles (`public/tiles/crowns/{z}/{x}/{y}.pbf`), so this is a small
change with a large payoff:

- `MVTLayer` streams the tiles to the **GPU** (no DOM/SVG per feature), stays vector-crisp
  at all zooms, and over-zooms without blurring.
- Built-in GPU **picking** gives hover/click for popups.
- The OSM tree points can move to `ScatterplotLayer`/`IconLayer` and the STL patches to
  `PolygonLayer` or their own `MVTLayer`, all in the same Deck instance.

Sketch (deck.gl standalone + Leaflet base map):

```js
// CDN (no bundler): https://unpkg.com/deck.gl@latest/dist.min.js  -> global `deck`
const { Deck, MVTLayer } = deck;

const leafletMap = L.map('map').setView([51.5336, 9.9352], 13);

const deckOverlay = new Deck({
  canvas: 'deck',                 // absolutely-positioned canvas over #map
  initialViewState: { longitude: 9.9352, latitude: 51.5336, zoom: 13 },
  controller: false,              // Leaflet owns the camera
  layers: [
    new MVTLayer({
      id: 'crowns',
      data: 'tiles/crowns/{z}/{x}/{y}.pbf',
      minZoom: 13, maxZoom: 19,
      getFillColor: [230, 126, 34, 140],
      pickable: true,
      onHover: (info) => { /* info.object.properties */ },
    }),
  ],
});

// sync cameras both ways (deck's Leaflet example does exactly this)
leafletMap.on('move', () => deckOverlay.setProps({ viewState: toViewState(leafletMap) }));
```

Trade-offs: +WebGL2 requirement (fine in 2026), a new library (~hundreds of KB), and
camera-sync boilerplate. No interleaving, so deck content always draws above the Leaflet
tiles (fine for a data overlay; labels of the *base map* would be covered, so the
basemap should stay underneath).

### Alternative: Leaflet.glify (no tiling, GeoJSON straight to WebGL)

If we would rather not depend on tiles for the crowns, glify draws the GeoJSON directly:

```js
L.glify.shapes({
  map: leafletMap,
  data: crownsGeoJson,
  color: () => ({ r: 0.9, g: 0.5, b: 0.13, a: 0.55 }),
  click: (e, feature) => { /* popup */ },
});
```

Good for a quick GPU win, but: it loads the full GeoJSON (~20 MB for the crowns), styling
is more limited, and there are known precision caveats at very high zoom. It is a good fit
for the **OSM points** (`L.glify.points`) where simplicity matters.

### Strategic: MapLibre GL JS

If the project can accept replacing Leaflet, MapLibre GL JS is the mature, GPU-first MVT
renderer (WebGL2, BSD-3, very active). It gives the best raw performance and native
clustering/expressions, at the cost of rewriting the map layer and losing Leaflet's plugin
ecosystem. Recommended only if the map becomes the core of the product.

### WebGPU

- **deck.gl**: WebGPU is being ported layer-by-layer (`PolygonLayer`/`GeoJsonLayer`/
  `MVTLayer` ✅ v9.4 in tree) but the docs explicitly call it **not production ready** and
  base-map interleaving unsupported.
- **MapLibre GL JS**: still WebGL2.
- **PixiJS v8** has a WebGPU renderer, but Leaflet.PixiOverlay currently targets pixi 4–7,
  so WebGPU is not available through that plugin without custom work.
- A **raw WebGPU overlay** (a custom Leaflet pane with a `GPUCanvasContext`, instanced
  polygon/point pipelines) is feasible but is a research project, not a drop-in.

**Conclusion:** WebGPU is not yet the pragmatic choice. Build on **WebGL2** now (deck.gl or
glify); revisit WebGPU when deck.gl marks it stable, and design the renderer behind a small
interface so the GPU backend can be swapped later.

## Keeping detail (no compromise)

- GPU rendering of **vector** geometry is resolution-independent — the pixelation we saw
  came from Leaflet scaling *canvas tiles*, not from the data. deck.gl re-renders vectors
  at device resolution, so `maxNativeZoom` over-zoom stays sharp.
- Keep the MVT tiles as the transport (small, culled by viewport) and raise `maxzoom`
  where needed; the GPU has no per-feature DOM cost.
- Render at `devicePixelRatio` (deck does this automatically; glify/Pixi expose a
  `resolution`/`pixelRatio` option).
- Keep per-zoom geometry simplification (already done in `build-crown-tiles.mjs`) — it is
  invisible and reduces GPU work at low zoom.
- Add LOD styling (fill opacity/threshold by zoom) rather than dropping features.

## High-DPI (retina) displays

No changes are required for the vector data:

- MapLibre GL JS is device-pixel aware — it sizes its WebGL canvas from
  `window.devicePixelRatio` (and guards huge buffers via `maxCanvasSize`), so the MVT
  crowns and the GeoJSON layers render at native device resolution and stay sharp on
  retina/HiDPI screens.
- Because they are vectors, crowns, STL patches and OSM trees are re-rasterised at the
  device resolution on every frame; there is no bitmap to blur.

The only soft element on a HiDPI screen is the **raster basemap** (OpenStreetMap serves
256 px tiles, and there is no `@2x` variant). Options if that matters:

- Switch to a **vector basemap** (MapLibre demo tiles, OpenFreeMap, Protomaps, Stadia) —
  crisp at any DPR and supports fractional zoom; needs a style URL + glyphs.
- Or use a raster provider that offers 512 px tiles and set `tileSize: 512`.

Also note the layer colours blend more when a layer is semi-transparent; the crown fill
uses `fill-opacity: 0.55`.

## Migration result

The app now uses **MapLibre GL JS 5.24 (WebGL2)** as the single renderer — Leaflet,
Leaflet.VectorGrid and the deck.gl prototype were removed.

- `index.php` loads MapLibre from a CDN; `#map` is the MapLibre container.
- `config.php` provides a MapLibre-compatible raster basemap (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`).
- `app.js` builds the style: a raster basemap, a **vector source** for the crown MVT tiles
  (`tiles/crowns/{z}/{x}/{y}.pbf`, `minzoom`/`maxzoom` = 13/17) with fill+line layers, and
  **GeoJSON sources** for the STL patches (fill) and OSM trees (circle).
- Layer toggles map to `setLayoutProperty(..., 'visibility', ...)`; clicks on fill/circle
  layers open a MapLibre popup.
- URL params `?lat=&lng=&zoom=` still work.

Results:

- Crowns render crisply at **z13–z19** (verified with headless screenshots); MapLibre
  over-zooms the z17 vector tiles natively, so **no z18/z19 tiles and no SVG fallback** are
  needed.
- Zoomed out they no longer disappear: a second tileset of **crown centroids**
  (`public/tiles/crown-points`, z6–z12) is drawn as a MapLibre `circle` layer for
  `zoom < 13`, switching to the polygon fill at z13 (`minzoom`/`maxzoom` on the layers).
- One gotcha solved: MapLibre requires **absolute** tile URLs and must keep the
  `{z}/{x}/{y}` placeholders literal — `new URL()` percent-encoded the braces (`%7Bz%7D`)
  and broke tile loading, so the URL is prefixed as a string instead.

Remaining (optional):
- Sweep the OSM point layer (23.7k) and STL (8.8k polygons) into the same tiling pipeline if
  they ever grow, so MapLibre streams them as tiles too.
- Run the benchmark plan below on real hardware.
- Revisit WebGPU when MapLibre ships it.

## Benchmark plan

Measure before/after on the same machine and viewport, with all layers on:

- **Frame time / FPS** during continuous pan and zoom (`requestAnimationFrame` sampling).
- **Long tasks** and first-render time (Chrome DevTools Performance).
- **Draw calls / GPU memory** (MapLibre + DevTools performance monitor).
- **Transfer** per viewport (tiles fetched).
- Targets: ≥60 fps pan/zoom on a mid-range laptop; no long tasks >50 ms during interaction;
  time-to-first-crowns < 1 s.

## Suggested next step

Run the benchmark plan above on real hardware with MapLibre, and consider tiling the
GeoJSON layers (STL, OSM trees) with the same pipeline so all layers stream as MVT.
Revisit WebGPU when MapLibre GL JS ships it.
