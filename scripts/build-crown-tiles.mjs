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
const minZoom = Number(args.minzoom ?? 13);
const maxZoom = Number(args.maxzoom ?? 17);
const layerName = args.layer ?? 'crowns';
const tolerance = Number(args.tolerance ?? 1.5);
const pointsMode = Boolean(args.points);

const lon2tile = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2tile = (lat, z) => {
    const rad = (lat * Math.PI) / 180;
    return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
};

// At low zoom, small crowns are sub-pixel and only add render cost, so drop them.
// In --points mode crowns are single dots, so only the largest survive at low zoom.
function minAreaForZoom(z) {
    if (pointsMode) {
        if (z <= 9) return 400;
        if (z === 10) return 300;
        if (z === 11) return 200;
        if (z === 12) return 120;
        return 0;
    }
    if (z <= 13) return 120;
    if (z === 14) return 60;
    if (z === 15) return 30;
    if (z === 16) return 12;
    return 0;
}

function filterTile(tile, z) {
    const minArea = minAreaForZoom(z);
    if (!minArea || !tile) return tile;
    const features = tile.features.filter((f) => Number(f.tags?.area_m2 ?? 0) >= minArea);
    return features.length ? { ...tile, features } : null;
}

const geojson = JSON.parse(await readFile(input, 'utf8'));

if (pointsMode) {
    // one dot per crown: use the centroid of the outer ring
    geojson.features = geojson.features.map((feature) => {
        const polygon = feature.geometry.type === 'Polygon'
            ? feature.geometry.coordinates
            : feature.geometry.coordinates[0];
        const ring = polygon[0];
        let sumX = 0;
        let sumY = 0;
        const count = Math.max(ring.length - 1, 1);
        for (let i = 0; i < count; i++) {
            sumX += ring[i][0];
            sumY += ring[i][1];
        }
        return {
            type: 'Feature',
            properties: feature.properties,
            geometry: { type: 'Point', coordinates: [sumX / count, sumY / count] },
        };
    });
}

console.log(`features: ${geojson.features.length}${pointsMode ? ' (points)' : ''}`);

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
            const tile = filterTile(index.getTile(z, x, y), z);
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
