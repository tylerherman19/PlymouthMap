"""Fetch MN Secretary of State precinct-level results and aggregate them.

For each general election cycle this script:
  1. reads the cycle's precinct table (PrctTbl.txt) to find Plymouth's
     precincts and their official ward / district assignments that year,
  2. reads the statewide results file (allracesbyprecinct.txt) and the
     local-races file (localPrct.txt),
  3. keeps federal, state-legislative, and Plymouth city offices,
  4. aggregates precinct votes to wards, MN House/Senate districts, the
     congressional district, and the city as a whole.

Output: web/data/elections.json
"""

import re
from collections import defaultdict

from common import fetch, write_json

SOS = "https://electionresultsfiles.sos.mn.gov"
HENNEPIN = "27"          # SoS county number
PLYMOUTH_FIPS = "51730"  # minor civil division FIPS for Plymouth

CYCLES = [
    {"id": "2024", "name": "2024 General Election", "dir": "20241105"},
    {"id": "2022", "name": "2022 General Election", "dir": "20221108"},
    {"id": "2020", "name": "2020 General Election", "dir": "20201103"},
]

# (regex on office name, sort order, short label override)
OFFICES = [
    (r"^U\.S\. President", 0, "U.S. President"),
    (r"^U\.S\. Senator", 1, None),
    (r"^U\.S\. Representative District", 2, None),
    (r"^Governor", 3, "Governor & Lt. Governor"),
    (r"^State Senator District", 4, None),
    (r"^State Representative District", 5, None),
    (r"^Mayor \(Plymouth\)", 6, None),
    (r"\(Plymouth\)", 7, None),  # council and any other city office
]

PARTY_NAMES = {
    "R": "Republican", "DFL": "DFL", "LIB": "Libertarian", "GLC": "Grassroots",
    "LMN": "Legal Marijuana Now", "SWP": "Socialist Workers", "IA": "Independence-Alliance",
    "WTP": "We the People", "IND": "Independent", "NP": "Nonpartisan", "WI": "Write-in",
    "CON": "Constitution", "SL": "Socialism & Liberation", "ADP": "American Delta",
    "FMR": "Forward MN Republic", "JFA": "Justice for All",
}


def classify(office_name):
    for pattern, order, label in OFFICES:
        if re.search(pattern, office_name):
            return order, label or office_name
    return None, None


def plymouth_precincts(cycle_dir):
    """precinct code -> {ward, house, senate, congress} for one cycle."""
    table = {}
    for line in fetch(f"{SOS}/{cycle_dir}/PrctTbl.txt").splitlines():
        f = line.split(";")
        if len(f) < 9 or f[0] != HENNEPIN or f[8] != PLYMOUTH_FIPS:
            continue
        code, name, cong, leg = f[1], f[2], f[3], f[4]
        ward_m = re.search(r"W-?(\d+)", name)
        table[code] = {
            "name": name.title().replace("W-", "W-").strip(),
            "ward": ward_m.group(1) if ward_m else None,
            "house": leg,
            "senate": leg.rstrip("AB"),
            "congress": cong,
        }
    return table


def parse_results(text, precinct_codes, statewide):
    """Yield (precinct, office_key, candidate) rows we care about."""
    for line in text.splitlines():
        f = line.split(";")
        if len(f) < 16:
            continue
        county, precinct, office_name = f[1], f[2], f[4]
        if county != HENNEPIN or precinct not in precinct_codes:
            continue
        if statewide and "(Plymouth)" in office_name:
            continue  # local file is authoritative for city races
        order, label = classify(office_name)
        if order is None:
            continue
        votes = int(f[13] or 0)
        yield precinct, (order, label), {
            "name": "Write-in" if f[7] == "WRITE-IN" else f[7],
            "party": f[10],
            "votes": votes,
        }


def main():
    results = {k: defaultdict(dict) for k in
               ("precinct", "ward", "house", "senate", "congress", "city")}

    for cycle in CYCLES:
        print(f"Elections: {cycle['name']}")
        precincts = plymouth_precincts(cycle["dir"])
        print(f"  {len(precincts)} Plymouth precincts in {cycle['id']}")

        # races[unit_kind][unit_id][office_key][candidate_key] = votes
        races = {k: defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
                 for k in results}

        sources = [
            (fetch(f"{SOS}/{cycle['dir']}/allracesbyprecinct.txt"), True),
            (fetch(f"{SOS}/{cycle['dir']}/localPrct.txt"), False),
        ]
        for text, statewide in sources:
            for pct, office, cand in parse_results(text, precincts, statewide):
                info = precincts[pct]
                cand_key = (cand["name"], cand["party"])
                targets = [("precinct", pct), ("city", "plymouth"),
                           ("ward", info["ward"]), ("house", info["house"]),
                           ("senate", info["senate"]), ("congress", info["congress"])]
                for kind, unit in targets:
                    if unit:
                        races[kind][unit][office][cand_key] += cand["votes"]

        for kind, units in races.items():
            for unit, offices in units.items():
                cycle_races = []
                for (order, label), cands in sorted(offices.items()):
                    candidates = sorted(
                        ({"name": n, "party": p,
                          "partyName": PARTY_NAMES.get(p, p), "votes": v}
                         for (n, p), v in cands.items()),
                        key=lambda c: -c["votes"])
                    total = sum(c["votes"] for c in candidates)
                    cycle_races.append(
                        {"office": label, "total": total, "candidates": candidates})
                results[kind][unit][cycle["id"]] = cycle_races

    out = {
        "cycles": [{"id": c["id"], "name": c["name"]} for c in CYCLES],
        "results": {k: dict(v) for k, v in results.items()},
    }
    write_json("elections.json", out)


if __name__ == "__main__":
    main()
