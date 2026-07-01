/* Path to Win — the war room home tab. Tells the story of how Clark wins,
 * built entirely from the same real election/turnout data the map uses. */
"use strict";

const ELECTION_DAY = "November 3, 2026";

let wrImpact = null;
fetch("data/impact.json").then(r => r.json()).then(d => { wrImpact = d; tryRenderWarRoom(); });

document.addEventListener("appdata", tryRenderWarRoom);
document.addEventListener("tabshow", e => { if (e.detail.tab === "warroom") tryRenderWarRoom(); });

function tryRenderWarRoom() {
  if (!state.dataReady) return;
  renderWarRoom();
}

function warroomTargetRows() {
  const precinctIds = state.data.precincts?.features.map(f => f.properties.id) ?? [];
  const rows = precinctIds.map(id => {
    const feature = state.data.precincts.features.find(f => f.properties.id === id);
    return {
      id,
      name: feature.properties.name,
      tier: priorityTierFor("precinct", id),
      gap: mayorGap("precinct", id),
      reg: turnoutInfo("precinct", id, "2024")?.registered ?? null,
      share: dflShare("precinct", id),
    };
  }).filter(r => r.tier);

  const gotv = rows
    .filter(r => (r.tier.id === "strongbase" || r.tier.id === "base") && r.gap)
    .sort((a, b) => b.gap.gap - a.gap.gap)
    .slice(0, 6);

  const persuasion = rows
    .filter(r => (r.tier.id === "lean" || r.tier.id === "swing") && r.reg)
    .sort((a, b) => b.reg - a.reg)
    .slice(0, 6);

  return { gotv, persuasion };
}

function warroomTargetTable(rows, kind) {
  if (!rows.length) return `<p class="no-data">Not enough precinct data to rank targets yet.</p>`;
  const cols = kind === "gotv"
    ? `<th>Precinct</th><th class="num">DFL lean</th><th class="num">2022 GOTV gap</th><th class="num">2024 registered</th>`
    : `<th>Precinct</th><th class="num">DFL lean</th><th class="num">2024 registered</th>`;
  const body = rows.map(r => {
    const chip = `<span class="wr-tier-chip" style="background:${r.tier.bg};color:${r.tier.textColor}">${esc(r.tier.label)}</span>`;
    const shareTxt = r.share !== null ? (100 * r.share).toFixed(0) + "%" : "—";
    if (kind === "gotv") {
      return `<tr><td>${esc(r.name)} ${chip}</td><td class="num">${shareTxt}</td>
        <td class="num">${fmt(r.gap.gap)}</td><td class="num">${fmt(r.gap.registered)}</td></tr>`;
    }
    return `<tr><td>${esc(r.name)} ${chip}</td><td class="num">${shareTxt}</td>
      <td class="num">${fmt(r.reg)}</td></tr>`;
  }).join("");
  return `<div class="wr-table-wrap"><table class="wr-table"><thead><tr>${cols}</tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

function warroomMessageCards() {
  const items = wrImpact?.items ?? [];
  const byId = id => items.find(i => i.id === id);
  const cards = [
    {
      badge: "To the base", color: "#14532d", bg: "#dcfce7",
      title: "Turn out the vote",
      refs: ["nw-greenway", "ice-resolution"],
      copy: "Wosje ran unopposed in 2022 — thousands of reliable DFL voters never had a mayor's race to show up for. A contested race changes that math. Lead with turnout, not persuasion, here.",
    },
    {
      badge: "To persuadables", color: "#78350f", bg: "#fef3c7",
      title: "Fiscally responsible, not reckless",
      refs: ["station73", "peony-lane"],
      copy: "Kept a $35M transit project on budget through a change order, and rejected a construction bid that came in 22% over estimate rather than overpay. That's the message for lean/swing precincts.",
    },
    {
      badge: "Housing voters", color: "#1e3a8a", bg: "#eff6ff",
      title: "Real housing built, not just promised",
      refs: ["melrose", "belterra", "housing-4d"],
      copy: "212 affordable units financed at Melrose, a mixed-income development with a grocery store at Belterra, and 400+ families helped through home rehab — a three-year record, not a talking point.",
    },
    {
      badge: "Environment voters", color: "#166534", bg: "#f0fdf4",
      title: "Finished projects, not just plans",
      refs: ["nw-greenway", "smart-tree", "climate-plan"],
      copy: "The Northwest Greenway is done after 20 years — 7 miles of trail. Minnesota's first AI tree inventory shipped. The Climate Action Plan is in motion, not stalled.",
    },
  ];
  return cards.map(c => {
    const sources = c.refs.map(byId).filter(Boolean);
    const cites = sources.length
      ? `<p class="rec-card-loc" style="margin-top:6px">${sources.map(s => esc(s.title)).join(" · ")}</p>` : "";
    return `<div class="wr-msg-card">
      <span class="wr-msg-badge" style="color:${c.color}">${esc(c.badge)}</span>
      <h3>${esc(c.title)}</h3>
      <p>${esc(c.copy)}</p>
      ${cites}
    </div>`;
  }).join("");
}

function renderWarRoom() {
  const el = document.getElementById("warroom-content");
  if (!el) return;

  const cityShare = dflShare("city", "plymouth");
  const clarkCity = clarkStats2022("city", "plymouth");
  const cityTurnout = turnoutRate("city", "plymouth", "2022");
  const cityGap = mayorGap("city", "plymouth");
  const reg2024 = turnoutInfo("city", "plymouth", "2024");

  const assumedTurnout = SCENARIO_DEFAULTS.turnoutPct;
  const projectedBallots = reg2024 ? reg2024.registered * assumedTurnout : null;
  const winNumber = projectedBallots ? Math.floor(projectedBallots / 2) + 1 : null;

  const { gotv, persuasion } = warroomTargetRows();

  el.innerHTML = `
    <div class="wr-wrap">
      <div class="wr-hero">
        <div class="race-badge">2026 Mayor's Race · Election Day ${esc(ELECTION_DAY)}</div>
        <div class="candidate-matchup">
          <span class="cand-clark">Clark Gregor</span>
          <span class="cand-vs">vs.</span>
          <span class="cand-wosje">Jeff Wosje</span>
        </div>
        <p class="race-context">Wosje has 8 years as mayor and ran uncontested in 2022. Clark won an at-large council
          seat that year and is now Deputy Mayor. This is the first contested Plymouth mayor's race in years.</p>
      </div>

      <div class="wr-stats">
        <div class="wr-stat-card win">
          <div class="v">${winNumber !== null ? fmt(winNumber) : "—"}</div>
          <div class="k">Votes to win (50%+1 of ${assumedTurnout * 100}% turnout)</div>
        </div>
        <div class="wr-stat-card">
          <div class="v">${reg2024 ? fmt(reg2024.registered) : "—"}</div>
          <div class="k">Registered voters (2024)</div>
        </div>
        <div class="wr-stat-card">
          <div class="v">${cityShare !== null ? (100 * cityShare).toFixed(1) + "%" : "—"}</div>
          <div class="k">Citywide DFL lean (2024 pres.)</div>
        </div>
        <div class="wr-stat-card">
          <div class="v">${cityGap ? fmt(cityGap.gap) : "—"}</div>
          <div class="k">Didn't vote for mayor in 2022</div>
        </div>
        <div class="wr-stat-card">
          <div class="v">${cityTurnout !== null ? (100 * cityTurnout).toFixed(0) + "%" : "—"}</div>
          <div class="k">2022 midterm turnout</div>
        </div>
      </div>

      <div class="wr-section">
        <h2>The opportunity</h2>
        <p class="wr-sub">Every number below is real — official MN Secretary of State results and precinct
          registration counts, not polling.</p>
        <div class="wr-callout">
          <strong>Wosje ran unopposed in 2022.</strong> Of ${cityGap ? fmt(cityGap.registered) : "—"} registered
          Plymouth voters, only ${cityGap ? fmt(cityGap.mayorVotes) : "—"} cast a mayor's vote — leaving
          <strong>${cityGap ? fmt(cityGap.gap) : "—"} registered voters</strong> who had no reason to weigh in.
          Clark won his 2022 at-large council race with ${clarkCity ? fmt(clarkCity.votes) : "—"} votes
          (${clarkCity ? pct(clarkCity.votes, clarkCity.total) : "—"} in a 3-way race) — proof he can already turn
          out a real coalition. A contested mayor's race in a city that leans
          ${cityShare !== null ? (100 * cityShare).toFixed(0) + "% DFL" : "blue"} is Clark's race to win if the
          base actually turns out.
        </div>
      </div>

      <div class="wr-section">
        <h2>The targets: GOTV precincts</h2>
        <p class="wr-sub">Strongest DFL turf, ranked by how many registered voters skipped the mayor's race in
          2022 — the biggest untapped pools if we simply turn out the base.</p>
        ${warroomTargetTable(gotv, "gotv")}
      </div>

      <div class="wr-section">
        <h2>The targets: persuasion precincts</h2>
        <p class="wr-sub">Lean-DFL and swing precincts, ranked by size — where the campaign needs to win the
          argument, not just the doors.</p>
        ${warroomTargetTable(persuasion, "persuasion")}
      </div>

      <div class="wr-section">
        <h2>The message</h2>
        <p class="wr-sub">Real record, matched to the audience — see the full record on the Clark's Record tab.</p>
        <div class="wr-msg-grid">${warroomMessageCards()}</div>
      </div>

      ${warroomEndorsements()}

      <div class="wr-section">
        <h2>Go deeper</h2>
        <div class="wr-cta">
          <button class="wr-btn" onclick="showTab('map')">Open the interactive map →</button>
          <button class="wr-btn alt" onclick="showTab('record')">See Clark's full record →</button>
        </div>
      </div>
    </div>`;
}

function warroomEndorsements() {
  const e = wrImpact?.endorsements;
  if (!e) return "";
  const group = (label, arr) => arr && arr.length
    ? `<div class="wr-endorse-group"><h3>${esc(label)}</h3><ul>${
        arr.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "";
  return `<div class="wr-section">
    <h2>Who's behind Clark</h2>
    <p class="wr-sub">A coalition already on the record — labor, Realtors, current and former officials,
      and community leaders.</p>
    <div class="wr-endorse-grid">
      ${group("Elected & former officials", e.officials)}
      ${group("Labor & organizations", e.organizations)}
      ${group("Community leaders", e.community)}
    </div>
    <p class="fineprint"><a href="${esc(e.source)}" target="_blank" rel="noopener">Full endorsement list →</a></p>
  </div>`;
}
