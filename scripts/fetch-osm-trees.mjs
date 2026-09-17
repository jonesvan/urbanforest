#!/usr/bin/env node
// Fetch individually mapped trees (OSM natural=tree nodes) as GeoJSON points.
//
// Usage:
//   node scripts/fetch-osm-trees.mjs [--bbox=minLat,minLon,maxLat,maxLon] [--out=...]
//
// Default bbox: Göttingen.

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const DEFAULT_BBOX = [51.45, 9.80, 51.60, 10.10];
const USER_AGENT = 'urbanforest/0.1 (https://github.com/jonesvan/urbanforest)';

const KEEP_TAGS = ['species', 'genus', 'taxon', 'leaf_type', 'leaf_cycle', 'height', 'circumference', 'diameter_crown', 'denotation'];

function parseArgs(argv) {
    const args = {};
    for (const arg of argv) {
        const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
        if (match) args[match[1]] = match[2] ?? true;
    }
    return args;
}

const args = parseArgs(process.argv.slice(2));
const bbox = args.bbox ? String(args.bbox).split(',').map(Number) : DEFAULT_BBOX;
if (bbox.length !== 4 || bbox.some(Number.isNaN)) {
    console.error('error: --bbox must be minLat,minLon,maxLat,maxLon');
    process.exit(2);
}
const [minLat, minLon, maxLat, maxLon] = bbox;
const out = args.out ?? 'public/data/gottingen-trees.geojson';

const query = `[out:json][timeout:180];
node["natural"="tree"](${minLat},${minLon},${maxLat},${maxLon});
out;`;

console.error(`querying Overpass for trees in ${bbox.join(',')} ...`);
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

const features = elements
    .filter((element) => element.type === 'node')
    .map((node) => {
        const properties = { osm_id: node.id };
        for (const tag of KEEP_TAGS) {
            if (node.tags?.[tag] !== undefined) properties[tag] = node.tags[tag];
        }
        return {
            type: 'Feature',
            properties,
            geometry: { type: 'Point', coordinates: [node.lon, node.lat] },
        };
    });

const { writeFile, mkdir } = await import('node:fs/promises');
const { dirname } = await import('node:path');
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify({ type: 'FeatureCollection', features }));

console.log(`trees:  ${features.length}`);
console.log(`output: ${out}`);
