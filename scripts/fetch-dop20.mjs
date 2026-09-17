#!/usr/bin/env node
// Fetch LGLN OpenGeoData DOP20 orthophoto tiles covering a WGS84 bounding box.
//
// Usage:
//   node scripts/fetch-dop20.mjs --bbox=51.520,9.915,51.545,9.955 [--rgbi] [--out-dir=data-src/dop20]
//
// The DOP20 download index (52k features) is cached under data-src/.

import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { basename, join } from 'node:path';
import proj4 from 'proj4';

const INDEX_URL = 'https://single-datasets.opengeodata.lgln.niedersachsen.de/pro-download-indices/dop/lgln-opengeodata-dop20.geojson';
const INDEX_CACHE = 'data-src/dop20-index.geojson';

proj4.defs('EPSG:25832', '+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

function parseArgs(argv) {
    const args = {};
    for (const arg of argv) {
        const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
        if (match) args[match[1]] = match[2] ?? true;
    }
    return args;
}

async function exists(path) {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

async function download(url, path) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    const expected = Number(response.headers.get('content-length') ?? 0);
    const tmp = `${path}.part`;
    await pipeline(response.body, createWriteStream(tmp));
    const { size } = await stat(tmp);
    if (expected && size !== expected) {
        await rm(tmp, { force: true });
        throw new Error(`incomplete download of ${basename(url)}: got ${size} of ${expected} bytes`);
    }
    await rename(tmp, path);
}

const args = parseArgs(process.argv.slice(2));
const bbox = String(args.bbox ?? '51.520,9.915,51.545,9.955').split(',').map(Number);
if (bbox.length !== 4 || bbox.some(Number.isNaN)) {
    console.error('error: --bbox must be minLat,minLon,maxLat,maxLon');
    process.exit(2);
}
const [minLat, minLon, maxLat, maxLon] = bbox;
const variant = args.rgbi ? 'rgbi' : 'rgb';
const outDir = args['out-dir'] ?? 'data-src/dop20';

// WGS84 bbox -> EPSG:25832 envelope
const corners = [
    [minLon, minLat], [minLon, maxLat], [maxLon, minLat], [maxLon, maxLat],
].map(([lon, lat]) => proj4('EPSG:4326', 'EPSG:25832', [lon, lat]));
const minX = Math.min(...corners.map((c) => c[0]));
const maxX = Math.max(...corners.map((c) => c[0]));
const minY = Math.min(...corners.map((c) => c[1]));
const maxY = Math.max(...corners.map((c) => c[1]));

await mkdir('data-src', { recursive: true });
if (!(await exists(INDEX_CACHE))) {
    console.error('downloading DOP20 index (~40 MB) ...');
    await download(INDEX_URL, INDEX_CACHE);
}

const index = JSON.parse(await readFile(INDEX_CACHE, 'utf8'));

const intersecting = index.features.filter((feature) => {
    const xs = feature.geometry.coordinates[0].map((c) => c[0]);
    const ys = feature.geometry.coordinates[0].map((c) => c[1]);
    const tMinX = Math.min(...xs);
    const tMaxX = Math.max(...xs);
    const tMinY = Math.min(...ys);
    const tMaxY = Math.max(...ys);
    return tMaxX >= minX && tMinX <= maxX && tMaxY >= minY && tMinY <= maxY;
});

// The index lists one feature per tile and vintage; keep the most recent per tile.
const latestByTile = new Map();
for (const feature of intersecting) {
    const { tile_id: tileId, Aktualitaet: vintage } = feature.properties;
    const current = latestByTile.get(tileId);
    if (!current || String(vintage) > String(current.properties.Aktualitaet)) {
        latestByTile.set(tileId, feature);
    }
}
const selected = [...latestByTile.values()];

if (selected.length === 0) {
    console.error('error: no DOP20 tiles intersect the bbox');
    process.exit(1);
}

console.log(`bbox (EPSG:4326): ${bbox.join(', ')}`);
console.log(`bbox (EPSG:25832): ${minX.toFixed(0)}, ${minY.toFixed(0)}, ${maxX.toFixed(0)}, ${maxY.toFixed(0)}`);
console.log(`tiles:  ${selected.length} (${variant})`);

await mkdir(outDir, { recursive: true });

for (const feature of selected) {
    const url = feature.properties[variant];
    const target = join(outDir, basename(url));
    if (!args.force && (await exists(target))) {
        console.log(`skip    ${basename(url)}`);
        continue;
    }
    process.stdout.write(`get     ${basename(url)} ... `);
    await download(url, target);
    console.log('ok');
}

console.log(`\ndone -> ${outDir}`);
