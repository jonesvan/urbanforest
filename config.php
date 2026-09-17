<?php

declare(strict_types=1);

return [
    'app_name' => 'urbanforest',

    'data_dir' => __DIR__ . '/public/data',

    'map' => [
        'center' => [51.5336, 9.9352],
        'zoom' => 13,
        // OpenFreeMap vector basemap (OpenStreetMap data, no API key). Set to ''
        // to fall back to the raster sources below.
        'style_url' => 'https://tiles.openfreemap.org/styles/positron',
        'style_options' => [
            'positron' => 'https://tiles.openfreemap.org/styles/positron',
            'liberty' => 'https://tiles.openfreemap.org/styles/liberty',
            'bright' => 'https://tiles.openfreemap.org/styles/bright',
            'dark' => 'https://tiles.openfreemap.org/styles/dark',
        ],
        'basemap' => 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        'attribution' => '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
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
            'fill_color' => '#10b981',
            'line_color' => '#047857',
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
        'gottingen-temperature' => [
            'Source' => 'Copernicus Climate Change Service (C3S) — ERA5 reanalysis',
            'Provider' => 'ECMWF on behalf of the European Union',
            'Variable' => '2 m air temperature',
            'Data' => 'Hourly reanalysis, regridded to the native ERA5 grid (~0.25°)',
            'Model' => 'None — reanalysis product. Retrieved with the CDS API (scripts/fetch-climate.py)',
            'Known limits' => '~25 km grid cell — a coarse regional value, not an urban heat-island measurement',
            'Licence' => 'Copernicus open data (CC-BY-4.0)',
            'Docs' => 'https://cds.climate.copernicus.eu',
        ],
        'gottingen-co2' => [
            'Source' => 'Copernicus Atmosphere Monitoring Service (CAMS) — global greenhouse gas forecasts',
            'Provider' => 'ECMWF on behalf of the European Union',
            'Variable' => 'Surface carbon dioxide (CO₂)',
            'Data' => 'Global forecast fields (surface), ~0.1°',
            'Model' => 'None — atmospheric model product. Retrieved with the ADS API (scripts/fetch-climate.py)',
            'Known limits' => 'Well-mixed background CO₂ — not a local emission inventory',
            'Licence' => 'Copernicus open data (CC-BY-4.0)',
            'Docs' => 'https://ads.atmosphere.copernicus.eu',
        ],
    ],

    // Optional per-layer rendering hints for GeoJSON layers.
    // ramp: color scale mapped linearly across domain (min, max) on `property`.
    'layer_styles' => [
        'gottingen-temperature' => [
            'type' => 'circle',
            'property' => 'value',
            'unit' => '°C',
            'domain' => [-10, 35],
            'ramp' => ['#1d4ed8', '#22d3ee', '#facc15', '#f97316', '#dc2626'],
            'stroke' => 'rgba(255, 255, 255, 0.85)',
        ],
        'gottingen-co2' => [
            'type' => 'circle',
            'property' => 'value',
            'unit' => 'ppm',
            'domain' => [395, 440],
            'ramp' => ['#a7f3d0', '#fde68a', '#fb923c', '#ef4444', '#7f1d1d'],
            'stroke' => 'rgba(255, 255, 255, 0.85)',
        ],
    ],

    'default_layer_meta' => [
        'Source' => 'unknown',
    ],

    // Which GeoJSON layers are switched on when the page loads (unlisted => on).
    'layer_defaults' => [
        'gottingen-street-trees' => false,
        'gottingen-trees' => false,
        'gottingen-temperature' => false,
        'gottingen-co2' => false,
    ],

    'copernicus' => [
        'stac_api' => 'https://stac.dataspace.copernicus.eu/v1',
        'collection' => 'clms_urban-atlas_street-tree-layer_europe_V005ha_vector_static_v01',
        's3_https' => 'https://eodata.dataspace.copernicus.eu',
        'token_url' => 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token',
    ],
];
