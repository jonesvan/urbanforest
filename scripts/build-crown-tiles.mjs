#!/usr/bin/env node
// Build Mapbox Vector Tile (.pbf) tiles from a GeoJSON layer.
//
// Usage:
//   node scripts/build-crown-tiles.mjs --input=data-src/gottingen-crowns-full.geojson \
//     --out-dir=public/tiles/crowns [--minzoom=11] [--maxzoom=16]

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import geojsonvt from 'geojson-vt';
import { fromGeojsonVt } from 'vt-pbf';

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
const outDir = args['out-dir'] ?? 'public/tiles/crowns';
const minZoom = Number(args.minzoom ?? 11);
const maxZoom = Number(args.maxzoom ?? 16);
const layerName = args.layer ?? 'crowns';
const tolerance = Number(args.tolerance ?? 2);

const lon2tile = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2tile = (lat, z) => {
    const rad = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
};

const geojson = JSON.parse(await readFile(input, 'utf8'));
console.log(`features: ${geojson.features.length}`);

const index = new geojsonvt(geojson, {
    maxZoom,
    indexMaxZoom: maxZoom,
    tolerance,
    extent: 4096,
    buffer: 64,
});

// data bbox -> tile ranges per zoom
let [minLon, minLat, maxLon, maxLat] = [180, 90, -180, -90];
for (const feature of geojson.features) {
    const coords = [];
    const walk = (c) => (typeof c[0] === 'number' ? coords.push(c) : c.forEach(walk));
    walk(feature.geometry.coordinates);
    for (const [lon, lat] of coords) {
        minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
        minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    }
}

let written = 0;
let bytes = 0;

for (let z = minZoom; z <= maxZoom; z++) {
    const x0 = lon2tile(minLon, z);
    const x1 = lon2tile(maxLon, z);
    const y0 = lat2tile(maxLat, z); // north
    const y1 = lat2tile(minLat, z); // south
    let zoomTiles = 0;

    for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
            const tile = index.getTile(z, x, y);
            if (!tile || tile.features.length === 0) continue;
            const buffer = fromGeojsonVt({ [layerName]: tile });
            const path = `${outDir}/${z}/${x}/${y}.pbf`;
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, buffer);
            written++;
            bytes += buffer.length;
            zoomTiles++;
        }
    }
    console.log(`  z${z}: ${zoomTiles} tiles`);
}

console.log(`tiles: ${written}, total ${(bytes / 1e6).toFixed(2)} MB -> ${outDir}`);
