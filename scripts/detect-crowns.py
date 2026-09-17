#!/usr/bin/env python
"""Detect individual tree crowns from a canopy height model (CHM).

Uses local maxima as crown seeds and watershed segmentation. Works with the
LiDAR CHM (DOM1 - DGM1, 1 m, leaf-independent) or any other CHM GeoTIFF.

Usage:
    .venv/bin/python scripts/detect-crowns.py \
        --input-dir data-src/chm-dom1 \
        --output public/data/gottingen-crowns.geojson \
        [--min-height 3] [--min-area 4] [--max-area 400]
"""

import argparse
import glob
import os

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.features import shapes
from scipy.ndimage import gaussian_filter
from shapely import set_precision
from shapely.geometry import shape
from skimage.feature import peak_local_max
from skimage.segmentation import watershed


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--input-dir", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--min-height", type=float, default=3.0, help="minimum crown top height (m)")
    p.add_argument("--min-area", type=float, default=4.0, help="minimum crown area (m²)")
    p.add_argument("--max-area", type=float, default=400.0, help="maximum crown area (m²)")
    p.add_argument("--min-distance", type=int, default=2, help="minimum distance between crown tops (px)")
    p.add_argument("--sigma", type=float, default=0.5, help="gaussian smoothing sigma (px)")
    p.add_argument("--buildings", default=None, help="GeoJSON of building footprints to exclude")
    p.add_argument("--simplify", type=float, default=1.5, help="polygon simplification tolerance (m)")
    p.add_argument("--round", type=float, default=0.0,
                   help="round the crown outline by this radius (m); slow, smooths the 1 m pixel staircase")
    return p.parse_args()


def main():
    args = parse_args()
    tiles = sorted(glob.glob(os.path.join(args.input_dir, "*.tif")))
    if not tiles:
        raise SystemExit(f"error: no CHM .tif in {args.input_dir}")

    records = []
    for tile in tiles:
        with rasterio.open(tile) as src:
            chm = src.read(1).astype("float32")
            transform = src.transform
            crs = src.crs
        chm[~np.isfinite(chm)] = 0.0

        smooth = gaussian_filter(chm, sigma=args.sigma)
        mask = smooth >= args.min_height
        if not mask.any():
            print(f"  {os.path.basename(tile)}: no vegetation above {args.min_height} m")
            continue

        peaks = peak_local_max(
            smooth,
            min_distance=args.min_distance,
            threshold_abs=args.min_height,
            labels=mask,
        )
        markers = np.zeros(smooth.shape, dtype="int32")
        for index, (row, col) in enumerate(peaks, start=1):
            markers[row, col] = index

        labels = watershed(-smooth, markers=markers, mask=mask)

        kept = 0
        for geometry, value in shapes(labels.astype("int32"), mask=mask, transform=transform):
            region = labels == value
            area = float(region.sum())  # 1 px = 1 m² for the 1 m CHM
            if area < args.min_area or area > args.max_area:
                continue
            heights = chm[region]
            polygon = shape(geometry)
            records.append({
                "geometry": polygon,
                "area_m2": round(area, 1),
                "height_max": round(float(heights.max()), 2),
                "height_mean": round(float(heights.mean()), 2),
                "tile": os.path.basename(tile),
            })
            kept += 1
        print(f"  {os.path.basename(tile)}: {len(peaks)} seeds -> {kept} crowns kept")

    print(f"crowns: {len(records)}")
    if not records:
        raise SystemExit("error: no crowns detected")

    gdf = gpd.GeoDataFrame(records, geometry="geometry", crs=crs)

    if args.buildings:
        buildings = gpd.read_file(args.buildings).to_crs(crs)
        centroids = gpd.GeoDataFrame(geometry=gdf.geometry.centroid, index=gdf.index, crs=crs)
        joined = gpd.sjoin(centroids, buildings[["geometry"]], predicate="within", how="inner")
        before = len(gdf)
        gdf = gdf.drop(index=joined.index.unique())
        print(f"buildings filter: {before} -> {len(gdf)} crowns")

    if args.simplify:
        gdf.geometry = gdf.geometry.simplify(args.simplify, preserve_topology=True)

    if args.round:
        # round-trip buffer rounds off the staircase edges from the 1 m raster
        gdf.geometry = (
            gdf.geometry.buffer(args.round, join_style="round", resolution=8)
            .buffer(-args.round, join_style="round", resolution=8)
        )

    gdf = gdf[~gdf.geometry.is_empty]

    gdf = gdf.to_crs("EPSG:4326")
    gdf.geometry = set_precision(gdf.geometry, 1e-6)  # ~0.1 m, shrinks the file
    gdf = gdf[["area_m2", "height_max", "geometry"]]

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    gdf.to_file(args.output, driver="GeoJSON")
    print(f"output: {args.output} ({os.path.getsize(args.output) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
