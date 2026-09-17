<?php

declare(strict_types=1);

return [
    'app_name' => 'urbanforest',

    'data_dir' => __DIR__ . '/public/data',

    'map' => [
        'center' => [51.5336, 9.9352],
        'zoom' => 13,
        // Vector basemap: OpenFreeMap Liberty (OpenStreetMap, no API key).
        'default_style' => 'liberty',
        'style_url' => 'https://tiles.openfreemap.org/styles/liberty',
        'style_options' => [
            'liberty' => 'https://tiles.openfreemap.org/styles/liberty',
        ],
        'style_labels' => [
            'liberty' => 'Liberty',
        ],
        // Raster fallback if no vector style is configured.
        'basemap' => 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        'attribution' => '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    ],

    // Optional airborne base map: LGLN DOP20 orthophoto (Lower Saxony, 20 cm,
    // open data), served through the tiles/dop20.php Web-Mercator proxy.
    // Set to null to hide the aerial option.
    'aerial' => [
        'label' => 'Aerial',
        'tiles' => 'tiles/dop20.php?z={z}&x={x}&y={y}',
        'tile_size' => 256,
        'max_zoom' => 18,
        'bounds' => [6.5, 51.1, 11.76, 54.15],
        'attribution' => 'Aerial orthophoto © LGLN Niedersachsen (DOP20, open data)',
    ],

    'tile_layers' => [
        [
            'name' => 'crowns',
            'label' => 'Detected tree crowns (LiDAR)',
            'url' => 'tiles/crowns/{z}/{x}/{y}.pbf',
            'min_zoom' => 13,
            'max_zoom' => 17,
            'point_url' => 'tiles/crown-points/{z}/{x}/{y}.pbf',
            'point_min_zoom' => 6,
            'point_max_zoom' => 12,
            'default' => true,
            'fill_color' => '#4caf50',
            'line_color' => '#1b5e20',
            'meta' => [
                'Source' => 'LGLN OpenGeoData — DOM1 (surface) + DGM1 (terrain), airborne LiDAR',
                'Provider' => 'LGLN Niedersachsen',
                'Reference year' => '2016',
                'Data' => 'Canopy height model DOM1 − DGM1, 1 m',
                'Model' => 'Local-maxima seeds + watershed segmentation (scikit-image) — no machine learning',
                'Building mask' => 'OpenStreetMap footprints (Overpass)',
                'Known limits' => '1 m data merges adjacent crowns; some building false positives remain',
                'Licence' => 'CC0 / DL-DE-BY-2.0',
                'STAC' => 'https://dom.stac.lgln.niedersachsen.de',
            ],
        ],
    ],

    // Detail shown under each GeoJSON layer; keyed by file name (without extension).
    'layer_meta' => [
        'gottingen-street-trees' => [
            'Source' => 'ESA Copernicus — Urban Atlas Street Tree Layer (STL)',
            'Provider' => 'European Environment Agency (EEA) / Copernicus Land Monitoring Service',
            'Reference year' => '2021',
            'Data' => 'Satellite-derived tree patches/rows, vector, 2 m',
            'Model' => 'None — published vector product (satellite image interpretation)',
            'Known limits' => 'Minimum mapping unit 500 m² / width 10 m — isolated trees below that are not mapped',
            'Licence' => 'Copernicus open data',
            'DOI' => 'https://doi.org/10.2909/205691b3-7ae9-41dd-abf1-1fbf60d72c8c',
        ],
        'gottingen-trees' => [
            'Source' => 'OpenStreetMap — natural=tree nodes',
            'Provider' => 'OpenStreetMap contributors',
            'Data' => 'Individually mapped trees',
            'Model' => 'None — community mapping (Overpass API extract)',
            'Known limits' => 'Coverage is incomplete and uneven; only trees that were mapped appear',
            'Licence' => 'ODbL',
            'API' => 'https://overpass-api.de/api/interpreter',
        ],
    ],

    // Georeferenced PNG heatmap overlays (MapLibre "image" source), drawn over
    // the basemap. bounds = [west, south, east, north] must match the PNG extent.
    'image_layers' => [
        [
            'name' => 'temperature',
            'label' => 'Air temperature (heatmap)',
            'image' => 'data/gottingen-temperature.png',
            'bounds' => [9.0, 51.0, 11.0, 52.0],
            'opacity' => 0.72,
            'default' => false,
            'meta' => [
                'Source' => 'Copernicus Climate Change Service (C3S) — ERA5 reanalysis',
                'Provider' => 'ECMWF on behalf of the European Union',
                'Variable' => '2 m air temperature',
                'Rendering' => 'Inverse-distance interpolation of the native ERA5 grid (~0.25°); colour range auto-scaled',
                'Access' => 'Open-Meteo Historical Weather API; direct CDS route in scripts/fetch-climate.py',
                'Known limits' => '~25 km grid cell — a coarse regional field, not an urban heat-island measurement',
                'Licence' => 'Copernicus open data (CC-BY-4.0)',
                'Attribution' => 'Contains modified Copernicus Climate Change Service information (ERA5); data via Open-Meteo',
                'Docs' => 'https://cds.climate.copernicus.eu',
            ],
        ],
        [
            'name' => 'co2',
            'label' => 'Carbon dioxide (heatmap)',
            'image' => 'data/gottingen-co2.png',
            'bounds' => [9.0, 51.0, 11.0, 52.0],
            'opacity' => 0.72,
            'default' => false,
            'meta' => [
                'Source' => 'Copernicus Atmosphere Monitoring Service (CAMS) — global greenhouse gas forecasts',
                'Provider' => 'ECMWF on behalf of the European Union',
                'Variable' => 'Surface carbon dioxide (CO₂)',
                'Rendering' => 'Inverse-distance interpolation of the native CAMS grid (~0.1°); colour range auto-scaled',
                'Access' => 'Open-Meteo Air Quality API; direct ADS route in scripts/fetch-climate.py',
                'Known limits' => 'Well-mixed background CO₂ — not a local emission inventory',
                'Licence' => 'Copernicus open data (CC-BY-4.0)',
                'Attribution' => 'Copernicus Atmosphere Monitoring Service (CAMS) information; data via Open-Meteo',
                'Docs' => 'https://ads.atmosphere.copernicus.eu',
            ],
        ],
    ],

    'default_layer_meta' => [
        'Source' => 'unknown',
    ],

    // Which GeoJSON layers are switched on when the page loads (unlisted => on).
    'layer_defaults' => [
        'gottingen-street-trees' => false,
        'gottingen-trees' => false,
    ],

    'copernicus' => [
        'stac_api' => 'https://stac.dataspace.copernicus.eu/v1',
        'collection' => 'clms_urban-atlas_street-tree-layer_europe_V005ha_vector_static_v01',
        's3_https' => 'https://eodata.dataspace.copernicus.eu',
        'token_url' => 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token',
    ],
];
