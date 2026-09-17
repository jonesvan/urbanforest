#!/usr/bin/env python
"""Build a canopy height model (CHM) from two LGLN surface/terrain models.

Defaults to LiDAR: CHM = DOM1 - DGM1 (1 m, leaf-independent).
Can also be pointed at bDOM20 (20 cm image-based surface model) via
--upper-stac/--upper-collection, but bDOM20 misses bare deciduous trees in the
leaf-off flights.

Both products are public COGs on LGLN STAC APIs and share the same 1 km tile grid.

Usage:
    .venv/bin/python scripts/build-chm.py --bbox=51.520,9.915,51.545,9.955 \
        --out-dir data-src/chm-dom1
"""

import argparse
import json
import os
import urllib.request

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--bbox", required=True, help="minLat,minLon,maxLat,maxLon (WGS84)")
    p.add_argument("--out-dir", default="data-src/chm")
    p.add_argument("--keys-file", default=None,
                   help="JSON file with a list of '<zone>_<easting>_<northing>' tile keys; "
                        "only these tiles are built")
    p.add_argument("--force", action="store_true", help="rebuild tiles that already exist")
    p.add_argument("--upper-stac", default="https://dom.stac.lgln.niedersachsen.de")
    p.add_argument("--upper-collection", default="dom1")
    p.add_argument("--lower-stac", default="https://dgm.stac.lgln.niedersachsen.de")
    p.add_argument("--lower-collection", default="dgm1")
    p.add_argument("--max-height", type=float, default=60.0, help="clip CHM to this height (m)")
    return p.parse_args()


def stac_items(base, collection, bbox):
    min_lat, min_lon, max_lat, max_lon = bbox
    url = (f"{base}/collections/{collection}/items"
           f"?bbox={min_lon},{min_lat},{max_lon},{max_lat}&limit=1000")
    items = []
    while url:
        with urllib.request.urlopen(url, timeout=120) as response:
            payload = json.load(response)
        items.extend(payload.get("features", []))
        url = next((l["href"] for l in payload.get("links", []) if l.get("rel") == "next"), None)
    return items


def latest_per_tile(items):
    """items keyed by '<zone>_<easting>_<northing>' keeping the newest datetime."""
    selected = {}
    for item in items:
        key = "_".join(item["id"].split("_")[1:4])  # 32_565_5709
        datetime = str(item.get("properties", {}).get("datetime", ""))
        if key not in selected or datetime > selected[key][1]:
            selected[key] = (item, datetime)
    return selected


def tif_href(item):
    return next(v["href"] for v in item["assets"].values() if v["href"].endswith(".tif"))


def main():
    args = parse_args()
    bbox = [float(v) for v in args.bbox.split(",")]

    upper = latest_per_tile(stac_items(args.upper_stac, args.upper_collection, bbox))
    lower = latest_per_tile(stac_items(args.lower_stac, args.lower_collection, bbox))

    keys_filter = None
    if args.keys_file:
        with open(args.keys_file) as handle:
            keys_filter = set(json.load(handle))

    tiles = sorted(set(upper) & set(lower))
    if keys_filter is not None:
        tiles = [key for key in tiles if key in keys_filter]
    if not tiles:
        raise SystemExit("error: no overlapping surface/terrain tiles for the bbox")

    os.makedirs(args.out_dir, exist_ok=True)
    print(f"tiles: {len(tiles)} -> {args.out_dir}")

    for key in tiles:
        target = os.path.join(args.out_dir, f"chm_{key}.tif")
        if not args.force and os.path.exists(target):
            print(f"  {key}: exists, skipping")
            continue

        upper_item, upper_date = upper[key]
        lower_item, lower_date = lower[key]

        with rasterio.open("/vsicurl/" + tif_href(upper_item)) as u:
            upper_arr = u.read(1).astype("float32")
            transform, crs, shape = u.transform, u.crs, u.shape
            upper_nodata = u.nodata

        with rasterio.open("/vsicurl/" + tif_href(lower_item)) as l:
            lower_arr = l.read(1).astype("float32")
            lower_crs = l.crs
            if lower_arr.shape != shape or l.transform != transform:
                resampled = np.zeros(shape, dtype="float32")
                reproject(lower_arr, resampled, src_transform=l.transform, src_crs=lower_crs,
                          dst_transform=transform, dst_crs=crs, resampling=Resampling.bilinear)
                lower_arr = resampled
            lower_nodata = l.nodata

        chm = upper_arr - lower_arr
        if upper_nodata is not None:
            chm[upper_arr == upper_nodata] = 0.0
        if lower_nodata is not None:
            chm[lower_arr == lower_nodata] = 0.0
        chm[~np.isfinite(chm)] = 0.0
        chm = np.clip(chm, 0.0, args.max_height)

        with rasterio.open(
            target, "w", driver="GTiff", height=shape[0], width=shape[1], count=1,
            dtype="float32", crs=crs, transform=transform, nodata=0.0, compress="deflate",
        ) as dst:
            dst.write(chm, 1)

        print(f"  {key}: {args.upper_collection} {upper_date[:10]} - {args.lower_collection} "
              f"{lower_date[:10]} -> {os.path.basename(target)} ({shape[1]}x{shape[0]}, "
              f"mean {chm.mean():.1f} m, max {chm.max():.1f} m)")


if __name__ == "__main__":
    main()
