"""Fetch MN Secretary of State precinct voter statistics and aggregate them.

For each general election cycle this reads the SoS precinct statistics file
(pctstats.txt), pulls Plymouth's precincts, and records real registered-voter
and ballot-cast counts, aggregating them to wards, MN House/Senate districts,
the congressional district, and the city as a whole — mirroring the geography
join used by 02_elections.py.

Output: web/data/turnout.json

pctstats.txt is semicolon-delimited:
  State;County;Precinct;Name;numPrecincts;reg7AM;electionDayReg;
  inPersonBallots;absenteeBallots;federalOnly;presidentialOnly;totalBallots
Registered = pre-registered (7AM) + election-day registrations.
"""

import re
from collections import defaultdict

from common import fetch, write_json

SOS = "https://electionresultsfiles.sos.mn.gov"
HENNEPIN = "27"
PLYMOUTH_FIPS = "51730"

CYCLES = [
    {"id": "2024", "name": "2024 General Election", "dir": "20241105"},
    {"id": "2022", "name": "2022 General Election", "dir": "20221108"},
    {"id": "2020", "name": "2020 General Election", "dir": "20201103"},
]


def plymouth_precincts(cycle_dir):
    """precinct code -> {ward, house, senate, congress} for one cycle."""
    table = {}
    for line in fetch(f"{SOS}/{cycle_dir}/PrctTbl.txt").splitlines():
        f = line.split(";")
        if len(f) < 9 or f[0] != HENNEPIN or f[8] != PLYMOUTH_FIPS:
            continue
        name, cong, leg = f[2], f[3], f[4]
        ward_m = re.search(r"W-?(\d+)", name)
        table[f[1]] = {
            "ward": ward_m.group(1) if ward_m else None,
            "house": leg,
            "senate": leg.rstrip("AB"),
            "congress": cong,
        }
    return table


def parse_stats(text, precinct_codes):
    """precinct -> {registered, ballots, edr}."""
    out = {}
    for line in text.splitlines():
        f = line.split(";")
        if len(f) < 12 or f[1] != HENNEPIN or f[2] not in precinct_codes:
            continue
        reg7am = int(f[5] or 0)
        edr = int(f[6] or 0)
        out[f[2]] = {"registered": reg7am + edr, "ballots": int(f[11] or 0), "edr": edr}
    return out


def main():
    areas = {k: defaultdict(dict) for k in
             ("precinct", "ward", "house", "senate", "congress", "city")}

    for cycle in CYCLES:
        print(f"Turnout: {cycle['name']}")
        precincts = plymouth_precincts(cycle["dir"])
        stats = parse_stats(fetch(f"{SOS}/{cycle['dir']}/pctstats.txt"), precincts)
        print(f"  {len(stats)} Plymouth precincts with statistics")

        agg = {k: defaultdict(lambda: {"registered": 0, "ballots": 0, "edr": 0})
               for k in areas}
        for code, s in stats.items():
            info = precincts[code]
            targets = [("precinct", code), ("city", "plymouth"),
                       ("ward", info["ward"]), ("house", info["house"]),
                       ("senate", info["senate"]), ("congress", info["congress"])]
            for kind, unit in targets:
                if not unit:
                    continue
                for key in ("registered", "ballots", "edr"):
                    agg[kind][unit][key] += s[key]

        for kind, units in agg.items():
            for unit, vals in units.items():
                areas[kind][unit][cycle["id"]] = vals

    out = {
        "cycles": [{"id": c["id"], "name": c["name"]} for c in CYCLES],
        "source": "MN Secretary of State precinct statistics (pctstats.txt)",
        "note": ("Registered = pre-registered voters at 7AM plus election-day "
                 "registrations. Turnout = ballots cast / registered."),
        "areas": {k: dict(v) for k, v in areas.items()},
    }
    write_json("turnout.json", out)


if __name__ == "__main__":
    main()
