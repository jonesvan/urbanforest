#!/usr/bin/env node
// Download the Urban Atlas Street Tree Layer for a Functional Urban Area.
//
// Usage:
//   node scripts/fetch-stl.mjs --fua=GOTTINGEN [--year=2021] [--out=data-src/stl.fgb]
//   node scripts/fetch-stl.mjs --bbox=16.2,48.1,16.6,48.3 [--out=data-src/stl.fgb]
//   node scripts/fetch-stl.mjs --fua=WIEN --list
//
// Auth (Copernicus Data Space Ecosystem):
//   CDSE_TOKEN=<bearer>            use an existing access token, or
//   CDSE_USER=<user> CDSE_PASS=<pass>   fetch a token via password grant

import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { dirname } from 'node:path';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

const STAC_API = 'https://stac.dataspace.copernicus.eu/v1';
const COLLECTION = 'clms_urban-atlas_street-tree-layer_europe_V005ha_vector_static_v01';
const TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token';
const S3_ENDPOINT = 'https://eodata.dataspace.copernicus.eu';
const S3_CREDENTIALS_URL = 'https://s3-keys-manager.cloudferro.com/api/user/credentials';

function parseArgs(argv) {
    const args = {};
    for (const arg of argv) {
        const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
        if (!match) continue;
        args[match[1]] = match[2] ?? true;
    }
    return args;
}

function fail(message) {
    console.error(`error: ${message}`);
    process.exit(1);
}

async function getToken() {
    if (process.env.CDSE_TOKEN) return process.env.CDSE_TOKEN;

    const { CDSE_USER, CDSE_PASS } = process.env;
    if (!CDSE_USER || !CDSE_PASS) {
        fail('set CDSE_TOKEN, or CDSE_USER and CDSE_PASS (free account at https://dataspace.copernicus.eu)');
    }

    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        body: new URLSearchParams({
            client_id: 'cdse-public',
            grant_type: 'password',
            username: CDSE_USER,
            password: CDSE_PASS,
        }),
    });

    if (!response.ok) fail(`could not obtain CDSE token (HTTP ${response.status})`);
    const data = await response.json();
    if (!data.access_token) fail('token response did not contain an access_token');
    return data.access_token;
}

async function findItem(args) {
    const params = new URLSearchParams({ limit: '100' });
    if (args.bbox) params.set('bbox', args.bbox);

    const fua = typeof args.fua === 'string' ? args.fua.trim().toUpperCase() : null;
    const year = typeof args.year === 'string' ? args.year : null;
    if (fua) params.set('filter', `id LIKE '%${fua.replace(/'/g, "''")}%'`);

    const url = `${STAC_API}/collections/${COLLECTION}/items?${params}`;
    const response = await fetch(url);
    if (!response.ok) fail(`STAC request failed (HTTP ${response.status})`);

    const items = (await response.json()).features ?? [];

    const matches = items.filter((item) => {
        const props = item.properties ?? {};
        const itemFua = String(props._private?.odata?.fuaName ?? props['region:name'] ?? '').toUpperCase();
        const itemYear = String(props.datetime ?? '').slice(0, 4);
        if (fua && !itemFua.includes(fua)) return false;
        if (year && itemYear !== year) return false;
        return true;
    });

    if (args.list) {
        for (const item of items) {
            const p = item.properties ?? {};
            const key = item.assets?.data?.href ?? '';
            console.log(`${item.id}\n  ${p['region:name'] ?? '?'} (${p['region:country'] ?? '?'})  ${String(p.datetime ?? '').slice(0, 10)}\n  ${key}`);
        }
        process.exit(0);
    }

    if (matches.length === 0) fail('no STL item matched --fua/--year (use --list to inspect available items)');
    if (matches.length > 1) fail(`several items matched, narrow the query: ${matches.map((m) => m.id).join(', ')}`);
    return matches[0];
}

async function getS3Credentials(token) {
    const response = await fetch(S3_CREDENTIALS_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!response.ok) fail(`could not create S3 credentials (HTTP ${response.status})`);
    const data = await response.json();
    return { accessKeyId: data.access_id, secretAccessKey: data.secret };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const item = await findItem(args);

    const href = item.assets?.data?.href;
    if (!href) fail('matched item has no "data" asset');
    if (!href.startsWith('s3://')) fail(`unexpected asset href (not on S3): ${href}`);

    const [bucket, ...keyParts] = href.replace(/^s3:\/\//, '').split('/');
    const key = keyParts.join('/');
    const out = args.out ?? `${String(args.fua ?? 'stl').toLowerCase()}-stl.fgb`;

    const token = await getToken();
    const credentials = await getS3Credentials(token);

    // The key pair needs a moment before the object storage accepts it.
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const client = new S3Client({
        region: 'us-east-1',
        endpoint: S3_ENDPOINT,
        forcePathStyle: true,
        credentials,
    });

    console.log(`item:   ${item.id}`);
    console.log(`fua:    ${item.properties['region:name']} (${item.properties['region:country']})`);
    console.log(`source: ${href}`);
    console.log(`target: ${out}`);

    await mkdir(dirname(out), { recursive: true });

    try {
        const { Body, ContentLength } = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        await pipeline(Body, createWriteStream(out));
        const { size } = await stat(out);
        console.log(`done:   ${out} (${size} bytes${ContentLength ? `, expected ${ContentLength}` : ''})`);
    } catch (error) {
        await rm(out, { force: true });
        fail(`download failed: ${error.message}`);
    }
}

main().catch((error) => fail(error.message));
