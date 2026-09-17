<?php

declare(strict_types=1);

$config = require __DIR__ . '/../config.php';

$dataDir = $config['data_dir'];

$layers = [];
if (is_dir($dataDir)) {
    foreach (glob($dataDir . '/*.geojson') ?: [] as $file) {
        $name = basename($file, '.geojson');
        $layers[] = [
            'name' => $name,
            'label' => ucwords(str_replace(['-', '_'], ' ', $name)),
            'url' => 'data/' . basename($file),
            'meta' => $config['layer_meta'][$name] ?? $config['default_layer_meta'],
            'default' => $config['layer_defaults'][$name] ?? true,
        ];
    }
}

function render_layer_meta(array $meta): string
{
    if ($meta === []) {
        return '';
    }
    $html = '<dl class="layer-meta">';
    foreach ($meta as $key => $value) {
        $text = (string) $value;
        if (preg_match('~^https?://~', $text)) {
            $url = htmlspecialchars($text, ENT_QUOTES);
            $cell = '<a href="' . $url . '" target="_blank" rel="noopener">' . $url . '</a>';
        } else {
            $cell = htmlspecialchars($text, ENT_QUOTES);
        }
        $html .= '<dt>' . htmlspecialchars((string) $key) . '</dt><dd>' . $cell . '</dd>';
    }
    return $html . '</dl>';
}

$appSettings = [
    'map' => $config['map'],
    'layers' => $layers,
    'tileLayers' => $config['tile_layers'],
];
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#064e3b">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title><?= htmlspecialchars($config['app_name']) ?> — street trees</title>
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css">
<link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
<header class="topbar">
    <h1 class="brand"><?= htmlspecialchars($config['app_name']) ?></h1>
    <span class="tagline">Street trees from ESA Copernicus Urban Atlas STL &amp; OpenStreetMap</span>
    <nav class="topnav"><a href="api/">Trees API</a></nav>
</header>

<div id="map"></div>

<div id="sheet-backdrop" class="sheet-backdrop" hidden></div>

<aside id="layer-panel" class="panel" aria-label="Map layers">
    <div class="sheet-grabber" id="sheet-grabber" aria-hidden="true"></div>
    <div class="panel-head" id="panel-head" role="button" tabindex="0"
         aria-controls="panel-body" aria-expanded="false">
        <h2>Layers</h2>
        <span class="panel-chevron" aria-hidden="true"></span>
    </div>
    <div class="panel-body" id="panel-body">
    <?php if ($layers === [] && $config['tile_layers'] === []): ?>
        <p class="empty">
            No data yet. Run the pipeline in <code>scripts/</code> to populate
            <code>public/data/</code> and <code>public/tiles/</code>.
        </p>
    <?php else: ?>
        <ul id="layer-list" class="layer-list">
            <?php foreach ($layers as $layer): ?>
                <li class="layer-item">
                    <label class="layer-toggle">
                        <input type="checkbox" data-layer-id="<?= htmlspecialchars($layer['name']) ?>"
                               data-geojson-url="<?= htmlspecialchars($layer['url']) ?>"<?= $layer['default'] ? ' checked' : '' ?>>
                        <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
                        <span class="layer-name"><?= htmlspecialchars($layer['label']) ?></span>
                    </label>
                    <details class="layer-info">
                        <summary>Data &amp; model</summary>
                        <?= render_layer_meta($layer['meta']) ?>
                    </details>
                </li>
            <?php endforeach; ?>
            <?php foreach ($config['tile_layers'] as $layer): ?>
                <li class="layer-item">
                    <label class="layer-toggle">
                        <input type="checkbox" data-layer-id="<?= htmlspecialchars($layer['name']) ?>"
                               data-vector="<?= htmlspecialchars($layer['name']) ?>"<?= ($layer['default'] ?? true) ? ' checked' : '' ?>>
                        <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
                        <span class="layer-name"><?= htmlspecialchars($layer['label']) ?></span>
                    </label>
                    <details class="layer-info">
                        <summary>Data &amp; model</summary>
                        <?= render_layer_meta($layer['meta'] ?? []) ?>
                    </details>
                </li>
            <?php endforeach; ?>
        </ul>
        <p class="panel-hint">Tap the map to inspect a tree.</p>
    <?php endif; ?>
    </div>
</aside>

<div id="feature-card" class="feature-card" role="dialog" aria-label="Tree details" hidden>
    <div class="feature-card-head">
        <strong id="feature-title">Tree</strong>
        <button id="feature-close" class="feature-close" type="button" aria-label="Close">×</button>
    </div>
    <dl id="feature-body" class="feature-body"></dl>
</div>

<script id="app-settings" type="application/json"><?= json_encode($appSettings, JSON_UNESCAPED_SLASHES) ?></script>
<script src="https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js"></script>
<script src="assets/js/app.js"></script>
</body>
</html>
