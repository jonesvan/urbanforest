(function () {
    'use strict';

    var settings = JSON.parse(document.getElementById('app-settings').textContent);
    var params = new URLSearchParams(window.location.search);
    var mapConfig = settings.map;

    // config center is [lat, lng]; MapLibre wants [lng, lat]
    var center = [
        params.get('lng') ? parseFloat(params.get('lng')) : mapConfig.center[1],
        params.get('lat') ? parseFloat(params.get('lat')) : mapConfig.center[0]
    ];
    var zoom = params.get('zoom') ? parseFloat(params.get('zoom')) : mapConfig.zoom;

    var map = new maplibregl.Map({
        container: 'map',
        style: {
            version: 8,
            sources: {
                basemap: {
                    type: 'raster',
                    tiles: [mapConfig.basemap],
                    tileSize: 256,
                    attribution: mapConfig.attribution
                }
            },
            layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }]
        },
        center: center,
        zoom: zoom,
        hash: false
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

    map.on('error', function (event) {
        console.error('maplibre-error:', event && event.error ? event.error.message : event);
    });

    var popup = new maplibregl.Popup({ closeButton: true, maxWidth: '320px' });

    function escapeHtml(value) {
        return String(value).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function popupHtml(properties) {
        var keys = Object.keys(properties || {});
        if (!keys.length) {
            return 'Tree';
        }
        return keys.map(function (key) {
            return '<strong>' + escapeHtml(key) + ':</strong> ' + escapeHtml(properties[key]);
        }).join('<br>');
    }

    function bindPopup(layerIds) {
        layerIds.forEach(function (id) {
            map.on('click', id, function (event) {
                popup.setLngLat(event.lngLat)
                    .setHTML(popupHtml(event.features[0].properties))
                    .addTo(map);
            });
            map.on('mouseenter', id, function () { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', id, function () { map.getCanvas().style.cursor = ''; });
        });
    }

    function absoluteUrl(url) {
        if (/^https?:\/\//i.test(url)) {
            return url;
        }
        // keep {z}/{x}/{y} placeholders intact (new URL() would percent-encode them)
        var base = window.location.href.split('#')[0].split('?')[0];
        return base.slice(0, base.lastIndexOf('/') + 1) + url.replace(/^\//, '');
    }

    function setVisibility(layerIds, visible) {
        layerIds.forEach(function (id) {
            if (map.getLayer(id)) {
                map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
            }
        });
    }

    // Map of layer name -> array of MapLibre layer ids
    var layerIdsByName = {};
    var loadedGeoJson = {};

    function register(name, ids) {
        layerIdsByName[name] = ids;
        return ids;
    }

    function addVectorLayer(config, visible) {
        var source = config.name;
        if (!map.getSource(source)) {
            map.addSource(source, {
                type: 'vector',
                tiles: [absoluteUrl(config.url)],
                minzoom: config.min_zoom,
                maxzoom: config.max_zoom
            });
        }
        var color = config.fill_color || '#2f9e44';
        var lineColor = config.line_color || '#1b6e34';
        var fillId = source + '-fill';
        var lineId = source + '-line';
        if (!map.getLayer(fillId)) {
            map.addLayer({
                id: fillId,
                type: 'fill',
                source: source,
                'source-layer': config.name,
                minzoom: config.min_zoom,
                paint: {
                    'fill-color': color,
                    'fill-opacity': 0.55
                }
            });
            map.addLayer({
                id: lineId,
                type: 'line',
                source: source,
                'source-layer': config.name,
                minzoom: config.min_zoom,
                paint: {
                    'line-color': lineColor,
                    'line-width': 0.5
                }
            });
        }

        var ids = [fillId, lineId];

        // below the polygon zooms, crowns are drawn as simple dots so they never vanish
        if (config.point_url) {
            var pointSource = source + '-points';
            if (!map.getSource(pointSource)) {
                map.addSource(pointSource, {
                    type: 'vector',
                    tiles: [absoluteUrl(config.point_url)],
                    minzoom: config.point_min_zoom || 0,
                    maxzoom: config.point_max_zoom || config.max_zoom
                });
            }
            var dotId = source + '-dot';
            if (!map.getLayer(dotId)) {
                map.addLayer({
                    id: dotId,
                    type: 'circle',
                    source: pointSource,
                    'source-layer': config.name,
                    maxzoom: config.min_zoom,
                    paint: {
                        'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 1.2, 10, 2, 12, 3],
                        'circle-color': color,
                        'circle-opacity': 0.8,
                        'circle-stroke-color': lineColor,
                        'circle-stroke-width': 0.3
                    }
                });
            }
            ids.push(dotId);
        }

        ids = register(config.name, ids);
        setVisibility(ids, visible);
        bindPopup(ids);
    }

    function addGeoJsonLayer(layer) {
        return fetch(layer.url)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error('Failed to load ' + layer.url + ': ' + response.status);
                }
                return response.json();
            })
            .then(function (geojson) {
                var first = geojson.features && geojson.features[0];
                var geometryType = first ? first.geometry.type : 'Point';
                var ids = [];

                if (!map.getSource(layer.name)) {
                    map.addSource(layer.name, { type: 'geojson', data: geojson });
                }

                if (geometryType === 'Point' || geometryType === 'MultiPoint') {
                    var circleId = layer.name + '-circle';
                    map.addLayer({
                        id: circleId,
                        type: 'circle',
                        source: layer.name,
                        paint: {
                            'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 1.5, 18, 4],
                            'circle-color': '#2ecc71',
                            'circle-stroke-color': '#0f5132',
                            'circle-stroke-width': 0.5,
                            'circle-opacity': 0.9
                        }
                    });
                    ids.push(circleId);
                } else {
                    var fillId = layer.name + '-fill';
                    var lineId = layer.name + '-line';
                    map.addLayer({
                        id: fillId,
                        type: 'fill',
                        source: layer.name,
                        paint: { 'fill-color': '#3fae6a', 'fill-opacity': 0.5 }
                    });
                    map.addLayer({
                        id: lineId,
                        type: 'line',
                        source: layer.name,
                        paint: { 'line-color': '#1b7f4d', 'line-width': 1 }
                    });
                    ids.push(fillId, lineId);
                }

                register(layer.name, ids);
                bindPopup(ids);
                return ids;
            })
            .catch(function (error) {
                console.error(error);
                return [];
            });
    }

    map.on('load', function () {
        var tileNames = {};
        (settings.tileLayers || []).forEach(function (config) {
            tileNames[config.name] = config;
        });

        document.querySelectorAll('#layer-list input[data-layer-id]').forEach(function (input) {
            var name = input.getAttribute('data-layer-id');
            var geojsonUrl = input.getAttribute('data-geojson-url');
            var vectorName = input.getAttribute('data-vector');

            if (vectorName && tileNames[vectorName]) {
                addVectorLayer(tileNames[vectorName], input.checked);
                input.addEventListener('change', function () {
                    setVisibility(layerIdsByName[name] || [], input.checked);
                });
            } else if (geojsonUrl) {
                var layer = { name: name, url: geojsonUrl };
                if (input.checked) {
                    loadedGeoJson[name] = addGeoJsonLayer(layer);
                }
                input.addEventListener('change', function () {
                    if (input.checked) {
                        if (!loadedGeoJson[name]) {
                            loadedGeoJson[name] = addGeoJsonLayer(layer).then(function (ids) {
                                setVisibility(ids, true);
                                return ids;
                            });
                        } else {
                            loadedGeoJson[name].then(function (ids) {
                                setVisibility(ids, true);
                            });
                        }
                    } else if (layerIdsByName[name]) {
                        setVisibility(layerIdsByName[name], false);
                    }
                });
            }
        });
    });
})();
