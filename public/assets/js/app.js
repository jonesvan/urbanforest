(function () {
    'use strict';

    var settings = JSON.parse(document.getElementById('app-settings').textContent);
    var mapConfig = settings.map;

    var map = L.map('map').setView(mapConfig.center, mapConfig.zoom);

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

                if (geojson.features && geojson.features.length) {
                    map.fitBounds(layer.getBounds(), { padding: [20, 20] });
                }

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
})();
