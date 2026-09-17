#!/usr/bin/env python
"""Fetch Copernicus CO2 and temperature fields for the map (ERA5 + CAMS).

Retrieves gridded data from the Copernicus Climate Data Store (CDS, ERA5
2 m temperature) and the Copernicus Atmosphere Data Store (ADS, CAMS global
greenhouse-gas forecast surface CO2) with the ``cdsapi`` client, and writes one
GeoJSON point per model grid cell inside a bounding box. The output feeds the
``gottingen-temperature`` and ``gottingen-co2`` map layers (off by default).

Setup (one-time):
    uv venv --python 3.11 .venv
    uv pip install --python .venv cdsapi xarray netcdf4

Credentials (free accounts):
    CDS  https://cds.climate.copernicus.eu  -> CDSAPI_KEY
    ADS  https://ads.atmosphere.copernicus.eu -> ADSAPI_KEY
    (or put them in ~/.cdsapirc; see `cdsapi` docs)

Usage:
    CDSAPI_KEY=... ADSAPI_KEY=... \\
    .venv/bin/python scripts/fetch-climate.py \\
        --bbox=9.83,51.47,10.05,51.60 --date=2025-07-01 --time=12:00 \\
        --out-dir public/data --prefix gottingen
"""

import argparse
import datetime as dt
import json
import os
import sys

import numpy as np
import xarray as xr

CDS_URL = os.environ.get("CDSAPI_URL", "https://cds.climate.copernicus.eu/api")
ADS_URL = os.environ.get("ADSAPI_URL", "https://ads.atmosphere.copernicus.eu/api")

ERA5_DATASET = "reanalysis-era5-single-levels"
CAMS_DATASET = "cams-global-greenhouse-gas-forecasts"

TEMP_NAMES = ("t2m", "2t", "temperature_2m", "2m_temperature", "air_temperature")
CO2_NAMES = ("co2", "carbon_dioxide", "co2_surface", "xco2", "carbon_dioxide_surface")


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--bbox", required=True,
                   help="minLon,minLat,maxLon,maxLat (WGS84)")
    p.add_argument("--date", default=(dt.date.today() - dt.timedelta(days=7)).isoformat(),
                   help="ISO date, e.g. 2025-07-01 (default: 7 days ago, ERA5T lag)")
    p.add_argument("--time", default="12:00", help="UTC hour, e.g. 12:00")
    p.add_argument("--out-dir", default="public/data")
    p.add_argument("--data-dir", default="data-src/climate", help="where the .nc downloads go")
    p.add_argument("--prefix", default="gottingen", help="output file prefix")
    p.add_argument("--vars", default="temperature,co2",
                   help="comma-separated subset of: temperature,co2")
    p.add_argument("--dry-run", action="store_true",
                   help="print the API requests without downloading")
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
    # CDS/ADS use [north, west, south, east]
    return [max_lat, min_lon, min_lat, max_lon]


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
    except Exception as exc:  # noqa: BLE001 - surface a readable message
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


def surface_field(ds, names, label):
    da = None
    for name in names:
        if name in ds.data_vars:
            da = ds[name]
            break
    if da is None:
        candidates = [name for name, cand in ds.data_vars.items() if cand.ndim >= 2]
        if not candidates:
            raise SystemExit(f"error: no 2-D variable found for {label}: {list(ds.data_vars)}")
        da = ds[candidates[0]]

    rename = {}
    for dim in da.dims:
        low = dim.lower()
        if low in ("latitude", "lat", "y"):
            rename[dim] = "lat"
        elif low in ("longitude", "lon", "x"):
            rename[dim] = "lon"
    da = da.rename(rename)

    extra = [d for d in da.dims if d not in ("lat", "lon")]
    if extra:
        da = da.isel({d: 0 for d in extra}, drop=True)
    return da.squeeze()


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


def to_features(da, bbox, convert, variable, unit, time_str):
    lat = np.asarray(da["lat"].values, dtype="float64")
    lon = np.asarray(da["lon"].values, dtype="float64")
    lon = np.where(lon > 180.0, lon - 360.0, lon)
    values = np.asarray(da.values, dtype="float64")

    min_lon, min_lat, max_lon, max_lat = bbox
    features = []
    for i in range(lat.size):
        for j in range(lon.size):
            la, lo = float(lat[i]), float(lon[j])
            if not (min_lat <= la <= max_lat and min_lon <= lo <= max_lon):
                continue
            raw = values[i, j]
            if not np.isfinite(raw):
                continue
            features.append({
                "type": "Feature",
                "properties": {
                    "variable": variable,
                    "value": round(float(convert(raw)), 3),
                    "unit": unit,
                    "time": time_str,
                },
                "geometry": {"type": "Point", "coordinates": [round(lo, 5), round(la, 5)]},
            })
    return features


def write_geojson(path, features, variable, unit, source):
    collection = {
        "type": "FeatureCollection",
        "name": path.rsplit("/", 1)[-1],
        "properties": {"variable": variable, "unit": unit, "source": source},
        "features": features,
    }
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(collection, handle, ensure_ascii=False)
    print(f"output: {path} ({len(features)} cells)")


def run_retrieval(client, dataset, request, target, dry_run):
    print(f"retrieving {dataset} -> {target}")
    print(json.dumps(request, indent=2))
    if dry_run:
        return
    client.retrieve(dataset, request, target)


def main():
    args = parse_args()
    bbox = parse_bbox(args.bbox)
    wanted = {v.strip() for v in args.vars.split(",") if v.strip()}

    os.makedirs(args.data_dir, exist_ok=True)
    results = []

    if "temperature" in wanted:
        target = os.path.join(args.data_dir, f"{args.prefix}-temperature.nc")
        client = None if args.dry_run else make_client(CDS_URL, "CDSAPI_KEY", "CDS")
        if client:
            run_retrieval(client, ERA5_DATASET, era5_request(args), target, args.dry_run)
        else:
            run_retrieval(None, ERA5_DATASET, era5_request(args), target, True)
        if not args.dry_run:
            with xr.open_dataset(target) as ds:
                field = surface_field(ds, TEMP_NAMES, "2 m temperature")
                convert, unit = temperature_converter(field.attrs.get("units"))
                features = to_features(field, bbox, convert, "Air temperature (2 m)", unit, args.time)
            out = os.path.join(args.out_dir, f"{args.prefix}-temperature.geojson")
            write_geojson(out, features, "Air temperature (2 m)", unit, "ERA5 (Copernicus C3S)")
            results.append(out)

    if "co2" in wanted:
        target = os.path.join(args.data_dir, f"{args.prefix}-co2.nc")
        client = None if args.dry_run else make_client(ADS_URL, "ADSAPI_KEY", "ADS")
        if client:
            run_retrieval(client, CAMS_DATASET, cams_request(args), target, args.dry_run)
        else:
            run_retrieval(None, CAMS_DATASET, cams_request(args), target, True)
        if not args.dry_run:
            with xr.open_dataset(target) as ds:
                field = surface_field(ds, CO2_NAMES, "surface CO2")
                convert, unit = co2_converter(field.attrs.get("units"))
                features = to_features(field, bbox, convert, "Carbon dioxide (surface)", unit, args.time)
            out = os.path.join(args.out_dir, f"{args.prefix}-co2.geojson")
            write_geojson(out, features, "Carbon dioxide (surface)", unit, "CAMS (Copernicus)")
            results.append(out)

    if args.dry_run:
        print("dry run complete — no data downloaded")
    elif not results:
        print("nothing to do (no matching --vars)")
    else:
        print(f"done: {', '.join(results)}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
