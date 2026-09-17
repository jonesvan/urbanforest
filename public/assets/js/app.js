(function () {
    'use strict';

    var settings = JSON.parse(document.getElementById('app-settings').textContent);
    var params = new URLSearchParams(window.location.search);
    var mapConfig = settings.map;
    var mobileQuery = window.matchMedia('(max-width: 768px)');

    // config center is [lat, lng]; MapLibre wants [lng, lat]
    var center = [
        params.get('lng') ? parseFloat(params.get('lng')) : mapConfig.center[1],
        params.get('lat') ? parseFloat(params.get('lat')) : mapConfig.center[0]
    ];
    var zoom = params.get('zoom') ? parseFloat(params.get('zoom')) : mapConfig.zoom;

    // Basemaps: OpenFreeMap vector styles + an optional aerial raster (LGLN DOP20).
    // ?style=<name> or ?basemap=aerial selects one; otherwise the configured default.
    var aerial = settings.aerial || null;
    var styleOptions = mapConfig.style_options || {};

    function rasterFallbackStyle() {
        return {
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
        };
    }

    function aerialStyle() {
        var source = {
            type: 'raster',
            tiles: [absoluteUrl(aerial.tiles)],
            tileSize: aerial.tile_size || 256,
            maxzoom: aerial.max_zoom || 18,
            attribution: aerial.attribution || ''
        };
        if (aerial.bounds) {
            source.bounds = aerial.bounds;
        }
        return {
            version: 8,
            sources: { aerial: source },
            layers: [{ id: 'aerial', type: 'raster', source: 'aerial', paint: { 'raster-fade-duration': 0 } }]
        };
    }

    function basemapStyle(name) {
        if (name === 'aerial' && aerial) {
            return aerialStyle();
        }
        return styleOptions[name] || mapConfig.style_url || rasterFallbackStyle();
    }

    var requestedStyle = (params.get('style') || '').toLowerCase();
    var requestedBasemap = (params.get('basemap') || '').toLowerCase();
    var currentBasemap;
    if (requestedBasemap === 'aerial' && aerial) {
        currentBasemap = 'aerial';
    } else if (styleOptions[requestedStyle]) {
        currentBasemap = requestedStyle;
    } else if (styleOptions[mapConfig.default_style]) {
        currentBasemap = mapConfig.default_style;
    } else if (aerial) {
        currentBasemap = 'aerial';
    } else {
        currentBasemap = Object.keys(styleOptions)[0] || '';
    }

    var map = new maplibregl.Map({
        container: 'map',
        style: basemapStyle(currentBasemap),
        center: center,
        zoom: zoom,
        hash: false
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    map.addControl(new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false,
        showAccuracyCircle: true,
        showUserLocation: true
    }), 'bottom-right');

    map.on('error', function (event) {
        console.error('maplibre-error:', event && event.error ? event.error.message : event);
    });

    function isMobile() {
        return mobileQuery.matches;
    }

    /* ---- Feature inspection ------------------------------------------- */

    var popup = new maplibregl.Popup({ closeButton: true, maxWidth: '320px' });
    var featureCard = document.getElementById('feature-card');
    var featureTitle = document.getElementById('feature-title');
    var featureBody = document.getElementById('feature-body');

    var PROPERTY_LABELS = {
        height_max: 'Height',
        height: 'Height',
        area_m2: 'Crown area',
        circumference: 'Circumference',
        species: 'Species',
        genus: 'Genus',
        leaf_type: 'Leaf type',
        name: 'Name',
        value: 'Value',
        unit: 'Unit',
        time: 'Time',
        variable: 'Variable'
    };

    function escapeHtml(value) {
        return String(value).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function labelFor(key) {
        if (PROPERTY_LABELS[key]) {
            return PROPERTY_LABELS[key];
        }
        return key.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    }

    function formatValue(key, value) {
        if (value === null || value === undefined || value === '') {
            return '—';
        }
        if (key === 'height_max' || key === 'height') {
            var n = Number(value);
            return isNaN(n) ? String(value) : n.toFixed(n % 1 ? 1 : 0) + ' m';
        }
        if (key === 'area_m2') {
            var area = Number(value);
            return isNaN(area) ? String(value) : Math.round(area).toLocaleString() + ' m²';
        }
        if (key === 'circumference') {
            return value + ' m';
        }
        if (key === 'value' && typeof value === 'number') {
            return String(Math.round(value * 100) / 100);
        }
        return String(value);
    }

    function titleFor(properties) {
        properties = properties || {};
        return properties.variable || properties.name || properties.species || properties.genus || 'Tree';
    }

    function popupHtml(properties) {
        var keys = Object.keys(properties || {});
        if (!keys.length) {
            return 'Tree';
        }
        return keys.map(function (key) {
            return '<strong>' + escapeHtml(labelFor(key)) + ':</strong> ' + escapeHtml(formatValue(key, properties[key]));
        }).join('<br>');
    }

    function featureRowsHtml(properties) {
        var keys = Object.keys(properties || {});
        if (!keys.length) {
            return '<dt>Tree</dt><dd>No attributes</dd>';
        }
        return keys.map(function (key) {
            return '<dt>' + escapeHtml(labelFor(key)) + '</dt><dd>' + escapeHtml(formatValue(key, properties[key])) + '</dd>';
        }).join('');
    }

    function hideFeature() {
        if (featureCard.hidden) {
            return;
        }
        featureCard.classList.remove('is-visible');
        window.setTimeout(function () { featureCard.hidden = true; }, 320);
    }

    function showFeature(properties, lngLat) {
        if (!isMobile()) {
            popup.setLngLat(lngLat).setHTML(popupHtml(properties)).addTo(map);
            return;
        }
        popup.remove();
        closeSheet();
        featureTitle.textContent = titleFor(properties);
        featureBody.innerHTML = featureRowsHtml(properties);
        featureCard.hidden = false;
        window.requestAnimationFrame(function () { featureCard.classList.add('is-visible'); });
    }

    var featureClose = document.getElementById('feature-close');
    if (featureClose) {
        featureClose.addEventListener('click', hideFeature);
    }

    var boundLayers = {};

    function bindPopup(layerIds) {
        layerIds.forEach(function (id) {
            if (boundLayers[id]) {
                return;
            }
            boundLayers[id] = true;
            map.on('click', id, function (event) {
                showFeature(event.features[0].properties, event.lngLat);
            });
            map.on('mouseenter', id, function () { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', id, function () { map.getCanvas().style.cursor = ''; });
        });
    }

    map.on('click', function (event) {
        if (!isMobile() || featureCard.hidden) {
            return;
        }
        var ids = [];
        Object.keys(layerIdsByName).forEach(function (name) {
            ids = ids.concat(layerIdsByName[name]);
        });
        ids = ids.filter(function (id) {
            var layer = map.getLayer(id);
            return layer && layer.type !== 'raster';
        });
        if (ids.length && !map.queryRenderedFeatures(event.point, { layers: ids }).length) {
            hideFeature();
        }
    });

    /* ---- Bottom sheet --------------------------------------------------- */

    var panel = document.getElementById('layer-panel');
    var panelHead = document.getElementById('panel-head');
    var grabber = document.getElementById('sheet-grabber');
    var backdrop = document.getElementById('sheet-backdrop');

    function sheetPeek() {
        return panelHead.offsetTop + panelHead.offsetHeight;
    }

    function updateSheetMetrics() {
        if (!isMobile()) {
            panel.style.removeProperty('--panel-peek');
            panel.classList.remove('is-open', 'is-dragging');
            panel.style.transform = '';
            backdrop.hidden = true;
            backdrop.classList.remove('is-visible');
            panelHead.setAttribute('tabindex', '-1');
            panelHead.removeAttribute('aria-expanded');
            return;
        }
        panelHead.setAttribute('tabindex', '0');
        panelHead.setAttribute('aria-expanded', panel.classList.contains('is-open') ? 'true' : 'false');
        var peek = sheetPeek();
        if (peek > 0) {
            panel.style.setProperty('--panel-peek', Math.round(peek) + 'px');
        }
    }

    function setSheetOpen(open) {
        panel.classList.toggle('is-open', open);
        panelHead.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
            hideFeature();
            backdrop.hidden = false;
            window.requestAnimationFrame(function () { backdrop.classList.add('is-visible'); });
        } else {
            backdrop.classList.remove('is-visible');
            window.setTimeout(function () {
                if (!panel.classList.contains('is-open')) {
                    backdrop.hidden = true;
                }
            }, 280);
        }
    }

    function closeSheet() {
        if (panel.classList.contains('is-open')) {
            setSheetOpen(false);
        }
    }

    function setupSheetDrag() {
        var drag = null;

        function onDown(event) {
            if (!isMobile() || (event.button !== undefined && event.button !== 0)) {
                return;
            }
            drag = {
                startY: event.clientY,
                open: panel.classList.contains('is-open'),
                peek: sheetPeek(),
                moved: false
            };
            panel.classList.add('is-dragging');
            try { event.currentTarget.setPointerCapture(event.pointerId); } catch (err) {}
        }

        function onMove(event) {
            if (!drag) {
                return;
            }
            var delta = event.clientY - drag.startY;
            if (Math.abs(delta) > 4) {
                drag.moved = true;
            }
            var base = drag.open ? 0 : drag.peek;
            var y = Math.min(Math.max(base + delta, 0), drag.peek);
            panel.style.transform = 'translateY(' + y + 'px)';
            if (event.cancelable) {
                event.preventDefault();
            }
        }

        function onUp(event) {
            if (!drag) {
                return;
            }
            var delta = event.clientY - drag.startY;
            var base = drag.open ? 0 : drag.peek;
            var y = base + delta;
            var open;
            if (!drag.moved) {
                open = !drag.open;
            } else {
                open = y < drag.peek * 0.5;
            }
            drag = null;
            panel.classList.remove('is-dragging');
            panel.style.transform = '';
            setSheetOpen(open);
        }

        [grabber, panelHead].forEach(function (el) {
            el.addEventListener('pointerdown', onDown);
            el.addEventListener('pointermove', onMove);
            el.addEventListener('pointerup', onUp);
            el.addEventListener('pointercancel', onUp);
        });

        panelHead.addEventListener('keydown', function (event) {
            if (!isMobile()) {
                return;
            }
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setSheetOpen(!panel.classList.contains('is-open'));
            }
        });

        backdrop.addEventListener('click', closeSheet);

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                closeSheet();
                hideFeature();
            }
        });

        window.addEventListener('resize', updateSheetMetrics);
        window.addEventListener('orientationchange', function () {
            window.setTimeout(updateSheetMetrics, 250);
        });
        if (mobileQuery.addEventListener) {
            mobileQuery.addEventListener('change', function () {
                window.requestAnimationFrame(updateSheetMetrics);
            });
        }
    }

    /* ---- Layer wiring --------------------------------------------------- */

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

    function addImageLayer(config, visible) {
        var sourceId = 'image-' + config.name;
        var bounds = config.bounds; // [west, south, east, north]
        if (!map.getSource(sourceId)) {
            map.addSource(sourceId, {
                type: 'image',
                url: absoluteUrl(config.image),
                coordinates: [
                    [bounds[0], bounds[3]], // top-left (west, north)
                    [bounds[2], bounds[3]], // top-right
                    [bounds[2], bounds[1]], // bottom-right
                    [bounds[0], bounds[1]]  // bottom-left
                ]
            });
        }
        var layerId = sourceId + '-layer';
        if (!map.getLayer(layerId)) {
            map.addLayer({
                id: layerId,
                type: 'raster',
                source: sourceId,
                paint: {
                    'raster-opacity': config.opacity != null ? config.opacity : 0.75,
                    'raster-fade-duration': 0
                }
            });
        }
        register(config.name, [layerId]);
        setVisibility([layerId], visible);
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

    // Build a MapLibre color ramp from a layer style (linear across domain).
    function rampColorExpression(style) {
        if (!style || !style.property || !Array.isArray(style.ramp) || !Array.isArray(style.domain)) {
            return null;
        }
        var domain = style.domain;
        var ramp = style.ramp;
        var stops = ['interpolate', ['linear'], ['to-number', ['get', style.property]]];
        ramp.forEach(function (color, index) {
            var t = ramp.length === 1 ? 0 : index / (ramp.length - 1);
            stops.push(domain[0] + (domain[1] - domain[0]) * t);
            stops.push(color);
        });
        return stops;
    }

    function addGeoJsonLayer(layer) {
        var style = layer.style || null;
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
                    var circleColor = rampColorExpression(style) || '#1b5e20';
                    var circleRadius = (style && style.radius) || (style
                        ? ['interpolate', ['linear'], ['zoom'], 6, 6, 11, 12, 15, 18]
                        : ['interpolate', ['linear'], ['zoom'], 13, 2, 18, 5]);
                    map.addLayer({
                        id: circleId,
                        type: 'circle',
                        source: layer.name,
                        paint: {
                            'circle-radius': circleRadius,
                            'circle-color': circleColor,
                            'circle-stroke-color': (style && style.stroke) || '#f1f8e9',
                            'circle-stroke-width': 1,
                            'circle-opacity': style ? 0.8 : 0.95
                        }
                    });
                    ids.push(circleId);
                } else {
                    var fillId = layer.name + '-fill';
                    var lineId = layer.name + '-line';
                    var fillColor = rampColorExpression(style) || '#81c784';
                    map.addLayer({
                        id: fillId,
                        type: 'fill',
                        source: layer.name,
                        paint: { 'fill-color': fillColor, 'fill-opacity': style ? 0.65 : 0.42 }
                    });
                    map.addLayer({
                        id: lineId,
                        type: 'line',
                        source: layer.name,
                        paint: { 'line-color': '#2e7d32', 'line-width': 1 }
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

    function applyBasemap(name) {
        if (!name || name === currentBasemap) {
            return;
        }
        currentBasemap = name;
        map.setStyle(basemapStyle(name), { diff: false });
        map.once('style.load', function () {
            setupDataLayers();
        });

        var url = new URL(window.location.href);
        if (name === 'aerial') {
            url.searchParams.delete('style');
            url.searchParams.set('basemap', 'aerial');
        } else {
            url.searchParams.delete('basemap');
            url.searchParams.set('style', name);
        }
        window.history.replaceState(null, '', url);
    }

    function bindBasemapSelect() {
        var select = document.getElementById('basemap-select');
        if (!select) {
            return;
        }
        select.value = currentBasemap;
        select.addEventListener('change', function () {
            applyBasemap(select.value);
        });
    }

    function layerNameMaps() {
        var tileNames = {};
        (settings.tileLayers || []).forEach(function (config) { tileNames[config.name] = config; });
        var imageNames = {};
        (settings.imageLayers || []).forEach(function (config) { imageNames[config.name] = config; });
        return { tile: tileNames, image: imageNames };
    }

    // Adds the currently-checked data layers on top of whatever basemap is loaded.
    function setupDataLayers() {
        layerIdsByName = {};
        loadedGeoJson = {};
        var names = layerNameMaps();

        document.querySelectorAll('#layer-list input[data-layer-id]').forEach(function (input) {
            var name = input.getAttribute('data-layer-id');
            var geojsonUrl = input.getAttribute('data-geojson-url');
            var vectorName = input.getAttribute('data-vector');
            var imageName = input.getAttribute('data-image');

            if (imageName && names.image[imageName]) {
                addImageLayer(names.image[imageName], input.checked);
            } else if (vectorName && names.tile[vectorName]) {
                addVectorLayer(names.tile[vectorName], input.checked);
            } else if (geojsonUrl && input.checked) {
                loadedGeoJson[name] = addGeoJsonLayer({ name: name, url: geojsonUrl });
            }
        });
    }

    // Toggle listeners are attached once; they act on layerIdsByName / loadedGeoJson,
    // which setupDataLayers rebuilds whenever the basemap changes.
    function bindLayerControls() {
        var names = layerNameMaps();

        document.querySelectorAll('#layer-list input[data-layer-id]').forEach(function (input) {
            var name = input.getAttribute('data-layer-id');
            var geojsonUrl = input.getAttribute('data-geojson-url');
            var vectorName = input.getAttribute('data-vector');
            var imageName = input.getAttribute('data-image');

            input.addEventListener('change', function () {
                if ((imageName && names.image[imageName]) || (vectorName && names.tile[vectorName])) {
                    setVisibility(layerIdsByName[name] || [], input.checked);
                } else if (geojsonUrl) {
                    if (input.checked) {
                        if (!loadedGeoJson[name]) {
                            loadedGeoJson[name] = addGeoJsonLayer({ name: name, url: geojsonUrl }).then(function (ids) {
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
                }
            });
        });
    }

    map.on('load', function () {
        bindBasemapSelect();
        bindLayerControls();
        setupDataLayers();
        setupSheetDrag();
        updateSheetMetrics();
    });
})();
