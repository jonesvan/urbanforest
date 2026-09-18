#!/usr/bin/env python
"""Fetch open Sensor.Community station data and write fine-grained map layers.

Sensor.Community (formerly luftdaten.info) is a volunteer network of air-quality
and weather sensors. Around Göttingen dozens of nodes measure air temperature
(BME280 / SHT30 / DHT22) and particulate matter (SDS011 / SPS30) at street level
every ~5 minutes -- far finer than any gridded model (ERA5 ~25 km, CAMS ~11 km).

The latest readings are written as small GeoJSON point layers that the map draws
as coloured station dots with a value popup:

    public/data/gottingen-temperature.geojson
    public/data/gottingen-air-quality.geojson

Usage:
    python3 scripts/fetch-stations.py --bbox=9.85,51.45,10.05,51.60

    # only one variable:
    python3 scripts/fetch-stations.py --vars=air-quality
"""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request

ENDPOINT = "https://data.sensor.community/airrohr/v1/filter/box={box}"
USER_AGENT = "urbanforest/0.1 (+https://github.com/jonesvan/urbanforest)"
SOURCE = "Sensor.Community"

DEFAULT_BBOX = "9.85,51.45,10.05,51.60"  # Göttingen, Lower Saxony

# Preference order when one location reports through several sensors.
TEMP_SENSORS = ("BME280", "SHT30", "DHT22")
PM_SENSORS = ("SDS011", "SPS30", "PMS")


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--bbox", default=DEFAULT_BBOX, help="minLon,minLat,maxLon,maxLat (WGS84)")
    p.add_argument("--vars", default="temperature,air-quality",
                   help="comma-separated subset of: temperature,air-quality")
    p.add_argument("--out-dir", default="public/data", help="where the GeoJSON layers go")
    p.add_argument("--prefix", default="gottingen", help="output file prefix")
    p.add_argument("--timeout", type=int, default=60, help="HTTP timeout in seconds")
    return p.parse_args()


def parse_bbox(text):
    try:
        min_lon, min_lat, max_lon, max_lat = (float(v) for v in text.split(","))
    except ValueError:
        raise SystemExit("error: --bbox must be minLon,minLat,maxLon,maxLat")
    if min_lon >= max_lon or min_lat >= max_lat:
        raise SystemExit("error: --bbox must satisfy minLon < maxLon and minLat < maxLat")
    return min_lon, min_lat, max_lon, max_lat


def fetch_records(bbox, timeout):
    min_lon, min_lat, max_lon, max_lat = bbox
    box = ",".join(f"{v:.4f}" for v in (min_lat, min_lon, max_lat, max_lon))
    url = ENDPOINT.format(box=urllib.parse.quote(box, safe=","))
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        records = json.loads(response.read().decode("utf-8"))
    print(f"  fetched:   {len(records)} active sensors in box {box}")
    return records


def values_of(record):
    values = {}
    for item in record.get("sensordatavalues", []):
        value_type = item.get("value_type")
        if value_type is not None and value_type not in values:
            values[value_type] = item.get("value")
    return values


def collect(records, value_type, sensors, bbox):
    min_lon, min_lat, max_lon, max_lat = bbox
    best = {}
    for record in records:
        sensor = record.get("sensor") or {}
        sensor_type = (sensor.get("sensor_type") or {}).get("name")
        if sensor_type not in sensors:
            continue
        values = values_of(record)
        raw = values.get(value_type)
        if raw is None:
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        location = record.get("location") or {}
        try:
            lat = float(location.get("latitude"))
            lon = float(location.get("longitude"))
        except (TypeError, ValueError):
            continue
        if not (min_lat <= lat <= max_lat and min_lon <= lon <= max_lon):
            continue

        rank = sensors.index(sensor_type)
        key = location.get("id") or (round(lat, 5), round(lon, 5))
        previous = best.get(key)
        if previous is not None and previous["_rank"] <= rank:
            continue
        best[key] = {
            "_rank": rank,
            "lat": lat,
            "lon": lon,
            "value": value,
            "sensor": sensor_type,
            "station": location.get("id"),
            "time": record.get("timestamp"),
            "pm10": values.get("P1"),
        }
    return list(best.values())


def write_geojson(path, features, variable, unit):
    collection = {
        "type": "FeatureCollection",
        "name": os.path.basename(path),
        "properties": {"variable": variable, "unit": unit, "source": SOURCE},
        "features": features,
    }
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(collection, handle, ensure_ascii=False)
    print(f"  layer:     {path} ({len(features)} stations)")


def temperature_features(records, bbox):
    features = []
    for station in collect(records, "temperature", TEMP_SENSORS, bbox):
        features.append({
            "type": "Feature",
            "properties": {
                "variable": "Air temperature",
                "value": round(station["value"], 2),
                "unit": "°C",
                "time": station["time"],
                "sensor": station["sensor"],
                "station": station["station"],
                "source": SOURCE,
            },
            "geometry": {"type": "Point", "coordinates": [round(station["lon"], 5), round(station["lat"], 5)]},
        })
    return features


def air_quality_features(records, bbox):
    features = []
    for station in collect(records, "P2", PM_SENSORS, bbox):
        properties = {
            "variable": "PM2.5",
            "value": round(station["value"], 2),
            "unit": "µg/m³",
            "time": station["time"],
            "sensor": station["sensor"],
            "station": station["station"],
        }
        try:
            properties["pm10"] = round(float(station["pm10"]), 2)
        except (TypeError, ValueError):
            pass
        properties["source"] = SOURCE
        features.append({
            "type": "Feature",
            "properties": properties,
            "geometry": {"type": "Point", "coordinates": [round(station["lon"], 5), round(station["lat"], 5)]},
        })
    return features


def main():
    args = parse_args()
    bbox = parse_bbox(args.bbox)
    wanted = {v.strip() for v in args.vars.split(",") if v.strip()}
    records = fetch_records(bbox, args.timeout)

    if "temperature" in wanted:
        path = os.path.join(args.out_dir, f"{args.prefix}-temperature.geojson")
        write_geojson(path, temperature_features(records, bbox), "Air temperature", "°C")
    if "air-quality" in wanted:
        path = os.path.join(args.out_dir, f"{args.prefix}-air-quality.geojson")
        write_geojson(path, air_quality_features(records, bbox), "PM2.5", "µg/m³")

    print("done")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
