/* Plymouth Votes — map-first civic data app.
 * Everything is static: GeoJSON layers + two JSON files produced by the
 * pipeline. No frameworks, just Leaflet and vanilla JS. */

"use strict";

const LAYERS = {
  precincts: { file: "data/precincts.geojson", kind: "precinct", label: "Voting precinct" },
  wards:     { file: "data/wards.geojson",     kind: "ward",     label: "City ward" },
  house:     { file: "data/house.geojson",     kind: "house",    label: "MN House district" },
  senate:    { file: "data/senate.geojson",    kind: "senate",   label: "MN Senate district" },
  congress:  { file: "data/congress.geojson",  kind: "congress", label: "U.S. Congressional district" },
};

const PARTY_COLORS = { DFL: "#2166ac", R: "#b2182b", NP: "#0e7490", WI: "#d1d5db" };
const OTHER_COLOR = "#9ca3af";

// Demographic map views: how to read a value and how to paint it.
const VIEWS = {
  margin:    { label: "Vote margin" },
  income:    { label: "Median household income", lo: "#edf8e9", hi: "#00541f",
               value: d => d?.medianIncome, format: v => "$" + Math.round(v).toLocaleString("en-US") },
  age:       { label: "Median age", lo: "#f2f0f7", hi: "#4a1486",
               value: d => d?.medianAge, format: v => v.toFixed(1) + " yrs" },
  diversity: { label: "Residents of color", lo: "#feedde", hi: "#8c2d04",
               value: d => d && d.population ? (d.population - d.white) / d.population : null,
               format: v => (100 * v).toFixed(0) + "%" },
};

const state = {
  map: null,
  data: {},          // layer name -> geojson
  elections: null,
  demographics: null,
  activeLayer: "precincts",
  colorBy: "margin",
  leafletLayer: null,
  selectedId: null,
};

init();

async function init() {
  state.map = L.map("map", { zoomSnap: 0.25 });
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 17,
  }).addTo(state.map);

  const files = ["data/city.geojson", "data/elections.json", "data/demographics.json",
                 ...Object.values(LAYERS).map(l => l.file)];
  const [city, elections, demographics, ...layerData] =
    await Promise.all(files.map(f => fetch(f).then(r => {
      if (!r.ok) throw new Error(`Failed to load ${f}`);
      return r.json();
    })));

  state.elections = elections;
  state.demographics = demographics;
  Object.keys(LAYERS).forEach((name, i) => { state.data[name] = layerData[i]; });

  const cityLayer = L.geoJSON(city, {
    interactive: false,
    style: { color: "#374151", weight: 2, dashArray: "5 4", fill: false },
  }).addTo(state.map);
  state.map.fitBounds(cityLayer.getBounds().pad(0.04));

  document.querySelectorAll("#layer-picker button[data-layer]").forEach(btn => {
    btn.addEventListener("click", () => setLayer(btn.dataset.layer));
  });
  document.querySelectorAll("#layer-picker button[data-view]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.colorBy = btn.dataset.view;
      document.querySelectorAll("#layer-picker button[data-view]").forEach(b =>
        b.classList.toggle("active", b === btn));
      refreshStyles();
      renderLegend();
    });
  });
  document.getElementById("citywide-link").addEventListener("click", e => {
    e.preventDefault();
    state.selectedId = null;
    refreshStyles();
    renderPanel("city", "plymouth", { name: "City of Plymouth" });
  });

  setLayer("precincts");
}

/* ---------- map rendering ---------- */

function setLayer(name) {
  state.activeLayer = name;
  state.selectedId = null;
  document.querySelectorAll("#layer-picker button").forEach(b =>
    b.classList.toggle("active", b.dataset.layer === name));

  if (state.leafletLayer) state.map.removeLayer(state.leafletLayer);
  const kind = LAYERS[name].kind;
  renderLegend();

  state.leafletLayer = L.geoJSON(state.data[name], {
    style: f => styleFor(kind, f.properties.id),
    onEachFeature: (f, lyr) => {
      lyr.bindTooltip(f.properties.name, { sticky: true, direction: "top" });
      lyr.on("click", () => {
        state.selectedId = f.properties.id;
        refreshStyles();
        renderPanel(kind, f.properties.id, f.properties);
      });
      lyr.on("mouseover", () => lyr.setStyle({ weight: 3, color: "#111827" }));
      lyr.on("mouseout", () => refreshStyles());
    },
  }).addTo(state.map);
}

function refreshStyles() {
  const kind = LAYERS[state.activeLayer].kind;
  state.leafletLayer.eachLayer(lyr =>
    lyr.setStyle(styleFor(kind, lyr.feature.properties.id)));
}

function twoPartyMargin(kind, id) {
  // DFL minus GOP share of the two-party vote in the most recent
  // top-of-ticket race available for this area.
  const unit = state.elections.results[kind]?.[id];
  if (!unit) return null;
  for (const cycle of state.elections.cycles.map(c => c.id)) {
    const races = unit[cycle];
    if (!races) continue;
    const race = races.find(r => r.office.startsWith("U.S. President")) || races[0];
    if (!race) continue;
    let dfl = 0, gop = 0;
    race.candidates.forEach(c => {
      if (c.party === "DFL") dfl += c.votes;
      if (c.party === "R") gop += c.votes;
    });
    if (dfl + gop > 0) return (dfl - gop) / (dfl + gop);
  }
  return null;
}

function viewRange(kind) {
  // min/max of the active demographic across the active layer's areas
  const view = VIEWS[state.colorBy];
  const values = state.data[state.activeLayer].features
    .map(f => view.value(state.demographics.areas[kind]?.[f.properties.id]))
    .filter(v => v != null);
  if (!values.length) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

function lerpColor(a, b, t) {
  const ch = (hex, i) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  const mix = i => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t);
  return `rgb(${mix(0)},${mix(1)},${mix(2)})`;
}

function styleFor(kind, id) {
  const selected = id === state.selectedId;
  let fill = "#d1d5db", opacity = 0.35;

  if (state.colorBy === "margin") {
    const margin = twoPartyMargin(kind, id);
    if (margin !== null) {
      fill = margin >= 0 ? PARTY_COLORS.DFL : PARTY_COLORS.R;
      opacity = 0.12 + Math.min(Math.abs(margin) / 0.5, 1) * 0.55;
    }
  } else {
    const view = VIEWS[state.colorBy];
    const v = view.value(state.demographics.areas[kind]?.[id]);
    const range = viewRange(kind);
    if (v != null && range) {
      const t = range.max > range.min ? (v - range.min) / (range.max - range.min) : 0.5;
      fill = lerpColor(view.lo, view.hi, t);
      opacity = 0.65;
    }
  }
  return {
    color: selected ? "#111827" : "#ffffff",
    weight: selected ? 3 : 1.4,
    fillColor: fill,
    fillOpacity: opacity,
  };
}

function renderLegend() {
  const el = document.getElementById("legend");
  if (state.colorBy === "margin") {
    el.innerHTML = `
      <span class="swatch" style="background:${PARTY_COLORS.DFL}"></span> DFL margin
      <span class="swatch" style="background:${PARTY_COLORS.R}; margin-left:10px"></span> GOP margin
      <span class="legend-note">most recent top-of-ticket two-party vote</span>`;
    return;
  }
  const view = VIEWS[state.colorBy];
  const range = viewRange(LAYERS[state.activeLayer].kind);
  if (!range) { el.innerHTML = ""; return; }
  el.innerHTML = `
    <span>${esc(view.format(range.min))}</span>
    <span class="gradient" style="background:linear-gradient(to right,
      ${view.lo}, ${view.hi})"></span>
    <span>${esc(view.format(range.max))}</span>
    <span class="legend-note">${esc(view.label)}</span>`;
}

/* ---------- side panel ---------- */

const fmt = n => n == null ? "—" : Math.round(n).toLocaleString("en-US");
const pct = (part, whole) => whole ? (100 * part / whole).toFixed(1) + "%" : "—";

function renderPanel(kind, id, props) {
  const demo = state.demographics.areas[kind]?.[id];
  const unit = state.elections.results[kind]?.[id];
  const el = document.getElementById("panel-content");

  let sub = "";
  if (kind === "precinct") {
    sub = `Ward ${props.ward} · MN House ${props.house} · MN Senate ${props.senate} · CD ${props.congress}`;
  } else if (kind === "city") {
    sub = "All Plymouth precincts combined";
  }

  el.innerHTML = `
    <p class="area-kicker">${esc(kindLabel(kind))}</p>
    <h2 class="area-name">${esc(props.name)}</h2>
    <p class="area-sub">${esc(sub)}</p>
    ${demographicsHtml(demo, kind)}
    ${electionsHtml(unit)}
    <p class="fineprint">Demographics are area-weighted estimates from the
      ${esc(state.demographics.release)} survey (census tracts don't follow
      these boundaries exactly). Election results are official precinct
      counts from the MN Secretary of State; pre-2022 results use that
      year's boundaries and district lines.</p>`;
  el.scrollIntoView({ block: "start", behavior: "instant" });

  el.querySelectorAll(".more-cands").forEach(btn =>
    btn.addEventListener("click", () => {
      btn.closest(".race").querySelectorAll(".cand-row.hidden-cand")
        .forEach(r => r.classList.remove("hidden-cand"));
      btn.remove();
    }));
}

function kindLabel(kind) {
  if (kind === "city") return "Citywide";
  return Object.values(LAYERS).find(l => l.kind === kind)?.label ?? kind;
}

function demographicsHtml(demo, kind) {
  if (!demo) return "";
  const income = demo.medianIncome == null ? "—"
    : demo.medianIncome >= 250000 ? "$250,000+"
    : "$" + fmt(demo.medianIncome);
  const note = (kind === "house" || kind === "senate" || kind === "congress")
    ? `<p class="fineprint" style="margin-top:6px">District figures cover the
       whole district (Hennepin County portion).</p>` : "";
  return `
    <h3 class="section-title">Who lives here</h3>
    <div class="demo-grid">
      <div class="demo-stat"><div class="v">${fmt(demo.population)}</div><div class="k">Population</div></div>
      <div class="demo-stat"><div class="v">${income}</div><div class="k">Median household income</div></div>
      <div class="demo-stat"><div class="v">${demo.medianAge ?? "—"}</div><div class="k">Median age</div></div>
      <div class="demo-stat"><div class="v">${pct(demo.white, demo.population)}</div><div class="k">White</div></div>
      <div class="demo-stat"><div class="v">${pct(demo.black, demo.population)}</div><div class="k">Black</div></div>
      <div class="demo-stat"><div class="v">${pct(demo.other, demo.population)}</div><div class="k">Other / multiracial</div></div>
    </div>${note}`;
}

function electionsHtml(unit) {
  let html = `<h3 class="section-title">How it votes</h3>`;
  if (!unit) return html + `<p class="no-data">No election results for this area.</p>`;
  for (const cycle of state.elections.cycles) {
    html += `<div class="cycle"><h3>${esc(cycle.name)}</h3>`;
    const races = unit[cycle.id];
    if (!races) {
      html += `<p class="no-data">No results under these boundaries —
               district lines changed with the 2022 redistricting.</p></div>`;
      continue;
    }
    races.forEach(r => { html += raceHtml(r, cycle.id); });
    html += `</div>`;
  }
  return html;
}

function shortName(name) {
  // "Kamala D. Harris and Tim Walz" -> "Kamala D. Harris" (ticket races)
  return name.split(" and ")[0];
}

function wardBreakdownHtml(race, cycleId) {
  // Same office, same cycle, looked up in each ward's aggregated results.
  const wardResults = state.elections.results.ward;
  const wards = Object.keys(wardResults).sort().filter(w =>
    wardResults[w][cycleId]?.some(r => r.office === race.office));
  if (!wards.length) return "";

  const wardRace = w => wardResults[w][cycleId].find(r => r.office === race.office);
  // Candidate order follows the selected area's race; add any candidates
  // that only appear in some wards.
  const names = race.candidates.map(c => c.name);
  wards.forEach(w => wardRace(w).candidates.forEach(c => {
    if (!names.includes(c.name)) names.push(c.name);
  }));

  const head = `<tr><th>Candidate</th>${wards.map(w =>
    `<th>W${esc(w)}</th>`).join("")}</tr>`;
  const rows = names.map(name => {
    const cells = wards.map(w => {
      const r = wardRace(w);
      const c = r.candidates.find(c => c.name === name);
      if (!c) return "<td>—</td>";
      return `<td><b>${fmt(c.votes)}</b><span class="tpct">${pct(c.votes, r.total)}</span></td>`;
    }).join("");
    return `<tr><td class="cname">${esc(shortName(name))}</td>${cells}</tr>`;
  }).join("");
  const totals = `<tr class="totals"><td>Total votes</td>${wards.map(w =>
    `<td>${fmt(wardRace(w).total)}</td>`).join("")}</tr>`;

  const note = wards.length < Object.keys(wardResults).length
    ? `<p class="fineprint" style="margin:4px 0 0">Only wards where this race
       was on the ballot are shown.</p>` : "";
  return `<details class="ward-breakdown">
    <summary>Ward-by-ward breakdown</summary>
    <div class="tbl-scroll"><table>${head}${rows}${totals}</table></div>${note}
  </details>`;
}

function raceHtml(race, cycleId) {
  const bar = race.candidates
    .filter(c => c.votes > 0)
    .map(c => `<div style="width:${(100 * c.votes / race.total)}%;
                background:${PARTY_COLORS[c.party] ?? OTHER_COLOR}"></div>`)
    .join("");
  const rows = race.candidates.map((c, i) => `
    <div class="cand-row ${i === 0 ? "winner" : ""} ${i >= 3 ? "hidden-cand" : ""}">
      <span class="nm"><span class="dot"
        style="background:${PARTY_COLORS[c.party] ?? OTHER_COLOR}"></span>
        ${esc(c.name)}${c.party && c.party !== "NP" && c.party !== "WI"
          ? ` <span style="color:var(--muted)">· ${esc(c.partyName)}</span>` : ""}</span>
      <span class="pct">${pct(c.votes, race.total)} · ${fmt(c.votes)}</span>
    </div>`).join("");
  const more = race.candidates.length > 3
    ? `<button class="more-cands">show all ${race.candidates.length} candidates</button>` : "";
  return `<div class="race">
    <div class="race-office">${esc(race.office)}</div>
    <div class="race-bar-wrap"><div class="race-bar">${bar}</div></div>
    ${rows}${more}
    ${wardBreakdownHtml(race, cycleId)}
  </div>`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
