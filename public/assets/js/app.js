(function () {
    'use strict';

    var settings = JSON.parse(document.getElementById('app-settings').textContent);
    var mapConfig = settings.map;

    var params = new URLSearchParams(window.location.search);
    var center = [
        parseFloat(params.get('lat')) || mapConfig.center[0],
        parseFloat(params.get('lng')) || mapConfig.center[1]
    ];
    var zoom = parseInt(params.get('zoom'), 10) || mapConfig.zoom;

    var map = L.map('map', { preferCanvas: true }).setView(center, zoom);

    L.tileLayer(mapConfig.basemap, {
        attribution: mapConfig.attribution,
        maxZoom: 19
    }).addTo(map);

    var streetTreeStyle = {
        color: '#1b7f4d',
        weight: 1,
        fillColor: '#3fae6a',
        fillOpacity: 0.5
    };

    var treePointStyle = {
        radius: 2.5,
        color: '#0f5132',
        weight: 0.5,
        fillColor: '#2ecc71',
        fillOpacity: 0.9
    };

    function popupHtml(properties) {
        var keys = Object.keys(properties);
        if (!keys.length) {
            return 'Tree';
        }
        return keys.map(function (key) {
            return '<strong>' + key + ':</strong> ' + properties[key];
        }).join('<br>');
    }

    function addLayer(url) {
        return fetch(url)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('Failed to load ' + url + ': ' + response.status);
                }
                return response.json();
            })
            .then(function (geojson) {
                var layer = L.geoJSON(geojson, {
                    style: streetTreeStyle,
                    pointToLayer: function (feature, latlng) {
                        return L.circleMarker(latlng, treePointStyle);
                    },
                    onEachFeature: function (feature, featureLayer) {
                        featureLayer.bindPopup(popupHtml(feature.properties || {}));
                    }
                }).addTo(map);

                return layer;
            })
            .catch(function (error) {
                console.error(error);
            });
    }

    var loaded = {};

    document.querySelectorAll('#layer-list input[data-layer-url]').forEach(function (input) {
        var url = input.getAttribute('data-layer-url');

        input.addEventListener('change', function () {
            if (input.checked) {
                if (!loaded[url]) {
                    loaded[url] = addLayer(url);
                } else {
                    loaded[url].then(function (layer) {
                        if (layer) {
                            map.addLayer(layer);
                        }
                    });
                }
            } else if (loaded[url]) {
                loaded[url].then(function (layer) {
                    if (layer) {
                        map.removeLayer(layer);
                    }
                });
            }
        });

        input.dispatchEvent(new Event('change'));
    });

    // Vector-tile layers (pre-tiled with geojson-vt/vt-pbf), served per viewport.
    var tileConfigs = settings.tileLayers || [];
    var tileLayers = {};
    var tileLoaded = {};

    tileConfigs.forEach(function (config) {
        tileLayers[config.name] = config;
    });

    function addTileLayer(config) {
        var color = config.fill_color || '#e67e22';
        var styles = {};
        styles[config.name] = {
            fill: true,
            fillColor: color,
            fillOpacity: 0.55,
            color: color,
            weight: 0.5
        };

        var layer = L.vectorGrid.protobuf(config.url, {
            minZoom: config.min_zoom,
            maxNativeZoom: config.max_zoom,
            maxZoom: 19,
            interactive: true,
            vectorTileLayerStyles: styles,
            rendererFactory: L.canvas.tile
        });

        layer.on('click', function (event) {
            var properties = event.layer.properties || {};
            L.popup()
                .setLatLng(event.latlng)
                .setContent(popupHtml(properties))
                .openOn(map);
        });

        return layer;
    }

    document.querySelectorAll('#layer-list input[data-tile-layer]').forEach(function (input) {
        var name = input.getAttribute('data-tile-layer');
        var config = tileLayers[name];
        if (!config) {
            return;
        }

        input.addEventListener('change', function () {
            if (input.checked) {
                if (!tileLoaded[name]) {
                    tileLoaded[name] = addTileLayer(config);
                }
                map.addLayer(tileLoaded[name]);
            } else if (tileLoaded[name]) {
                map.removeLayer(tileLoaded[name]);
            }
        });

        input.dispatchEvent(new Event('change'));
    });
})();
