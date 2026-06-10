"""Shared helpers for the Plymouth Votes data pipeline."""

import json
import time
from pathlib import Path
from urllib.parse import quote

import requests
from shapely.geometry import mapping

PIPELINE_DIR = Path(__file__).resolve().parent
DATA_DIR = PIPELINE_DIR.parent / "web" / "data"
CACHE_DIR = PIPELINE_DIR / ".cache"

USER_AGENT = "PlymouthVotes/1.0 (civic data project)"


def fetch(url, *, binary=False, retries=4, timeout=120):
    """GET a URL with retries, caching the response on disk."""
    CACHE_DIR.mkdir(exist_ok=True)
    cache_key = "".join(c if c.isalnum() else "_" for c in url)[-150:]
    cache_path = CACHE_DIR / cache_key
    if cache_path.exists():
        data = cache_path.read_bytes()
        return data if binary else data.decode("utf-8", errors="replace")

    delay = 2
    for attempt in range(retries + 1):
        try:
            resp = requests.get(url, timeout=timeout, headers={"User-Agent": USER_AGENT})
            resp.raise_for_status()
            cache_path.write_bytes(resp.content)
            return resp.content if binary else resp.text
        except requests.RequestException:
            if attempt == retries:
                raise
            time.sleep(delay)
            delay *= 2


def arcgis_geojson(base_url, layer, where, out_fields="*"):
    """Query an ArcGIS REST layer for GeoJSON features, with pagination."""
    features = []
    offset = 0
    while True:
        url = (f"{base_url}/{layer}/query?where={quote(where)}"
               f"&outFields={out_fields}&f=geojson&outSR=4326"
               f"&resultOffset={offset}")
        resp = json.loads(fetch(url))
        if "features" not in resp:
            raise RuntimeError(f"Unexpected ArcGIS response from {base_url}/{layer}: "
                               f"{str(resp)[:300]}")
        features.extend(resp["features"])
        if not resp.get("exceededTransferLimit"):
            return features
        offset = len(features)


def round_coords(obj, ndigits=6):
    if isinstance(obj, (list, tuple)):
        return [round_coords(v, ndigits) for v in obj]
    if isinstance(obj, float):
        return round(obj, ndigits)
    return obj


def feature(geom, props, simplify=None):
    """Build a GeoJSON feature from a shapely geometry."""
    if simplify:
        geom = geom.simplify(simplify, preserve_topology=True)
    gj = mapping(geom)
    gj["coordinates"] = round_coords(gj["coordinates"])
    return {"type": "Feature", "geometry": gj, "properties": props}


def write_geojson(name, features):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / name
    fc = {"type": "FeatureCollection", "features": features}
    path.write_text(json.dumps(fc, separators=(",", ":")))
    print(f"  wrote {path.relative_to(PIPELINE_DIR.parent)} "
          f"({len(features)} features, {path.stat().st_size // 1024} KB)")


def write_json(name, obj):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / name
    path.write_text(json.dumps(obj, separators=(",", ":")))
    print(f"  wrote {path.relative_to(PIPELINE_DIR.parent)} "
          f"({path.stat().st_size // 1024} KB)")


def load_geojson(name):
    return json.loads((DATA_DIR / name).read_text())
