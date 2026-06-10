"""Compute demographics for every map area from Census ACS data.

Approach: fetch ACS 5-year estimates for every census tract in Hennepin
County, then apportion tract values onto each geography (precinct, ward,
district, city) by area overlap. Counts (population, race) are split
proportionally; medians (income, age) are averaged, weighted by each
tract's share of the area's population.

Tract data comes from the official Census API when a CENSUS_API_KEY
environment variable is set (the Census Bureau now requires a free key),
otherwise from Census Reporter's public mirror of the same ACS tables.

Output: web/data/demographics.json
"""

import json
import os

from shapely.geometry import shape
from shapely.prepared import prep

from common import arcgis_geojson, fetch, load_geojson, write_json

CENSUS_API_URL = (
    "https://api.census.gov/data/2023/acs/acs5"
    "?get=B01003_001E,B19013_001E,B02001_002E,B02001_003E,B01002_001E"
    "&for=tract:*&in=state:27%20county:053&key={key}"
)
CENSUS_REPORTER_URL = (
    "https://api.censusreporter.org/1.0/data/show/latest"
    "?table_ids=B01003,B19013,B02001,B01002&geo_ids=140|05000US27053"
)
# Census TIGERweb current-vintage tract boundaries (2020-based tracts,
# the same geography recent ACS releases report on). Layer 0 = Census Tracts.
TIGERWEB_TRACTS = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Tracts_Blocks/MapServer"
)

LAYERS = ["city", "precincts", "wards", "house", "senate", "congress"]
LAYER_KEYS = {"precincts": "precinct", "wards": "ward"}


def acs_value(raw):
    """ACS uses large negative sentinels for missing data."""
    if raw in (None, ""):
        return None
    v = float(raw)
    return None if v < 0 else v


def acs_from_census_api(key):
    rows = json.loads(fetch(CENSUS_API_URL.format(key=key)))
    header = rows[0]
    idx = {name: header.index(name) for name in header}
    acs = {}
    for r in rows[1:]:
        geoid = r[idx["state"]] + r[idx["county"]] + r[idx["tract"]]
        acs[geoid] = {
            "pop": acs_value(r[idx["B01003_001E"]]) or 0.0,
            "income": acs_value(r[idx["B19013_001E"]]),
            "white": acs_value(r[idx["B02001_002E"]]) or 0.0,
            "black": acs_value(r[idx["B02001_003E"]]) or 0.0,
            "age": acs_value(r[idx["B01002_001E"]]),
        }
    return acs, "ACS 2019–2023 5-year"


def acs_from_census_reporter():
    resp = json.loads(fetch(CENSUS_REPORTER_URL))
    acs = {}
    for geoid_full, tables in resp["data"].items():
        geoid = geoid_full.split("US")[1]  # "14000US27053000101" -> tract GEOID
        acs[geoid] = {
            "pop": acs_value(tables["B01003"]["estimate"]["B01003001"]) or 0.0,
            "income": acs_value(tables["B19013"]["estimate"]["B19013001"]),
            "white": acs_value(tables["B02001"]["estimate"]["B02001002"]) or 0.0,
            "black": acs_value(tables["B02001"]["estimate"]["B02001003"]) or 0.0,
            "age": acs_value(tables["B01002"]["estimate"]["B01002001"]),
        }
    release = resp.get("release", {})
    return acs, f"ACS {release.get('years', '5-year')} 5-year"


def fetch_tracts():
    key = os.environ.get("CENSUS_API_KEY")
    if key:
        print("  using official Census API (CENSUS_API_KEY set)")
        acs, release = acs_from_census_api(key)
    else:
        print("  using Census Reporter (set CENSUS_API_KEY for the official API)")
        acs, release = acs_from_census_reporter()

    tracts = []
    feats = arcgis_geojson(TIGERWEB_TRACTS, 0, "STATE='27' AND COUNTY='053'",
                           out_fields="GEOID")
    for f in feats:
        geoid = f["properties"]["GEOID"]
        geom = shape(f["geometry"])
        if geoid in acs and geom.area > 0:
            tracts.append((geom, acs[geoid]))
    print(f"  {len(tracts)} Hennepin County tracts with ACS data ({release})")
    return tracts, release


def apportion(area_geom, tracts):
    """Area-weighted demographic estimate for one geometry."""
    pop = white = black = 0.0
    income_w = income_pop = age_w = age_pop = 0.0
    prepared = prep(area_geom)
    for tract_geom, d in tracts:
        if not prepared.intersects(tract_geom):
            continue
        frac = tract_geom.intersection(area_geom).area / tract_geom.area
        if frac < 1e-4:
            continue
        share = d["pop"] * frac
        pop += share
        white += d["white"] * frac
        black += d["black"] * frac
        if d["income"] is not None and share > 0:
            income_w += d["income"] * share
            income_pop += share
        if d["age"] is not None and share > 0:
            age_w += d["age"] * share
            age_pop += share
    if pop == 0:
        return None
    return {
        "population": round(pop),
        "white": round(white),
        "black": round(black),
        "other": max(0, round(pop) - round(white) - round(black)),
        "medianIncome": round(income_w / income_pop) if income_pop else None,
        "medianAge": round(age_w / age_pop, 1) if age_pop else None,
    }


def main():
    print("Demographics: fetching ACS 5-year tract data")
    tracts, release = fetch_tracts()

    areas = {}
    for layer in LAYERS:
        key = LAYER_KEYS.get(layer, layer)
        areas[key] = {}
        fc = load_geojson(f"{layer}.geojson")
        print(f"Demographics: apportioning onto {layer} "
              f"({len(fc['features'])} areas)")
        for f in fc["features"]:
            est = apportion(shape(f["geometry"]), tracts)
            if est:
                areas[key][f["properties"]["id"]] = est

    write_json("demographics.json", {"release": release, "areas": areas})


if __name__ == "__main__":
    main()
