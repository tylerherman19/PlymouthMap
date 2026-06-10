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

// Distinct colors for head-to-head mode when both candidates share a party
// color (e.g. two nonpartisan city candidates).
const DUEL_A = "#0e7490", DUEL_B = "#c2410c";

const state = {
  map: null,
  data: {},          // layer name -> geojson
  elections: null,
  demographics: null,
  activeLayer: "precincts",
  colorBy: "margin",
  leafletLayer: null,
  selectedId: null,
  mode: "area",      // "area" | "candidate"
  candA: null,       // {cycle, office, name, party, ...}
  candB: null,       // optional comparison candidate
  candidateIndex: [],
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

  buildCandidateIndex();

  document.querySelectorAll("#layer-picker button[data-layer]").forEach(btn => {
    btn.addEventListener("click", () => setLayer(btn.dataset.layer));
  });
  document.querySelectorAll("#layer-picker button[data-view]").forEach(btn => {
    btn.addEventListener("click", () => {
      if (state.mode === "candidate") exitCandidateMode(true);
      state.colorBy = btn.dataset.view;
      document.querySelectorAll("#layer-picker button[data-view]").forEach(b =>
        b.classList.toggle("active", b === btn));
      refreshStyles();
      renderLegend();
    });
  });
  // The panel re-renders constantly, so handle its links by delegation.
  document.getElementById("panel-content").addEventListener("click", e => {
    const a = e.target.closest("a");
    if (!a) return;
    if (a.id === "citywide-link") {
      e.preventDefault();
      state.selectedId = null;
      refreshStyles();
      renderPanel("city", "plymouth", { name: "City of Plymouth" });
    } else if (a.id === "exit-candidate") {
      e.preventDefault();
      exitCandidateMode(true);
    } else if (a.id === "remove-candB") {
      e.preventDefault();
      state.candB = null;
      candidateModeChanged();
    }
  });
  attachSearch(document.getElementById("cand-input"),
               document.getElementById("cand-results"),
               cand => enterCandidate(cand));

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
      lyr.bindTooltip(() => tooltipFor(kind, f.properties),
                      { sticky: true, direction: "top" });
      lyr.on("click", () => {
        state.selectedId = f.properties.id;
        refreshStyles();
        if (state.mode === "candidate") renderCandidatePanel();
        else renderPanel(kind, f.properties.id, f.properties);
      });
      lyr.on("mouseover", () => lyr.setStyle({ weight: 3, color: "#111827" }));
      lyr.on("mouseout", () => refreshStyles());
    },
  }).addTo(state.map);

  if (state.mode === "candidate") renderCandidatePanel();
}

function tooltipFor(kind, props) {
  if (state.mode !== "candidate") return esc(props.name);
  let html = `<b>${esc(props.name)}</b>`;
  for (const cand of [state.candA, state.candB]) {
    if (!cand) continue;
    const s = candStats(cand, kind, props.id);
    html += `<br>${esc(shortName(cand.name))}: ` +
            (s ? `${pct(s.votes, s.total)} (${fmt(s.votes)})` : "not on ballot");
  }
  return html;
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

// Diverging gradient: t in [-1, 1]; negative pulls toward colNeg, positive
// toward colPos, through white at zero — the classic election-map ramp.
function divergingColor(colNeg, colPos, t) {
  t = Math.max(-1, Math.min(1, t));
  return t >= 0 ? lerpColor("#ffffff", colPos, 0.08 + 0.92 * t)
                : lerpColor("#ffffff", colNeg, 0.08 + 0.92 * -t);
}

function styleFor(kind, id) {
  const selected = id === state.selectedId;
  let fill = "#d1d5db", opacity = 0.35;

  if (state.mode === "candidate") {
    const [colA, colB] = duelColors();
    if (state.candB) {
      const a = candStats(state.candA, kind, id);
      const b = candStats(state.candB, kind, id);
      if (a || b) {
        const diff = (a?.share ?? 0) - (b?.share ?? 0);
        const max = maxAbsDiff(kind) || 1;
        fill = divergingColor(colB, colA, diff / max);
        opacity = 0.7;
      }
    } else {
      const s = candStats(state.candA, kind, id);
      if (s) {
        const max = maxShare(kind) || 1;
        fill = lerpColor("#ffffff", colA, 0.08 + 0.92 * (s.share / max));
        opacity = 0.7;
      } else {
        opacity = 0.15;  // not on the ballot here
      }
    }
  } else if (state.colorBy === "margin") {
    const margin = twoPartyMargin(kind, id);
    if (margin !== null) {
      // ±50 % two-party margin saturates the red-blue gradient
      fill = divergingColor(PARTY_COLORS.R, PARTY_COLORS.DFL, margin / 0.5);
      opacity = 0.7;
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
  if (state.mode === "candidate") {
    const [colA, colB] = duelColors();
    if (state.candB) {
      el.innerHTML = `
        <span>${esc(shortName(state.candB.name))}</span>
        <span class="gradient" style="background:linear-gradient(to right,
          ${colB}, #ffffff, ${colA})"></span>
        <span>${esc(shortName(state.candA.name))}</span>
        <span class="legend-note">who's stronger where</span>`;
    } else {
      const max = maxShare(LAYERS[state.activeLayer].kind);
      el.innerHTML = `
        <span>0%</span>
        <span class="gradient" style="background:linear-gradient(to right,
          #ffffff, ${colA})"></span>
        <span>${max ? (100 * max).toFixed(0) + "%" : ""}</span>
        <span class="legend-note">${esc(shortName(state.candA.name))} vote share</span>`;
    }
    return;
  }
  if (state.colorBy === "margin") {
    el.innerHTML = `
      <span>R +50%</span>
      <span class="gradient" style="background:linear-gradient(to right,
        ${PARTY_COLORS.R}, #ffffff, ${PARTY_COLORS.DFL})"></span>
      <span>DFL +50%</span>
      <span class="legend-note">two-party margin, latest top-of-ticket race</span>`;
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

/* ---------- candidate explorer ---------- */

function buildCandidateIndex() {
  // One entry per (cycle, office, candidate), from citywide results.
  const out = [];
  const cityRaces = state.elections.results.city.plymouth;
  for (const cycle of state.elections.cycles) {
    (cityRaces[cycle.id] || []).forEach(race => {
      race.candidates.forEach(c => {
        if (c.party === "WI") return;
        out.push({
          key: `${cycle.id}|${race.office}|${c.name}`,
          cycle: cycle.id, cycleName: cycle.name, office: race.office,
          name: c.name, party: c.party, partyName: c.partyName,
          cityVotes: c.votes, cityTotal: race.total,
        });
      });
    });
  }
  state.candidateIndex = out;
}

function candStats(cand, kind, id) {
  // The candidate's votes and share of their own race in one map area.
  const races = state.elections.results[kind]?.[id]?.[cand.cycle];
  const race = races?.find(r => r.office === cand.office);
  if (!race || !race.total) return null;
  const c = race.candidates.find(x => x.name === cand.name);
  if (!c) return null;
  return { votes: c.votes, total: race.total, share: c.votes / race.total };
}

function activeUnits() {
  return state.data[state.activeLayer].features.map(f => f.properties);
}

function maxShare(kind) {
  let max = 0;
  for (const p of activeUnits()) {
    const s = candStats(state.candA, kind, p.id);
    if (s && s.share > max) max = s.share;
  }
  return max;
}

function maxAbsDiff(kind) {
  let max = 0;
  for (const p of activeUnits()) {
    const a = candStats(state.candA, kind, p.id);
    const b = candStats(state.candB, kind, p.id);
    if (!a && !b) continue;
    const d = Math.abs((a?.share ?? 0) - (b?.share ?? 0));
    if (d > max) max = d;
  }
  return max;
}

function duelColors() {
  const colA = PARTY_COLORS[state.candA?.party] ?? OTHER_COLOR;
  if (!state.candB) return [colA === "#d1d5db" ? DUEL_A : colA, null];
  const colB = PARTY_COLORS[state.candB.party] ?? OTHER_COLOR;
  return colA === colB ? [DUEL_A, DUEL_B] : [colA, colB];
}

function enterCandidate(cand) {
  state.mode = "candidate";
  state.candA = cand;
  state.candB = null;
  document.getElementById("cand-input").value = "";
  candidateModeChanged();
}

function exitCandidateMode(rerender) {
  state.mode = "area";
  state.candA = state.candB = null;
  state.selectedId = null;
  if (rerender) {
    refreshStyles();
    renderLegend();
    document.getElementById("panel-content").innerHTML = `
      <div class="panel-empty">
        <h2>Explore the map</h2>
        <p>Click any area of Plymouth to see how it votes and who lives
           there — or search a candidate above to map their performance.</p>
        <p><a href="#" id="citywide-link">View citywide results →</a></p>
      </div>`;
  }
}

function candidateModeChanged() {
  refreshStyles();
  renderLegend();
  renderCandidatePanel();
}

function attachSearch(input, resultsEl, onPick, getSuggestions) {
  const close = () => { resultsEl.hidden = true; };
  const show = items => {
    if (!items.length) { close(); return; }
    resultsEl.innerHTML = items.slice(0, 20).map((c, i) => `
      <button data-i="${i}" class="cand-hit">
        <span class="dot" style="background:${PARTY_COLORS[c.party] ?? OTHER_COLOR}"></span>
        <span class="hit-main">${esc(c.name)}</span>
        <span class="hit-sub">${esc(c.partyName)} · ${esc(c.office)} · ${esc(c.cycle)}</span>
      </button>`).join("");
    resultsEl.hidden = false;
    resultsEl.querySelectorAll("button").forEach(btn =>
      btn.addEventListener("mousedown", e => {  // mousedown beats input blur
        e.preventDefault();
        close();
        onPick(items[+btn.dataset.i]);
      }));
  };
  const search = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { show(getSuggestions ? getSuggestions() : []); return; }
    const scored = state.candidateIndex
      .map(c => {
        const name = c.name.toLowerCase(), office = c.office.toLowerCase();
        let score = -1;
        if (name.startsWith(q)) score = 0;
        else if (name.split(" ").some(w => w.startsWith(q))) score = 1;
        else if (name.includes(q)) score = 2;
        else if (office.includes(q)) score = 3;
        return { c, score };
      })
      .filter(x => x.score >= 0)
      .sort((x, y) => x.score - y.score || y.c.cycle.localeCompare(x.c.cycle)
                      || y.c.cityVotes - x.c.cityVotes);
    show(scored.map(x => x.c));
  };
  input.addEventListener("input", search);
  input.addEventListener("focus", search);
  input.addEventListener("blur", () => setTimeout(close, 150));
  input.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
}

function compareSuggestions() {
  const a = state.candA;
  const rivals = state.candidateIndex.filter(c =>
    c.cycle === a.cycle && c.office === a.office && c.key !== a.key);
  const sameName = state.candidateIndex.filter(c =>
    c.key !== a.key && shortName(c.name) === shortName(a.name));
  return [...rivals, ...sameName];
}

function rankedUnits(kind) {
  // Areas ranked by candidate A's share (or A−B diff in compare mode).
  const rows = [];
  for (const p of activeUnits()) {
    const a = candStats(state.candA, kind, p.id);
    const b = state.candB ? candStats(state.candB, kind, p.id) : null;
    if (!a && !b) continue;
    rows.push({
      name: p.name, a, b,
      sort: state.candB ? (a?.share ?? 0) - (b?.share ?? 0) : (a?.share ?? 0),
    });
  }
  return rows.sort((x, y) => y.sort - x.sort);
}

function candHeaderHtml(cand, removable) {
  const col = PARTY_COLORS[cand.party] ?? OTHER_COLOR;
  return `
    <div class="cand-head">
      <span class="dot big" style="background:${col}"></span>
      <div>
        <div class="cand-name">${esc(cand.name)}
          ${removable ? ' <a href="#" id="remove-candB" title="Remove comparison">✕</a>' : ""}</div>
        <div class="cand-meta">${esc(cand.partyName)} · ${esc(cand.office)} · ${esc(cand.cycleName)}</div>
        <div class="cand-meta">Citywide: <b>${fmt(cand.cityVotes)}</b> votes ·
          ${pct(cand.cityVotes, cand.cityTotal)} of ${fmt(cand.cityTotal)}</div>
      </div>
    </div>`;
}

function candWardTableHtml() {
  const wards = Object.keys(state.elections.results.ward).sort();
  const both = !!state.candB;
  const head = `<tr><th>Ward</th><th>${esc(shortName(state.candA.name))}</th>` +
    (both ? `<th>${esc(shortName(state.candB.name))}</th><th>Edge</th>` : "<th>Share</th>") +
    `</tr>`;
  const rows = wards.map(w => {
    const a = candStats(state.candA, "ward", w);
    const b = both ? candStats(state.candB, "ward", w) : null;
    let cells;
    if (both) {
      const diff = (a || b) ? ((a?.share ?? 0) - (b?.share ?? 0)) * 100 : null;
      cells = `<td>${a ? `<b>${fmt(a.votes)}</b><span class="tpct">${pct(a.votes, a.total)}</span>` : "—"}</td>
               <td>${b ? `<b>${fmt(b.votes)}</b><span class="tpct">${pct(b.votes, b.total)}</span>` : "—"}</td>
               <td>${diff == null ? "—" : (diff >= 0 ? "+" : "") + diff.toFixed(1) + " pp"}</td>`;
    } else {
      cells = `<td><b>${a ? fmt(a.votes) : "—"}</b></td>
               <td>${a ? pct(a.votes, a.total) : "not on ballot"}</td>`;
    }
    return `<tr><td>Ward ${esc(w)}</td>${cells}</tr>`;
  }).join("");
  return `<h3 class="section-title">By ward</h3>
    <div class="tbl-scroll"><table class="cand-table">${head}${rows}</table></div>`;
}

function bestWorstHtml(kind) {
  const ranked = rankedUnits(kind);
  if (!ranked.length) return "";
  const layerLabel = LAYERS[state.activeLayer].label.toLowerCase() + "s";
  const row = (r, flip) => {
    if (state.candB) {
      const d = ((r.a?.share ?? 0) - (r.b?.share ?? 0)) * 100 * (flip ? -1 : 1);
      return `<div class="bw-row"><span>${esc(r.name)}</span>
        <span>${(d >= 0 ? "+" : "") + d.toFixed(1)} pp</span></div>`;
    }
    return `<div class="bw-row"><span>${esc(r.name)}</span>
      <span>${r.a ? pct(r.a.votes, r.a.total) : "—"}</span></div>`;
  };
  const top = ranked.slice(0, 3), bottom = ranked.slice(-3).reverse();
  const aName = shortName(state.candA.name);
  let titleTop, titleBot, flipBottom = false;
  if (state.candB) {
    // If B never actually leads anywhere, the bottom list is A's closest
    // areas, not B's strongholds — label it honestly.
    flipBottom = ranked[ranked.length - 1].sort < 0;
    titleTop = `Best for ${aName}`;
    titleBot = flipBottom
      ? `Best for ${shortName(state.candB.name)}`
      : `Closest for ${aName}`;
  } else {
    titleTop = `Strongest ${layerLabel}`;
    titleBot = `Weakest ${layerLabel}`;
  }
  return `
    <div class="bw-grid">
      <div><h4>${esc(titleTop)}</h4>${top.map(r => row(r, false)).join("")}</div>
      <div><h4>${esc(titleBot)}</h4>${bottom.map(r => row(r, flipBottom)).join("")}</div>
    </div>`;
}

function selectedAreaHtml(kind) {
  if (!state.selectedId) return `<p class="fineprint" style="margin-top:10px">
    Tip: click any area on the map to see exact numbers there.</p>`;
  const p = activeUnits().find(u => u.id === state.selectedId);
  if (!p) return "";
  let lines = "";
  for (const cand of [state.candA, state.candB]) {
    if (!cand) continue;
    const s = candStats(cand, kind, p.id);
    lines += `<div class="bw-row"><span>${esc(shortName(cand.name))}</span>
      <span>${s ? `${pct(s.votes, s.total)} · ${fmt(s.votes)} votes` : "not on ballot"}</span></div>`;
  }
  return `<h3 class="section-title">In ${esc(p.name)}</h3>${lines}`;
}

function renderCandidatePanel() {
  const kind = LAYERS[state.activeLayer].kind;
  const el = document.getElementById("panel-content");
  const compareBox = state.candB ? candHeaderHtml(state.candB, true) : `
    <div class="compare-box">
      <input id="compare-input" type="search"
             placeholder="Compare with… (opponents, other years)"
             autocomplete="off" aria-label="Compare with another candidate">
      <div id="compare-results" hidden></div>
    </div>`;

  el.innerHTML = `
    <p class="area-kicker"><a href="#" id="exit-candidate">← Back to map areas</a></p>
    ${candHeaderHtml(state.candA, false)}
    ${state.candB ? '<div class="vs-divider">vs</div>' : ""}
    ${compareBox}
    ${bestWorstHtml(kind)}
    ${candWardTableHtml()}
    ${selectedAreaHtml(kind)}
    <p class="fineprint">The map shades each ${esc(LAYERS[state.activeLayer].label.toLowerCase())}
      by ${state.candB
        ? "who got the larger share of their own race's vote there — deeper color means a bigger gap"
        : esc(shortName(state.candA.name)) + "'s share of the vote in their race — deeper color means a stronger result"}.
      Hover or tap areas for exact numbers. Shares are of each candidate's
      own race, so candidates from different races and years can be compared
      over the same geography.</p>`;

  const ci = document.getElementById("compare-input");
  if (ci) attachSearch(ci, document.getElementById("compare-results"),
    cand => { state.candB = cand; candidateModeChanged(); },
    compareSuggestions);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
