#!/usr/bin/env node
// Convert a Copernicus Street Tree Layer FlatGeobuf into WGS84 GeoJSON.
//
// Usage:
//   node scripts/convert-stl.mjs <input.fgb> <output.geojson>

import { readFile, writeFile } from 'node:fs/promises';
import { deserialize } from 'flatgeobuf/lib/mjs/geojson.js';
import proj4 from 'proj4';

proj4.defs('EPSG:3035', '+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');

const [input, output] = process.argv.slice(2);
if (!input || !output) {
    console.error('usage: node scripts/convert-stl.mjs <input.fgb> <output.geojson>');
    process.exit(2);
}

const transform = proj4('EPSG:3035', 'EPSG:4326');

function round(value) {
    return Math.round(value * 1e6) / 1e6;
}

function transformPosition([x, y, z]) {
    const [lon, lat] = transform.forward([x, y]);
    return z === undefined ? [round(lon), round(lat)] : [round(lon), round(lat), z];
}

function transformRing(ring) {
    return ring.map(transformPosition);
}

function transformGeometry(geometry) {
    switch (geometry.type) {
        case 'Point':
            return { type: 'Point', coordinates: transformPosition(geometry.coordinates) };
        case 'LineString':
            return { type: 'LineString', coordinates: geometry.coordinates.map(transformPosition) };
        case 'Polygon':
            return { type: 'Polygon', coordinates: geometry.coordinates.map(transformRing) };
        case 'MultiPoint':
            return { type: 'MultiPoint', coordinates: geometry.coordinates.map(transformPosition) };
        case 'MultiLineString':
            return { type: 'MultiLineString', coordinates: geometry.coordinates.map((line) => line.map(transformPosition)) };
        case 'MultiPolygon':
            return { type: 'MultiPolygon', coordinates: geometry.coordinates.map((polygon) => polygon.map(transformRing)) };
        default:
            throw new Error(`unsupported geometry type: ${geometry.type}`);
    }
}

const bytes = new Uint8Array(await readFile(input));

let crs = null;
const features = [];

for await (const feature of deserialize(bytes, undefined, (meta) => {
    crs = meta.crs;
})) {
    if (!feature.geometry) continue;
    features.push({
        type: 'Feature',
        properties: feature.properties,
        geometry: transformGeometry(feature.geometry),
    });
}

if (features.length === 0) {
    console.error('error: no features found in input');
    process.exit(1);
}

console.log(`crs:      ${crs ? `${crs.org ?? ''}:${crs.code ?? ''}` : 'assumed EPSG:3035'}`);
console.log(`features: ${features.length}`);

await writeFile(output, JSON.stringify({ type: 'FeatureCollection', features }));

const first = features[0].geometry;
const sample = first.type === 'Polygon' ? first.coordinates[0][0] : first.coordinates[0];
console.log(`output:   ${output}`);
console.log(`sample:   ${sample.join(', ')}`);
