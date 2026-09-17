#!/usr/bin/env node
// Fetch OSM building footprints as GeoJSON polygons (way-based).
//
// Usage:
//   node scripts/fetch-osm-buildings.mjs [--bbox=minLat,minLon,maxLat,maxLon] [--out=...]

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const DEFAULT_BBOX = [51.45, 9.80, 51.60, 10.10];
const USER_AGENT = 'urbanforest/0.1 (https://github.com/jonesvan/urbanforest)';

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

function parseArgs(argv) {
    const args = {};
    for (const arg of argv) {
        const m = /^--([^=]+)(?:=(.*))?$/.exec(arg);
        if (m) args[m[1]] = m[2] ?? true;
    }
    return args;
}

const args = parseArgs(process.argv.slice(2));
const bbox = args.bbox ? String(args.bbox).split(',').map(Number) : DEFAULT_BBOX;
const [minLat, minLon, maxLat, maxLon] = bbox;
const out = args.out ?? 'data-src/gottingen-buildings.geojson';

const query = `[out:json][timeout:180];
way["building"](${minLat},${minLon},${maxLat},${maxLon});
out geom;`;

console.error(`querying Overpass for buildings in ${bbox.join(',')} ...`);
const response = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ data: query }),
});
if (!response.ok) {
    console.error(`error: Overpass request failed (HTTP ${response.status})`);
    process.exit(1);
}

const elements = (await response.json()).elements ?? [];
const features = [];
for (const el of elements) {
    if (!el.geometry || el.geometry.length < 4) continue;
    const ring = el.geometry.map((p) => [p.lon, p.lat]);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    features.push({
        type: 'Feature',
        properties: { osm_id: el.id },
        geometry: { type: 'Polygon', coordinates: [ring] },
    });
}

await mkdir(dirname(out) || '.', { recursive: true });
await writeFile(out, JSON.stringify({ type: 'FeatureCollection', features }));
console.log(`buildings: ${features.length}`);
console.log(`output:    ${out}`);
