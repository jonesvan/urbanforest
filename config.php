<?php

declare(strict_types=1);

return [
    'app_name' => 'urbanforest',

    'data_dir' => __DIR__ . '/public/data',

    'map' => [
        'center' => [51.5336, 9.9352],
        'zoom' => 12,
        'basemap' => 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'attribution' => '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    ],

    'copernicus' => [
        'stac_api' => 'https://stac.dataspace.copernicus.eu/v1',
        'collection' => 'clms_urban-atlas_street-tree-layer_europe_V005ha_vector_static_v01',
        's3_https' => 'https://eodata.dataspace.copernicus.eu',
        'token_url' => 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token',
    ],
];
