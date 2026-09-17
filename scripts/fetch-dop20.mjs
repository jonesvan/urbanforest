#!/usr/bin/env node
// Fetch LGLN OpenGeoData DOP20 orthophoto tiles covering a WGS84 bounding box
// via the LGLN STAC API (public Cloud-Optimized GeoTIFFs, latest vintage per tile).
//
// Usage:
//   node scripts/fetch-dop20.mjs --bbox=51.520,9.915,51.545,9.955 [--rgbi] [--date=2025-03-04] [--list]
//
// STAC: https://dop.stac.lgln.niedersachsen.de/collections/DOP

import { createWriteStream } from 'node:fs';
import { access, mkdir, rename, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { basename, join } from 'node:path';

const STAC = 'https://dop.stac.lgln.niedersachsen.de';
const COLLECTION = 'DOP';

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
const bboxInput = String(args.bbox ?? '51.520,9.915,51.545,9.955').split(',').map(Number);
if (bboxInput.length !== 4 || bboxInput.some(Number.isNaN)) {
    console.error('error: --bbox must be minLat,minLon,maxLat,maxLon');
    process.exit(2);
}
const [minLat, minLon, maxLat, maxLon] = bboxInput;

const variant = args.rgbi ? 'dop20_rgbi' : 'dop20_rgb';
const outDir = args['out-dir'] ?? 'data-src/dop20';

// STAC bbox order is minLon,minLat,maxLon,maxLat
const url = `${STAC}/collections/${COLLECTION}/items?bbox=${minLon},${minLat},${maxLon},${maxLat}&limit=100`;
const response = await fetch(url, { headers: { Accept: 'application/json' } });
if (!response.ok) {
    console.error(`error: STAC request failed (HTTP ${response.status})`);
    process.exit(1);
}
const items = (await response.json()).features ?? [];
if (items.length === 0) {
    console.error('error: no DOP items intersect the bbox');
    process.exit(1);
}

// id = dop20rgbi_32_566_5710_2_ni_2025-03-04 -> tile key 32_566_5710, keep newest
const product = String(args.product ?? 'dop20');
const tileKey = (id) => id.replace(/^dop\d+rgbi_/, '').replace(/_\d{4}-\d{2}-\d{2}$/, '');
const selection = new Map();
for (const item of items) {
    if (!item.id.startsWith(product)) continue;
    const key = tileKey(item.id);
    const datetime = String(item.properties?.datetime ?? '');
    const current = selection.get(key);
    if (!current || datetime > current.datetime) selection.set(key, { item, datetime });
}

const chosen = [...selection.values()];
if (args.date) {
    const filtered = chosen.filter((entry) => entry.datetime.startsWith(String(args.date)));
    if (filtered.length === 0) {
        console.error(`error: no tiles for date ${args.date}`);
        process.exit(1);
    }
    chosen.length = 0;
    chosen.push(...filtered);
}

if (args.list) {
    for (const { item, datetime } of chosen) {
        console.log(`${item.id}  ${datetime.slice(0, 10)}  ${item.assets[variant]?.href}`);
    }
    process.exit(0);
}

console.log(`bbox (EPSG:4326): ${minLat}, ${minLon}, ${maxLat}, ${maxLon}`);
console.log(`tiles:  ${chosen.length} (${variant})`);

await mkdir(outDir, { recursive: true });

for (const { item, datetime } of chosen) {
    const href = item.assets[variant]?.href;
    if (!href) throw new Error(`item ${item.id} has no ${variant} asset`);
    const target = join(outDir, basename(href));
    if (!args.force && (await exists(target))) {
        console.log(`skip    ${basename(href)}`);
        continue;
    }
    process.stdout.write(`get     ${basename(href)} (${datetime.slice(0, 10)}) ... `);
    await download(href, target);
    console.log('ok');
}

console.log(`\ndone -> ${outDir}`);
