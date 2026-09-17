#!/usr/bin/env python
"""Detect individual tree crowns in DOP20 orthophoto tiles with DeepForest.

Usage:
    .venv/bin/python scripts/detect-trees.py \
        --input-dir data-src/dop20 \
        --output public/data/gottingen-crowns.geojson \
        [--score-threshold 0.3] [--patch-size 400] [--patch-overlap 0.1]

Uses the pretrained DeepForest tree-crown model on 20 cm RGB tiles and
georeferences the detections (EPSG:25832 -> EPSG:4326).
"""

import argparse
import glob
import os

import geopandas as gpd
import rasterio
from shapely.geometry import box
from deepforest import main


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--score-threshold", type=float, default=0.3)
    parser.add_argument("--patch-size", type=int, default=400)
    parser.add_argument("--patch-overlap", type=float, default=0.1)
    parser.add_argument("--iou-threshold", type=float, default=0.15)
    parser.add_argument("--model", default=None,
                        help="Hugging Face model id; default is the pretrained tree-crown model")
    return parser.parse_args()


def main_():
    args = parse_args()

    model = main.deepforest()
    model.load_model(model_name=args.model) if args.model else model.load_model()
    model.eval()

    tiles = sorted(glob.glob(os.path.join(args.input_dir, "*.tif")))
    if not tiles:
        raise SystemExit(f"error: no .tif tiles in {args.input_dir}")

    print(f"tiles: {len(tiles)}")
    records = []

    for tile in tiles:
        with rasterio.open(tile) as src:
            transform = src.transform
            crs = src.crs
            width, height = src.width, src.height

        predictions = model.predict_tile(
            path=tile,
            patch_size=args.patch_size,
            patch_overlap=args.patch_overlap,
            iou_threshold=args.iou_threshold,
        )

        if predictions is None or len(predictions) == 0:
            print(f"  {os.path.basename(tile)}: 0")
            continue

        kept = predictions[predictions["score"] >= args.score_threshold]
        print(f"  {os.path.basename(tile)}: {len(predictions)} raw, {len(kept)} kept")

        for _, row in kept.iterrows():
            # pixel (x right, y down) -> world coordinates
            west, north = transform * (row["xmin"], row["ymin"])
            east, south = transform * (row["xmax"], row["ymax"])
            geom = box(min(west, east), min(north, south), max(west, east), max(north, south))
            records.append({
                "geometry": geom,
                "score": float(row["score"]),
                "tile": os.path.basename(tile),
                "crs": str(crs),
            })

    print(f"detections: {len(records)}")

    crs = records[0]["crs"] if records else "EPSG:25832"
    gdf = gpd.GeoDataFrame(records, geometry="geometry", crs=crs)
    gdf["area_m2"] = gdf.geometry.area.round(1)
    gdf = gdf.to_crs("EPSG:4326")

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    gdf.drop(columns=["crs"]).to_file(args.output, driver="GeoJSON")
    print(f"output: {args.output}")


if __name__ == "__main__":
    main_()
