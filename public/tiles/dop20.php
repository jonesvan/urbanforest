<?php

declare(strict_types=1);

/**
 * Web-Mercator (XYZ) tile proxy for the LGLN DOP20 airborne orthophoto WMS.
 *
 * The LGLN WMS serves EPSG:3857, but MapLibre's WMS tile URL only emits a
 * bbox for the built-in WMS source; this endpoint applies the slippy tile maths
 * itself and requests the matching WMS GetMap.
 *
 * Usage from a MapLibre raster source:
 *   tiles/dop20.php?z={z}&x={x}&y={y}
 */

const WMS_ENDPOINT = 'https://opendata.lgln.niedersachsen.de/doorman/noauth/dop_wms';
const WMS_LAYER = 'ni_dop20';
const TILE_SIZE = 256;
const MAX_ZOOM = 18;
const EARTH_RADIUS = 20037508.342789244;

$z = isset($_GET['z']) && ctype_digit((string) $_GET['z']) ? (int) $_GET['z'] : -1;
$x = isset($_GET['x']) && ctype_digit((string) $_GET['x']) ? (int) $_GET['x'] : -1;
$y = isset($_GET['y']) && ctype_digit((string) $_GET['y']) ? (int) $_GET['y'] : -1;

if ($z < 0 || $z > MAX_ZOOM) {
    http_response_code(400);
    exit;
}

$count = 1 << $z;
if ($x < 0 || $x >= $count || $y < 0 || $y >= $count) {
    http_response_code(404);
    exit;
}

$cacheFile = sprintf('%s/urbanforest-dop20/%d/%d/%d.jpg', sys_get_temp_dir(), $z, $x, $y);

if (!is_file($cacheFile)) {
    $span = (2 * EARTH_RADIUS) / $count;
    $minX = -EARTH_RADIUS + $x * $span;
    $maxX = $minX + $span;
    $maxY = EARTH_RADIUS - $y * $span;
    $minY = $maxY - $span;

    // Standard west,south,east,north order.
    $bbox = sprintf('%.3f,%.3f,%.3f,%.3f', $minX, $minY, $maxX, $maxY);

    $url = WMS_ENDPOINT . '?' . http_build_query([
        'SERVICE' => 'WMS',
        'VERSION' => '1.1.1',
        'REQUEST' => 'GetMap',
        'LAYERS' => WMS_LAYER,
        'STYLES' => 'default',
        'FORMAT' => 'image/jpeg',
        'SRS' => 'EPSG:3857',
        'BBOX' => $bbox,
        'WIDTH' => TILE_SIZE,
        'HEIGHT' => TILE_SIZE,
    ]);

    $data = fetch($url);
    if ($data === null || strncmp($data, "\xFF\xD8", 2) !== 0) {
        http_response_code(404);
        exit;
    }

    $dir = dirname($cacheFile);
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }
    @file_put_contents($cacheFile, $data);
}

header('Content-Type: image/jpeg');
header('Cache-Control: public, max-age=604800');
header('X-Tile-Source: LGLN DOP20');

$handle = fopen($cacheFile, 'rb');
if ($handle !== false) {
    fpassthru($handle);
    fclose($handle);
}

function fetch(string $url): ?string
{
    if (function_exists('curl_init')) {
        $handle = curl_init($url);
        curl_setopt_array($handle, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 25,
            CURLOPT_USERAGENT => 'urbanforest/1.0 (+https://urbanforest.fly.dev)',
        ]);
        $data = curl_exec($handle);
        $status = curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        curl_close($handle);
        return ($data !== false && $status === 200) ? $data : null;
    }

    $context = stream_context_create([
        'http' => ['timeout' => 25, 'header' => "User-Agent: urbanforest/1.0\r\n"],
    ]);
    $data = @file_get_contents($url, false, $context);
    return $data === false ? null : $data;
}
