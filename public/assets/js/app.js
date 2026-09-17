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
    // Renderer is switchable: default = Leaflet.VectorGrid (SVG), ?renderer=webgl = deck.gl.
    var tileConfigs = settings.tileLayers || [];
    var activeTiles = {};

    function hexToRgba(hex, alpha) {
        var value = String(hex).replace('#', '');
        if (value.length === 3) {
            value = value.split('').map(function (c) { return c + c; }).join('');
        }
        var n = parseInt(value, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
    }

    function tooltipText(properties) {
        return Object.keys(properties).map(function (key) {
            return key + ': ' + properties[key];
        }).join('\n');
    }

    function bindTileToggles(onChange) {
        document.querySelectorAll('#layer-list input[data-tile-layer]').forEach(function (input) {
            var name = input.getAttribute('data-tile-layer');
            activeTiles[name] = input.checked;
            input.addEventListener('change', function () {
                activeTiles[name] = input.checked;
                onChange();
            });
        });
    }

    function initVectorGrid() {
        var loaded = {};

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
                rendererFactory: L.svg.tile
            });

            layer.on('click', function (event) {
                L.popup()
                    .setLatLng(event.latlng)
                    .setContent(popupHtml(event.layer.properties || {}))
                    .openOn(map);
            });

            return layer;
        }

        function sync() {
            tileConfigs.forEach(function (config) {
                var name = config.name;
                if (activeTiles[name]) {
                    if (!loaded[name]) {
                        loaded[name] = addTileLayer(config);
                    }
                    map.addLayer(loaded[name]);
                } else if (loaded[name]) {
                    map.removeLayer(loaded[name]);
                }
            });
        }

        bindTileToggles(sync);
        sync();
    }

    function initDeck() {
        var canvas = document.createElement('canvas');
        canvas.id = 'deck-canvas';
        document.getElementById('map').appendChild(canvas);

        function viewState() {
            var center = map.getCenter();
            return {
                longitude: center.lng,
                latitude: center.lat,
                zoom: map.getZoom(),
                bearing: 0,
                pitch: 0
            };
        }

        var deckOverlay = new deck.Deck({
            canvas: canvas,
            controller: false,
            initialViewState: viewState(),
            layers: [],
            getTooltip: function (info) {
                return info && info.object
                    ? { text: tooltipText(info.object.properties || {}) }
                    : null;
            }
        });

        function updateLayers() {
            var debug = params.get('debug') === '1';
            var layers = tileConfigs.filter(function (config) {
                return activeTiles[config.name];
            }).map(function (config) {
                return new deck.MVTLayer({
                    id: config.name,
                    data: config.url,
                    minZoom: config.min_zoom,
                    maxZoom: config.max_zoom,
                    tileSize: 256,
                    onTileLoad: debug ? function (tile) { console.log('tile-load', JSON.stringify(tile.index)); } : undefined,
                    onTileError: debug ? function (err, tile) { console.log('tile-error', JSON.stringify(tile && tile.index), String(err).slice(0, 120)); } : undefined,
                    getFillColor: hexToRgba(config.fill_color || '#e67e22', 140),
                    getLineColor: hexToRgba('#8a4b12', 200),
                    lineWidthMinPixels: 0.5,
                    pickable: true,
                    autoHighlight: true,
                    highlightColor: [255, 255, 255, 130]
                });
            });
            deckOverlay.setProps({ layers: layers });
        }

        map.on('move zoom resize', function () {
            deckOverlay.setProps({ viewState: viewState() });
        });

        // deck's canvas has pointer-events:none, so Leaflet keeps pan/zoom and we pick on click
        map.on('click', function (event) {
            var point = map.latLngToContainerPoint(event.latlng);
            var info = deckOverlay.pickObject({
                x: point.x,
                y: point.y,
                radius: 3,
                layerIds: tileConfigs.map(function (config) { return config.name; })
            });
            if (info && info.object) {
                L.popup()
                    .setLatLng(event.latlng)
                    .setContent(popupHtml(info.object.properties || {}))
                    .openOn(map);
            }
        });

        bindTileToggles(updateLayers);
        updateLayers();
    }

    var renderer = params.get('renderer') || 'svg';
    if (renderer === 'webgl' && typeof window.deck !== 'undefined' && window.deck.MVTLayer) {
        initDeck();
    } else {
        if (renderer === 'webgl') {
            console.warn('deck.gl not available, falling back to the VectorGrid renderer');
        }
        initVectorGrid();
    }
})();
