<?php

declare(strict_types=1);

return [
    'app_name' => 'urbanforest',

    'data_dir' => __DIR__ . '/public/data',

    'map' => [
        'center' => [51.5336, 9.9352],
        'zoom' => 13,
        'basemap' => 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'attribution' => '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    ],

    'tile_layers' => [
        [
            'name' => 'crowns',
            'label' => 'Detected tree crowns (LiDAR)',
            'url' => 'tiles/crowns/{z}/{x}/{y}.pbf',
            'min_zoom' => 13,
            'max_zoom' => 15,
            'fill_color' => '#e67e22',
        ],
    ],

    'copernicus' => [
        'stac_api' => 'https://stac.dataspace.copernicus.eu/v1',
        'collection' => 'clms_urban-atlas_street-tree-layer_europe_V005ha_vector_static_v01',
        's3_https' => 'https://eodata.dataspace.copernicus.eu',
        'token_url' => 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token',
    ],
];
