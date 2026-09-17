<?php

declare(strict_types=1);

$scheme = (($_SERVER['HTTPS'] ?? '') !== '' && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host = $_SERVER['HTTP_HOST'] ?? 'localhost:8000';
$base = $scheme . '://' . $host;

$h = static fn (string $value): string => htmlspecialchars($value, ENT_QUOTES);
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>urbanforest — Trees API</title>
<link rel="stylesheet" href="/assets/css/style.css">
</head>
<body>
<header class="topbar">
    <h1><a href="/" style="color:inherit;text-decoration:none">urbanforest</a></h1>
    <span class="tagline">Trees API documentation</span>
    <nav class="topnav"><a href="/">&larr; Back to map</a></nav>
</header>

<main class="doc">
<div class="doc-inner">

    <h1>Trees API</h1>
    <p class="lead">
        Read-only HTTP API for the detected individual trees (LiDAR crown centroids).
        No API key, CORS enabled. Every feature is one tree crown detected from the
        1&nbsp;m LiDAR canopy height model.
    </p>

    <div class="endpoint">
        <span class="method">GET</span>
        <code id="endpoint-url">/api/trees/?bbox=minLon,minLat,maxLon,maxLat&amp;limit=1000</code>
        <button class="copy" data-copy="endpoint-url">Copy</button>
    </div>

    <h2>Parameters</h2>
    <table>
        <thead>
            <tr><th>Name</th><th>Required</th><th>Description</th></tr>
        </thead>
        <tbody>
            <tr>
                <td><code>bbox</code></td>
                <td>yes</td>
                <td>Bounding box in WGS84 degrees: <code>minLon,minLat,maxLon,maxLat</code>.
                    Must satisfy <code>minLon &lt; maxLon</code> and <code>minLat &lt; maxLat</code>.</td>
            </tr>
            <tr>
                <td><code>limit</code></td>
                <td>no</td>
                <td>Maximum number of features to return. Default <code>1000</code>,
                    maximum <code>10000</code>.</td>
            </tr>
        </tbody>
    </table>
    <p>The bbox may span at most 256 internal tiles (roughly 600&nbsp;km²); narrow it for larger areas.</p>

    <h2>Response</h2>
    <p>
        Status <code>200</code>, <code>Content-Type: application/geo+json</code>. A GeoJSON
        <code>FeatureCollection</code>:
    </p>
    <pre id="response-sample"><button class="copy copy-inline" data-copy="response-sample">Copy</button><code>{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "height_max": 22.21, "area_m2": 197 },
      "geometry": { "type": "Point", "coordinates": [9.931524, 51.537258] }
    }
  ],
  "numberReturned": 1,
  "limit": 1000,
  "bbox": [9.93, 51.53, 9.94, 51.54]
}</code></pre>

    <p>Each feature is one detected crown, located at its <strong>centroid</strong>:</p>
    <table>
        <thead>
            <tr><th>Property</th><th>Type</th><th>Description</th></tr>
        </thead>
        <tbody>
            <tr>
                <td><code>height_max</code></td>
                <td>number | null</td>
                <td>Highest canopy-height-model pixel in the crown (metres above ground).</td>
            </tr>
            <tr>
                <td><code>area_m2</code></td>
                <td>number | null</td>
                <td>Crown area in square metres.</td>
            </tr>
        </tbody>
    </table>
    <p>
        The collection also carries the foreign members <code>numberReturned</code>
        (features in this response), <code>limit</code> (effective limit) and
        <code>bbox</code> (echo of the request).
    </p>

    <h2>Try it</h2>
    <div class="try">
        <form id="try-form">
            <label>bbox
                <input id="bbox" name="bbox" value="9.93,51.53,9.94,51.54" spellcheck="false">
            </label>
            <label>limit
                <input id="limit" name="limit" value="100" inputmode="numeric">
            </label>
            <button class="btn" type="submit">Send request</button>
        </form>
        <div id="result" aria-live="polite"></div>
    </div>

    <h2>Usage examples</h2>

    <h3>curl</h3>
    <pre id="ex-curl"><button class="copy copy-inline" data-copy="ex-curl">Copy</button><code>curl "<?= $h($base) ?>/api/trees/?bbox=9.93,51.53,9.94,51.54&amp;limit=3"</code></pre>

    <h3>JavaScript</h3>
    <pre id="ex-js"><button class="copy copy-inline" data-copy="ex-js">Copy</button><code>const url = '<?= $h($base) ?>/api/trees/?bbox=9.93,51.53,9.94,51.54&amp;limit=1000';
const trees = await (await fetch(url)).json();
console.log(trees.numberReturned, trees.features[0].properties);</code></pre>

    <h3>Python (GeoPandas)</h3>
    <pre id="ex-py"><button class="copy copy-inline" data-copy="ex-py">Copy</button><code>import geopandas as gpd

gdf = gpd.read_file(
    "<?= $h($base) ?>/api/trees/?bbox=9.93,51.53,9.94,51.54&amp;limit=10000"
)</code></pre>

    <h2>Errors</h2>
    <p>Errors are JSON (<code>{"error": "..."}</code>) with a <code>4xx</code> status:</p>
    <table>
        <thead>
            <tr><th>Status</th><th>Cause</th></tr>
        </thead>
        <tbody>
            <tr><td><code>400</code></td><td>Missing or invalid <code>bbox</code>, or the box spans more than 256 tiles.</td></tr>
            <tr><td><code>405</code></td><td>Method other than <code>GET</code>, <code>HEAD</code> or <code>OPTIONS</code>.</td></tr>
        </tbody>
    </table>

    <h2>Data &amp; attribution</h2>
    <ul>
        <li>Source: LGLN OpenGeoData LiDAR (<code>DOM1 − DGM1</code>, 1&nbsp;m, 2016), watershed crown detection.</li>
        <li>Coverage: Göttingen city boundary (~117&nbsp;km²), 905,088 crowns.</li>
        <li>Detected crowns are <em>detectable</em> trees only — occluded or young trees will be missing.</li>
        <li>© LGLN Niedersachsen (CC0 / DL-DE-BY-2.0); map data © OpenStreetMap contributors (ODbL).</li>
        <li>Method and limits: <a href="https://github.com/jonesvan/urbanforest/blob/main/docs/tree-detection.md">docs/tree-detection.md</a>.</li>
    </ul>

    <footer>
        <a href="/">&larr; Back to the map</a> ·
        <a href="https://github.com/jonesvan/urbanforest">Source on GitHub</a>
    </footer>

</div>
</main>

<script>
(function () {
    'use strict';

    document.querySelectorAll('button[data-copy]').forEach(function (button) {
        button.addEventListener('click', function () {
            var target = document.getElementById(button.getAttribute('data-copy'));
            if (!target) return;
            var done = function () {
                var original = button.textContent;
                button.textContent = 'Copied';
                setTimeout(function () { button.textContent = original; }, 1200);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(target.innerText).then(done, done);
            } else {
                done();
            }
        });
    });

    var form = document.getElementById('try-form');
    var result = document.getElementById('result');

    form.addEventListener('submit', function (event) {
        event.preventDefault();
        var bbox = document.getElementById('bbox').value.trim();
        var limit = document.getElementById('limit').value.trim() || '1000';
        var url = 'trees/?bbox=' + encodeURIComponent(bbox) + '&limit=' + encodeURIComponent(limit);
        var started = performance.now();

        result.innerHTML = '<div class="status">Requesting <code>' + url + '</code> …</div>';

        fetch(url, { headers: { Accept: 'application/geo+json' } })
            .then(function (response) {
                return response.text().then(function (text) {
                    return { response: response, text: text };
                });
            })
            .then(function (out) {
                var ms = Math.round(performance.now() - started);
                var pretty = out.text;
                try { pretty = JSON.stringify(JSON.parse(out.text), null, 2); } catch (e) {}
                if (pretty.length > 4000) pretty = pretty.slice(0, 4000) + '\n… (truncated)';
                result.innerHTML = '<div class="status ' + (out.response.ok ? 'ok' : 'err') + '">HTTP '
                    + out.response.status + ' · ' + ms + ' ms</div>';
                var pre = document.createElement('pre');
                pre.textContent = pretty;
                result.appendChild(pre);
            })
            .catch(function (error) {
                result.innerHTML = '<div class="status err">' + String(error) + '</div>';
            });
    });
})();
</script>
</body>
</html>
