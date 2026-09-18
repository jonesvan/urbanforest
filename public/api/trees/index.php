<?php

declare(strict_types=1);

/**
 * Public read-only API for detected individual trees (LiDAR crown centroids).
 *
 *   GET /api/trees/?bbox=minLon,minLat,maxLon,maxLat&limit=1000
 *
 * Returns a GeoJSON FeatureCollection (application/geo+json). Each feature is
 * one detected crown, located at its centroid, with `height_max` (m) and
 * `area_m2` properties.
 */

const API_ZOOM = 14;
const MAX_TILES = 256;
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10000;

function fail(int $status, string $message): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    echo json_encode(['error' => $message], JSON_UNESCAPED_SLASHES);
    exit;
}

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: public, max-age=300');

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}
if ($method !== 'GET' && $method !== 'HEAD') {
    fail(405, 'method not allowed; use GET');
}

$bboxRaw = $_GET['bbox'] ?? null;
if (!is_string($bboxRaw) || $bboxRaw === '') {
    fail(400, 'missing required query parameter: bbox=minLon,minLat,maxLon,maxLat');
}

$parts = explode(',', $bboxRaw);
if (count($parts) !== 4) {
    fail(400, 'bbox must have four comma-separated numbers: minLon,minLat,maxLon,maxLat');
}

$bbox = [];
foreach ($parts as $part) {
    $part = trim($part);
    if (!is_numeric($part)) {
        fail(400, 'bbox values must be numbers');
    }
    $bbox[] = (float) $part;
}
[$minLon, $minLat, $maxLon, $maxLat] = $bbox;

if ($minLon < -180 || $maxLon > 180 || $minLat < -90 || $maxLat > 90) {
    fail(400, 'bbox out of range (WGS84 degrees)');
}
if ($minLon >= $maxLon || $minLat >= $maxLat) {
    fail(400, 'bbox must satisfy minLon < maxLon and minLat < maxLat');
}

$limit = DEFAULT_LIMIT;
if (isset($_GET['limit']) && is_numeric($_GET['limit'])) {
    $limit = max(1, min(MAX_LIMIT, (int) $_GET['limit']));
}

$lon2tile = static fn (float $lon): int => (int) floor(($lon + 180) / 360 * 2 ** API_ZOOM);
$lat2tile = static function (float $lat): int {
    $rad = $lat * M_PI / 180;
    return (int) floor((1 - log(tan($rad) + 1 / cos($rad)) / M_PI) / 2 * 2 ** API_ZOOM);
};

$x0 = $lon2tile($minLon);
$x1 = $lon2tile($maxLon);
$y0 = $lat2tile($maxLat);
$y1 = $lat2tile($minLat);

if (($x1 - $x0 + 1) * ($y1 - $y0 + 1) > MAX_TILES) {
    fail(400, 'bbox too large; narrow it to at most ' . MAX_TILES . ' z' . API_ZOOM . ' tiles');
}

$dataDir = dirname(__DIR__, 2) . '/data/trees/' . API_ZOOM;

$features = [];
foreach (range($y0, $y1) as $y) {
    foreach (range($x0, $x1) as $x) {
        $path = sprintf('%s/%d/%d.json.gz', $dataDir, $x, $y);
        if (!is_file($path)) {
            continue;
        }
        $tile = json_decode((string) gzdecode((string) file_get_contents($path)), true);
        foreach ($tile['features'] ?? [] as $feature) {
            [$lon, $lat] = $feature['geometry']['coordinates'];
            if ($lon < $minLon || $lon > $maxLon || $lat < $minLat || $lat > $maxLat) {
                continue;
            }
            $features[] = $feature;
            if (count($features) >= $limit) {
                break 3;
            }
        }
    }
}

header('Content-Type: application/geo+json; charset=utf-8');
echo json_encode([
    'type' => 'FeatureCollection',
    'features' => $features,
    'numberReturned' => count($features),
    'limit' => $limit,
    'bbox' => [$minLon, $minLat, $maxLon, $maxLat],
], JSON_UNESCAPED_SLASHES);
