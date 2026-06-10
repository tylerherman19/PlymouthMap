"""Fetch and process all geographic boundaries for the app.

Outputs (web/data/):
  city.geojson      Plymouth city boundary (Hennepin County GIS)
  precincts.geojson Plymouth voting precincts with ward/district attributes
  wards.geojson     Plymouth's 4 wards (dissolved from precincts)
  house.geojson     MN House districts containing Plymouth (Census TIGERweb)
  senate.geojson    MN Senate districts containing Plymouth (Census TIGERweb)
  congress.geojson  U.S. Congressional district MN-03 (Census TIGERweb)
"""

from shapely.geometry import shape
from shapely.ops import unary_union

from common import arcgis_geojson, feature, write_geojson

HENNEPIN_BOUNDARIES = (
    "https://gis.hennepin.us/arcgis/rest/services/HennepinData/BOUNDARIES/MapServer"
)
# Census TIGERweb: layer 0 = Congressional Districts, 1 = state senate
# (upper), 2 = state house (lower). These carry Minnesota's post-2022
# redistricting boundaries.
TIGERWEB_LEG = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer"
)

PRECINCT_SIMPLIFY = 0.00005   # ~5 m: keeps precinct edges crisp
DISTRICT_SIMPLIFY = 0.0002    # districts are large; simplify more


def tigerweb_districts(layer, ids, kind):
    quoted = ",".join(f"'{i}'" for i in sorted(ids))
    feats = arcgis_geojson(TIGERWEB_LEG, layer,
                           f"STATE='27' AND BASENAME IN ({quoted})")
    out = [
        feature(shape(f["geometry"]),
                {"id": f["properties"]["BASENAME"],
                 "name": f"{kind} {f['properties']['BASENAME']}"},
                simplify=DISTRICT_SIMPLIFY)
        for f in feats
    ]
    return sorted(out, key=lambda f: f["properties"]["id"])


def main():
    print("Geography: Plymouth city boundary (Hennepin County GIS)")
    munis = arcgis_geojson(HENNEPIN_BOUNDARIES, 4, "NAME_TXT='PLYMOUTH'")
    city_geom = unary_union([shape(f["geometry"]) for f in munis])
    write_geojson("city.geojson", [
        feature(city_geom, {"id": "plymouth", "name": "City of Plymouth"},
                simplify=PRECINCT_SIMPLIFY)
    ])

    print("Geography: Plymouth precincts (Hennepin County GIS)")
    raw = arcgis_geojson(HENNEPIN_BOUNDARIES, 10, "MUNIC_NAME='Plymouth'")
    precincts = []
    by_ward = {}
    house_ids, senate_ids, cong_ids = set(), set(), set()
    for f in raw:
        p = f["properties"]
        geom = shape(f["geometry"])
        ward = str(p["WARD"]).strip()
        house = str(p["HOUSE_DIST"]).strip()
        senate = str(p["SEN_DIST"]).strip()
        cong = str(p["CONG_DIST"]).strip()
        house_ids.add(house)
        senate_ids.add(senate)
        cong_ids.add(cong)
        by_ward.setdefault(ward, []).append(geom)
        precincts.append(feature(geom, {
            "id": str(p["PRECINCT"]).strip(),
            "name": p["NAME_TXT"].strip(),
            "ward": ward,
            "house": house,
            "senate": senate,
            "congress": cong,
        }, simplify=PRECINCT_SIMPLIFY))
    precincts.sort(key=lambda f: f["properties"]["id"])
    write_geojson("precincts.geojson", precincts)

    print("Geography: wards (dissolved from precincts)")
    wards = [
        feature(unary_union(geoms), {"id": w, "name": f"Ward {w}"},
                simplify=PRECINCT_SIMPLIFY)
        for w, geoms in sorted(by_ward.items())
    ]
    write_geojson("wards.geojson", wards)

    print(f"Geography: MN House districts {sorted(house_ids)} (Census TIGERweb)")
    write_geojson("house.geojson",
                  tigerweb_districts(2, house_ids, "MN House District"))

    print(f"Geography: MN Senate districts {sorted(senate_ids)} (Census TIGERweb)")
    write_geojson("senate.geojson",
                  tigerweb_districts(1, senate_ids, "MN Senate District"))

    print(f"Geography: U.S. Congressional districts {sorted(cong_ids)} (Census TIGERweb)")
    write_geojson("congress.geojson",
                  tigerweb_districts(0, cong_ids, "Congressional District"))


if __name__ == "__main__":
    main()
