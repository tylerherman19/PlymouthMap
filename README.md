# Plymouth Votes — an election & demographics map for Plymouth, Minnesota

**Plymouth Votes** is a small civic web app that lets anyone explore how
different parts of Plymouth, Minnesota vote, and what those areas look like
demographically. Click anywhere on the map and a side panel shows election
results for that area across recent election cycles — presidential, U.S.
House, Minnesota Legislature, and Plymouth city races — alongside basic
census demographics (population, median income, racial composition, median
age).

There is no login, no tracking, and nothing to install. It is a single
static web page backed by pre-processed open data.

---

## What you can do with it

- **Click any area** of Plymouth — a voting precinct, a city ward, or a
  legislative district — and see:
  - **Election results** for the 2020, 2022, and 2024 general elections:
    U.S. President, U.S. Senate, U.S. House (MN‑03), Governor, MN Senate,
    MN House, and Plymouth municipal races (mayor and city council).
  - **Demographics** from the U.S. Census Bureau's American Community
    Survey: population, median household income, racial composition, and
    median age.
- **Break any race down by ward** — every race in the side panel (state
  legislative, governor, federal, and city races alike) has a
  "Ward-by-ward breakdown" table comparing each candidate's votes and
  share across Plymouth's four wards.
- **Toggle geographic layers**:
  - Voting precincts
  - City wards (Plymouth has 4)
  - Minnesota House districts
  - Minnesota Senate districts
  - U.S. Congressional district (MN‑03)
- **Switch what the map colors mean** — shade areas by vote margin
  (default, on a classic red‑to‑blue election gradient), median household
  income, median age, or share of residents of color.
- **Drill into any candidate** — search a candidate by name and the map
  shades every area by their vote share, with their strongest and weakest
  areas, a ward table, and exact numbers wherever you click.
- **Compare candidates head-to-head** — add a second candidate (an
  opponent, or the same person in a different year) and the map shows
  who was stronger where, over the same geography.
- **Compare election years side by side** — a split-screen mode shows two
  election cycles at once with a draggable divider, so you can physically
  sweep across the map and watch precincts shift between years.
- **Overlay demographics on the vote** — toggle a translucent income, age,
  or diversity layer on top of any voting map to eyeball how voting
  patterns line up with neighborhood demographics.
- **Export a slide graphic in one click** — the "Export slide" button
  downloads a clean 1920×1080 PNG of the current map (no basemap, no UI
  controls) with a title and legend, ready to drop into a deck. It works
  in every mode, including candidate comparisons and split-screen years.
- **Use it on a phone** — the layout adapts to small screens: map on top,
  details below, scrollable layer chips.

Results for wards and districts are computed by summing the official
precinct‑level vote counts of the precincts inside each area.

---

## Repository layout

```
PlymouthMap/
├── README.md                 ← you are here
├── web/                      ← the app itself (static site, no build step)
│   ├── index.html
│   ├── css/style.css
│   ├── js/app.js
│   └── data/                 ← generated GeoJSON + JSON (committed, so the
│                                app works without running the pipeline)
├── pipeline/                 ← data processing scripts (Python)
│   ├── requirements.txt
│   ├── common.py             ← shared geometry/IO helpers
│   ├── 01_geography.py       ← fetch & clip boundaries (city, precincts,
│   │                            wards, MN House/Senate, US Congress)
│   ├── 02_elections.py       ← fetch MN Secretary of State precinct
│   │                            results, filter to Plymouth, aggregate
│   ├── 03_demographics.py    ← fetch Census ACS data, area-weight tracts
│   │                            onto each geography
│   └── run_all.py            ← run the whole pipeline in order
└── .github/workflows/deploy.yml  ← deploys web/ to GitHub Pages
```

---

## Running it locally

The app is a static site — you only need something that can serve files.

```bash
git clone https://github.com/tylerherman19/PlymouthMap.git
cd PlymouthMap
python3 -m http.server 8000 --directory web
```

Then open <http://localhost:8000>. That's it — the processed data is
committed in `web/data/`, so no pipeline run is required just to use the
app.

---

## How the data is processed

The `pipeline/` scripts rebuild everything in `web/data/` from authoritative
sources. You only need to run them to refresh data (for example after a new
election).

```bash
cd pipeline
python3 -m pip install -r requirements.txt
python3 run_all.py
```

What each step does:

1. **`01_geography.py`** — downloads boundaries and writes GeoJSON:
   - **City boundary, wards, precincts**: Hennepin County GIS
     (`gis.hennepin.us` ArcGIS REST, the server behind Hennepin's open data
     portal). Precinct records carry their ward, MN House/Senate, and
     congressional district assignments, which is how everything joins
     together.
   - **MN House / MN Senate / U.S. Congressional districts**: the U.S.
     Census Bureau's TIGERweb API (these reflect Minnesota's 2022
     redistricting). Only districts that contain Plymouth precincts are
     kept.
   - Geometries are simplified slightly so the app stays fast.
2. **`02_elections.py`** — downloads the Minnesota Secretary of State's
   official precinct-level results files for the 2020, 2022, and 2024
   general elections, filters to Plymouth's precincts, keeps the relevant
   offices (federal, state legislative, and Plymouth city races), and
   aggregates precinct votes up to wards and districts. Precinct boundaries
   change between cycles; results are matched by the state precinct code,
   and older cycles that don't match current boundaries are still shown at
   the ward/district level.
3. **`03_demographics.py`** — fetches ACS 5‑year estimates for every census
   tract in Hennepin County (population `B01003_001E`, median income
   `B19013_001E`, white `B02001_002E`, Black `B02001_003E`, median age
   `B01002_001E`), downloads tract boundaries, and computes
   **area‑weighted** estimates for each precinct, ward, and district:
   counts are apportioned by how much of each tract overlaps the area;
   medians are population‑weighted averages. District figures cover the
   Hennepin County portion of each district.

   The Census Bureau's data API requires a (free) API key. If you set a
   `CENSUS_API_KEY` environment variable the script uses the official
   ACS 2019–2023 API; otherwise it falls back to
   [Census Reporter](https://censusreporter.org)'s public mirror of the
   latest ACS release. Either way the same five tables are used.

Everything lands in `web/data/` as plain GeoJSON/JSON that the frontend
reads directly. There is no database and no server-side code.

### Data sources

| Data | Source |
| --- | --- |
| City boundary, wards, precincts | [Hennepin County GIS open data](https://gis-hennepin.hub.arcgis.com/) |
| MN House / Senate / U.S. House districts, census tracts | [Census TIGERweb](https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb) |
| Election results (2020, 2022, 2024) | [MN Secretary of State](https://electionresults.sos.mn.gov) precinct results files |
| Demographics | [Census ACS 5‑year API](https://api.census.gov/data/2023/acs/acs5) (or [Census Reporter](https://censusreporter.org) without a key) |

---

## Deploying to a public URL

The repo ships with a GitHub Actions workflow that publishes `web/` to
**GitHub Pages** on every push to `main`.

One-time setup:

1. On GitHub, open the repository **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main` (or re-run the “Deploy to GitHub Pages” workflow from the
   Actions tab).

The app will be live at:

```
https://tylerherman19.github.io/PlymouthMap/
```

Because the site is fully static, it can also be dropped onto Netlify,
Vercel, Cloudflare Pages, or any web server — just point the host at the
`web/` directory.

---

## Honest caveats

- Demographic figures are *estimates*: census tracts don't line up with
  precincts or districts, so values are apportioned by area overlap. Treat
  them as context, not exact counts.
- ACS median income is top-coded at $250,001; very affluent tracts show as
  "$250,000+".
- Election results are from the official MN Secretary of State files, but
  precinct boundaries change between redistricting cycles; 2020 results are
  reported on 2020 precincts and are aggregated to current districts where
  the precinct codes still match.
- This is an independent civic project, not affiliated with the City of
  Plymouth, Hennepin County, or the State of Minnesota.
