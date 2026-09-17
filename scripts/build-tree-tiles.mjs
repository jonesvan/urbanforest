#!/usr/bin/env node
// Build the per-tile GeoJSON that backs the public trees API.
//
// Each detected crown becomes one point (its centroid) carrying the crown's
// height and area, bucketed into a fixed zoom tile grid so the API can serve a
// small bbox by reading a handful of files instead of the whole dataset.
//
// Usage:
//   node scripts/build-tree-tiles.mjs --input=data-src/gottingen-crowns-full.geojson \
//     --out-dir=public/data/trees [--zoom=14]

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';

function parseArgs(argv) {
    const args = {};
    for (const arg of argv) {
        const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
        if (m) args[m[1]] = m[2] ?? true;
    }
    return args;
}

const args = parseArgs(process.argv.slice(2));
const input = args.input ?? 'data-src/gottingen-crowns-full.geojson';
const outDir = args['out-dir'] ?? 'public/data/trees';
const zoom = Number(args.zoom ?? 14);

const lon2tile = (lon) => Math.floor(((lon + 180) / 360) * 2 ** zoom);
const lat2tile = (lat) => {
    const rad = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom);
};

const round = (value) => Math.round(value * 1e6) / 1e6;

// area-weighted centroid of a ring; falls back to the mean vertex for a
// degenerate (zero-area) ring.
function ringCentroid(ring) {
    let twiceArea = 0;
    let x = 0;
    let y = 0;
    for (let i = 0; i < ring.length - 1; i++) {
        const [x0, y0] = ring[i];
        const [x1, y1] = ring[i + 1];
        const cross = x0 * y1 - x1 * y0;
        twiceArea += cross;
        x += (x0 + x1) * cross;
        y += (y0 + y1) * cross;
    }
    if (twiceArea === 0) {
        const n = Math.max(ring.length - 1, 1);
        let sx = 0;
        let sy = 0;
        for (let i = 0; i < n; i++) {
            sx += ring[i][0];
            sy += ring[i][1];
        }
        return [sx / n, sy / n];
    }
    return [x / (3 * twiceArea), y / (3 * twiceArea)];
}

function centroid(geometry) {
    if (geometry.type === 'Point') return geometry.coordinates;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    let best = null;
    let bestArea = -1;
    for (const polygon of polygons) {
        const ring = polygon[0];
        let area = 0;
        for (let i = 0; i < ring.length - 1; i++) {
            area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
        }
        area = Math.abs(area / 2);
        if (area > bestArea) {
            bestArea = area;
            best = ringCentroid(ring);
        }
    }
    return best;
}

const geojson = JSON.parse(await readFile(input, 'utf8'));

const tiles = new Map();
for (const feature of geojson.features) {
    const [lon, lat] = centroid(feature.geometry);
    const x = lon2tile(lon);
    const y = lat2tile(lat);
    const key = `${x}/${y}`;
    let bucket = tiles.get(key);
    if (!bucket) {
        bucket = [];
        tiles.set(key, bucket);
    }
    bucket.push({
        type: 'Feature',
        properties: {
            height_max: feature.properties.height_max ?? null,
            area_m2: feature.properties.area_m2 ?? null,
        },
        geometry: { type: 'Point', coordinates: [round(lon), round(lat)] },
    });
}

await rm(outDir, { recursive: true, force: true });

let bytes = 0;
for (const [key, features] of tiles) {
    const path = join(outDir, String(zoom), key + '.json.gz');
    const body = gzipSync(Buffer.from(JSON.stringify({ type: 'FeatureCollection', features })));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    bytes += body.length;
}

console.log(`features: ${geojson.features.length}`);
console.log(`tiles:    ${tiles.size} (z${zoom})`);
console.log(`output:   ${outDir} (${(bytes / 1e6).toFixed(1)} MB)`);
