#!/usr/bin/env python
"""Fetch Copernicus CO2 and temperature fields for the map (ERA5 + CAMS).

Two backends:

* ``--source open-meteo`` (default, key-free): reads Copernicus CAMS surface CO2
  (Open-Meteo Air Quality API) and ERA5 2 m temperature (Open-Meteo Historical
  Weather API). No credentials, standard library only.
* ``--source cds``: reads the same Copernicus products straight from the Climate
  Data Store (ERA5) and Atmosphere Data Store (CAMS) with ``cdsapi``.

Either way the script samples a regular grid inside a bounding box and writes one
GeoJSON point per model cell, feeding the ``gottingen-temperature`` and
``gottingen-co2`` map layers (off by default).

Usage:
    python3 scripts/fetch-climate.py \\
        --bbox=9.0,51.0,11.0,52.0 --date=2025-07-01 --time=12:00

    # direct Copernicus route (needs credentials + cdsapi/xarray/netcdf4):
    CDSAPI_KEY=... ADSAPI_KEY=... .venv/bin/python scripts/fetch-climate.py \\
        --source=cds --bbox=9.0,51.0,11.0,52.0 --date=2025-07-01
"""

import argparse
import datetime as dt
import json
import math
import os
import sys
import urllib.parse
import urllib.request

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
CDS_URL = os.environ.get("CDSAPI_URL", "https://cds.climate.copernicus.eu/api")
ADS_URL = os.environ.get("ADSAPI_URL", "https://ads.atmosphere.copernicus.eu/api")

ERA5_DATASET = "reanalysis-era5-single-levels"
CAMS_DATASET = "cams-global-greenhouse-gas-forecasts"

TEMP_NAMES = ("t2m", "2t", "temperature_2m", "2m_temperature", "air_temperature")
CO2_NAMES = ("co2", "carbon_dioxide", "co2_surface", "xco2", "carbon_dioxide_surface")

# Native grid spacing of the source products (degrees).
TEMP_STEP = 0.25   # ERA5 (~25 km)
CO2_STEP = 0.10    # CAMS greenhouse gases (~11 km)


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--bbox", required=True, help="minLon,minLat,maxLon,maxLat (WGS84)")
    p.add_argument("--date", default=(dt.date.today() - dt.timedelta(days=7)).isoformat(),
                   help="ISO date, e.g. 2025-07-01 (default: 7 days ago)")
    p.add_argument("--time", default="12:00", help="UTC hour, e.g. 12:00")
    p.add_argument("--source", choices=("open-meteo", "cds"), default="open-meteo")
    p.add_argument("--step", type=float, default=None,
                   help="grid spacing in degrees (default: native 0.25 temperature / 0.10 co2)")
    p.add_argument("--out-dir", default="public/data")
    p.add_argument("--data-dir", default="data-src/climate", help="where CDS .nc downloads go")
    p.add_argument("--prefix", default="gottingen", help="output file prefix")
    p.add_argument("--vars", default="temperature,co2",
                   help="comma-separated subset of: temperature,co2")
    return p.parse_args()


def parse_bbox(text):
    try:
        min_lon, min_lat, max_lon, max_lat = (float(v) for v in text.split(","))
    except ValueError:
        raise SystemExit("error: --bbox must be minLon,minLat,maxLon,maxLat")
    if min_lon >= max_lon or min_lat >= max_lat:
        raise SystemExit("error: --bbox must satisfy minLon < maxLon and minLat < maxLat")
    return min_lon, min_lat, max_lon, max_lat


def area_param(bbox):
    min_lon, min_lat, max_lon, max_lat = bbox
    return [max_lat, min_lon, min_lat, max_lon]  # CDS/ADS order: [N, W, S, E]


def grid_coords(bbox, step):
    min_lon, min_lat, max_lon, max_lat = bbox
    lats = []
    value = min_lat
    while value <= max_lat + 1e-9:
        lats.append(round(value, 4))
        value += step
    lons = []
    value = min_lon
    while value <= max_lon + 1e-9:
        lons.append(round(value, 4))
        value += step
    return [(lat, lon) for lat in lats for lon in lons]


def chunks(seq, size):
    for start in range(0, len(seq), size):
        yield seq[start:start + size]


def http_get_json(url, timeout=60):
    request = urllib.request.Request(url, headers={"User-Agent": "urbanforest-climate/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def pick_hour(times, hour):
    suffix = "T" + hour
    for index, stamp in enumerate(times):
        if stamp.endswith(suffix):
            return index
    return None


def openmeteo_points(endpoint, coords, date, variable, hour):
    points = []
    unit = None
    for chunk in chunks(coords, 80):
        params = {
            "latitude": ",".join(f"{lat:.4f}" for lat, _ in chunk),
            "longitude": ",".join(f"{lon:.4f}" for _, lon in chunk),
            "start_date": date,
            "end_date": date,
            "hourly": variable,
            "timezone": "UTC",
        }
        data = http_get_json(endpoint + "?" + urllib.parse.urlencode(params))
        results = data if isinstance(data, list) else [data]
        for result in results:
            hourly = result.get("hourly") or {}
            values = hourly.get(variable)
            if not values:
                continue
            index = pick_hour(hourly.get("time", []), hour)
            if index is None or index >= len(values):
                continue
            unit = (result.get("hourly_units") or {}).get(variable) or unit
            points.append((float(result["latitude"]), float(result["longitude"]), values[index]))
    return points, unit


def emit_points(points, bbox, convert, variable, unit, time_str):
    min_lon, min_lat, max_lon, max_lat = bbox
    features = []
    for lat, lon, raw in points:
        if raw is None:
            continue
        try:
            value = float(raw)
        except (TypeError, ValueError):
            continue
        if not math.isfinite(value):
            continue
        if not (min_lat <= lat <= max_lat and min_lon <= lon <= max_lon):
            continue
        features.append({
            "type": "Feature",
            "properties": {
                "variable": variable,
                "value": round(float(convert(value)), 3),
                "unit": unit,
                "time": time_str,
            },
            "geometry": {"type": "Point", "coordinates": [round(lon, 4), round(lat, 4)]},
        })
    return features


def write_geojson(path, features, variable, unit, source):
    collection = {
        "type": "FeatureCollection",
        "name": os.path.basename(path),
        "properties": {"variable": variable, "unit": unit, "source": source},
        "features": features,
    }
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(collection, handle, ensure_ascii=False)
    print(f"output: {path} ({len(features)} cells)")


# --- direct Copernicus (CDS/ADS) backend -----------------------------------

def make_client(url, key_env, label):
    try:
        import cdsapi
    except ImportError:
        raise SystemExit("error: cdsapi is not installed — run "
                         "`uv pip install --python .venv cdsapi xarray netcdf4`")
    key = os.environ.get(key_env)
    if not key and not os.path.exists(os.path.expanduser("~/.cdsapirc")):
        raise SystemExit(f"error: set {key_env} (free account at {url}) or create ~/.cdsapirc")
    try:
        return cdsapi.Client(url=url, key=key, quiet=True) if key else cdsapi.Client(url=url, quiet=True)
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(f"error: could not create {label} client: {exc}")


def era5_request(args):
    year, month, day = args.date.split("-")
    return {
        "product_type": ["reanalysis"],
        "variable": ["2m_temperature"],
        "year": [year],
        "month": [month],
        "day": [day],
        "time": [args.time],
        "area": area_param(parse_bbox(args.bbox)),
        "data_format": "netcdf",
        "download_format": "unarchived",
    }


def cams_request(args):
    return {
        "variable": ["carbon_dioxide"],
        "date": [args.date],
        "time": [args.time],
        "leadtime_hour": ["0"],
        "area": area_param(parse_bbox(args.bbox)),
        "data_format": "netcdf",
    }


def surface_points(path, names, label):
    import numpy as np
    import xarray as xr

    with xr.open_dataset(path) as ds:
        field = None
        for name in names:
            if name in ds.data_vars:
                field = ds[name]
                break
        if field is None:
            candidates = [name for name, cand in ds.data_vars.items() if cand.ndim >= 2]
            if not candidates:
                raise SystemExit(f"error: no 2-D variable found for {label}: {list(ds.data_vars)}")
            field = ds[candidates[0]]

        rename = {}
        for dim in field.dims:
            low = dim.lower()
            if low in ("latitude", "lat", "y"):
                rename[dim] = "lat"
            elif low in ("longitude", "lon", "x"):
                rename[dim] = "lon"
        field = field.rename(rename)
        extra = [d for d in field.dims if d not in ("lat", "lon")]
        if extra:
            field = field.isel({d: 0 for d in extra}, drop=True)
        field = field.squeeze()

        units = field.attrs.get("units", "")
        lat = np.asarray(field["lat"].values, dtype="float64")
        lon = np.asarray(field["lon"].values, dtype="float64")
        lon = np.where(lon > 180.0, lon - 360.0, lon)
        values = np.asarray(field.values, dtype="float64")

    points = [(float(lat[i]), float(lon[j]), float(values[i, j]))
              for i in range(lat.size) for j in range(lon.size)]
    return points, units


def temperature_converter(units):
    low = (units or "").lower()
    if "c" in low and "k" not in low and "kelvin" not in low:
        return (lambda v: v), "°C"
    return (lambda v: v - 273.15), "°C"


def co2_converter(units):
    low = (units or "").lower()
    if "ppm" in low:
        return (lambda v: v), "ppm"
    if "mol/mol" in low or "mol mol" in low:
        return (lambda v: v * 1e6), "ppm"
    if "kg kg" in low or "kg/kg" in low:
        return (lambda v: v * (28.9644 / 44.0095) * 1e6), "ppm"
    return (lambda v: v), "ppm"


# --- orchestration ----------------------------------------------------------

def fetch_temperature(args, bbox):
    if args.source == "open-meteo":
        step = args.step or TEMP_STEP
        coords = grid_coords(bbox, step)
        points, unit = openmeteo_points(ARCHIVE_URL, coords, args.date, "temperature_2m", args.time)
        source = "ERA5 (Copernicus C3S) via Open-Meteo"
        variable, unit = "Air temperature (2 m)", unit or "°C"
        return points, (lambda v: v), variable, unit, source

    client = make_client(CDS_URL, "CDSAPI_KEY", "CDS")
    target = os.path.join(args.data_dir, f"{args.prefix}-temperature.nc")
    os.makedirs(args.data_dir, exist_ok=True)
    print(f"retrieving {ERA5_DATASET} -> {target}")
    client.retrieve(ERA5_DATASET, era5_request(args), target)
    points, units = surface_points(target, TEMP_NAMES, "2 m temperature")
    convert, unit = temperature_converter(units)
    return points, convert, "Air temperature (2 m)", unit, "ERA5 (Copernicus C3S)"


def fetch_co2(args, bbox):
    if args.source == "open-meteo":
        step = args.step or CO2_STEP
        coords = grid_coords(bbox, step)
        points, unit = openmeteo_points(AIR_QUALITY_URL, coords, args.date, "carbon_dioxide", args.time)
        source = "CAMS (Copernicus) via Open-Meteo"
        return points, (lambda v: v), "Carbon dioxide (surface)", unit or "ppm", source

    client = make_client(ADS_URL, "ADSAPI_KEY", "ADS")
    target = os.path.join(args.data_dir, f"{args.prefix}-co2.nc")
    os.makedirs(args.data_dir, exist_ok=True)
    print(f"retrieving {CAMS_DATASET} -> {target}")
    client.retrieve(CAMS_DATASET, cams_request(args), target)
    points, units = surface_points(target, CO2_NAMES, "surface CO2")
    convert, unit = co2_converter(units)
    return points, convert, "Carbon dioxide (surface)", unit, "CAMS (Copernicus)"


def main():
    args = parse_args()
    bbox = parse_bbox(args.bbox)
    wanted = {v.strip() for v in args.vars.split(",") if v.strip()}
    outputs = []

    if "temperature" in wanted:
        points, convert, variable, unit, source = fetch_temperature(args, bbox)
        features = emit_points(points, bbox, convert, variable, unit, args.time)
        out = os.path.join(args.out_dir, f"{args.prefix}-temperature.geojson")
        write_geojson(out, features, variable, unit, source)
        outputs.append(out)

    if "co2" in wanted:
        points, convert, variable, unit, source = fetch_co2(args, bbox)
        features = emit_points(points, bbox, convert, variable, unit, args.time)
        out = os.path.join(args.out_dir, f"{args.prefix}-co2.geojson")
        write_geojson(out, features, variable, unit, source)
        outputs.append(out)

    print("done: " + (", ".join(outputs) if outputs else "nothing (no matching --vars)"))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
