/* Ward History tab. Renders data/ward_history.json (a direct export of
 * Plymouth_Ward_Election_Data_2014-2024.xlsx). No numbers are typed in here. */
"use strict";
(function () {
  const root = document.getElementById("wards-content");
  if (!root) return;
  const WARD_COLORS = { "Ward 1": "#1f4e79", "Ward 2": "#c0662b", "Ward 3": "#3f7d5c", "Ward 4": "#7a5195" };
  const WARDS = ["Ward 1", "Ward 2", "Ward 3", "Ward 4"];
  const YEARS = [2014, 2016, 2018, 2020, 2022, 2024];
  const EST_MAX = 2020; // 2014-2020 by-ward figures on current lines are estimates
  let D = null;
  const ui = { metric: "ballots", raceKind: "Mayor", raceYear: 2022, lines: "drawn" };

  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const isNum = v => typeof v === "number" && isFinite(v);
  const fInt = v => isNum(v) ? Math.round(v).toLocaleString("en-US") : "";
  const fPct = (v, d = 1) => isNum(v) ? (v * 100).toFixed(d) + "%" : "";
  const fSgnPct = (v, d = 1) => isNum(v) ? (v >= 0 ? "+" : "\u2212") + Math.abs(v * 100).toFixed(d) + "%" : "";
  const fPts = (v, d = 1) => isNum(v) ? (v >= 0 ? "+" : "\u2212") + Math.abs(v * 100).toFixed(d) + " pts" : "";
  const fMarg = (v, d = 1) => isNum(v) ? (v >= 0 ? "+" : "\u2212") + Math.abs(v).toFixed(d) : "";

  fetch("data/ward_history.json?v=20261002a").then(r => r.json()).then(d => { D = d; render(); })
    .catch(() => { root.innerHTML = '<div class="wh-wrap"><p>Could not load the ward history data.</p></div>'; });

  /* ---------- data access ---------- */
  function tc(year, ward) { return D.turnoutCurrent.find(r => Number(r.Year) === year && r.Ward === ward); }
  function partisan(year, ward) { return D.partisan.current.find(r => Number(r.year) === year && r.ward === ward); }
  function raceDrawn(kind, year) { return D.resultsAsDrawn.find(r => r.year === year && r.race === kind); }
  function raceCurrent(kind, year) { return D.resultsCurrent.find(r => r.year === year && r.race === kind); }

  const METRICS = [
    { id: "ballots", label: "Ballots cast", field: "Ballots cast", avg: "Ballots cast", kind: "count" },
    { id: "turnout", label: "Turnout", field: "Turnout", avg: "Turnout", kind: "rate" },
    { id: "atlarge", label: "At-large votes", field: "At-large votes", avg: "At-large votes", kind: "count" },
    { id: "aldrop", label: "At-large drop-off", field: "At-large drop-off", avg: "At-large drop-off", kind: "rate" },
    { id: "mayor", label: "Mayor votes", field: "Mayor votes", avg: "Mayor votes", kind: "count" },
    { id: "mdrop", label: "Mayor drop-off", field: "Mayor drop-off", avg: "Mayor drop-off", kind: "rate" },
    { id: "dfl", label: "DFL margin, top of ticket", kind: "margin" }
  ];
  function metricVal(m, year, ward) {
    if (m.id === "dfl") { const p = partisan(year, ward); return p ? p.margin : null; }
    const r = tc(year, ward); const v = r ? r[m.field] : null; return isNum(v) ? v : null;
  }
  function fmtMetric(m, v) { return m.kind === "count" ? fInt(v) : m.kind === "rate" ? fPct(v) : fMarg(v); }

  /* ---------- line chart ---------- */
  function lineChart(m) {
    const cw = Math.max(320, Math.min(1000, (root.clientWidth || 1000) - (window.innerWidth < 860 ? 32 : 56)));
    const narrow = cw < 640;
    const W = cw, H = narrow ? 360 : 430, L = narrow ? 44 : 64, R = narrow ? 64 : 130, T = 26, B = 40;
    const withCity = m.kind !== "count"; // citywide totals would flatten the ward lines on count charts; they stay in the table
    const series = WARDS.concat(withCity ? ["Citywide"] : []).map(w => ({
      ward: w, pts: YEARS.map(y => ({ y, v: metricVal(m, y, w) })).filter(p => p.v !== null)
    })).filter(s => s.pts.length);
    const all = series.flatMap(s => s.pts.map(p => p.v));
    let lo = Math.min(...all), hi = Math.max(...all);
    if (m.kind === "count") lo = 0;
    if (m.kind === "margin") lo = Math.min(lo, 0);
    const ticks = niceTicks(lo, hi, 5);
    lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
    const x = i => L + (W - L - R) * i / (YEARS.length - 1);
    const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    const xi = yr => YEARS.indexOf(yr);
    let s = `<svg class="wh-chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:100%;height:auto" role="img" aria-label="${esc(m.label)} by ward, 2014 to 2024">`;
    const bandR = (x(xi(2020)) + x(xi(2022))) / 2;
    s += `<rect class="est-band" x="${L}" y="${T}" width="${bandR - L}" height="${H - T - B}"/>`;
    s += `<text class="band-l" x="${L + 8}" y="${T + 15}">${narrow ? "2014\u20132020: estimates" : "2014\u20132020: estimates rebuilt on 2022 ward lines"}</text>`;
    s += `<text class="band-l" x="${bandR + 8}" y="${T + 15}">${narrow ? "Actual" : "2022\u20132024: actual"}</text>`;
    ticks.forEach(t => {
      s += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 && m.kind === "margin" ? "#16202c" : "#d5d9de"}" stroke-width="1"/>`;
      s += `<text class="ax" x="${L - 8}" y="${y(t) + 4}" text-anchor="end">${fmtTick(m, t)}</text>`;
    });
    YEARS.forEach((yr, i) => { s += `<text class="ax" x="${x(i)}" y="${H - 14}" text-anchor="middle">${yr}</text>`; });
    const ends = [];
    series.forEach(se => {
      const col = se.ward === "Citywide" ? "#16202c" : WARD_COLORS[se.ward];
      const sw = se.ward === "Citywide" ? 1.6 : 2.6;
      for (let k = 0; k < se.pts.length - 1; k++) {
        const a = se.pts[k], b = se.pts[k + 1];
        const est = se.ward !== "Citywide" && a.y <= EST_MAX;
        s += `<line x1="${x(xi(a.y))}" y1="${y(a.v)}" x2="${x(xi(b.y))}" y2="${y(b.v)}" stroke="${col}" stroke-width="${sw}" ${est ? 'stroke-dasharray="7 5"' : ""} ${se.ward === "Citywide" ? 'opacity=".85"' : ""}/>`;
      }
      se.pts.forEach(p => {
        const est = se.ward !== "Citywide" && p.y <= EST_MAX;
        s += `<circle cx="${x(xi(p.y))}" cy="${y(p.v)}" r="${se.ward === "Citywide" ? 3.4 : 4.4}" fill="${est ? "#fff" : col}" stroke="${col}" stroke-width="2"><title>${esc(se.ward)} ${p.y}${est ? " (estimate)" : ""}: ${esc(fmtMetric(m, p.v))}</title></circle>`;
      });
      const last = se.pts[se.pts.length - 1];
      ends.push({ ward: se.ward, col, last, ypos: y(last.v) });
    });
    ends.sort((a, b) => a.ypos - b.ypos);
    for (let i = 1; i < ends.length; i++) if (ends[i].ypos - ends[i - 1].ypos < 16) ends[i].ypos = ends[i - 1].ypos + 16;
    ends.forEach(e => {
      s += `<text x="${x(xi(e.last.y)) + (narrow ? 8 : 12)}" y="${e.ypos + 4}" font-size="${narrow ? 11.5 : 12.5}" font-weight="700" fill="${e.col}" style="fill:${e.col}">${e.ward}</text>`;
    });
    s += "</svg>";
    return s;
  }
  function niceTicks(lo, hi, n) {
    const span = hi - lo || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(k => k >= raw);
    const out = []; for (let t = Math.floor(lo / step) * step; t <= hi + step * 0.999; t += step) out.push(+t.toFixed(10));
    return out;
  }
  function fmtTick(m, t) { return m.kind === "count" ? fInt(t) : m.kind === "rate" ? fPct(t, 0) : (t > 0 ? "+" : t < 0 ? "\u2212" : "") + Math.abs(Math.round(t)); }

  /* ---------- metric table ---------- */
  function metricTable(m) {
    const rows = WARDS.concat(["Citywide"]);
    if (m.id === "dfl") {
      let h = `<thead><tr><th>Ward</th>${YEARS.map(y => `<th class="${y <= EST_MAX ? "est" : ""}">${y}${y <= EST_MAX ? "\u2020" : ""}</th>`).join("")}</tr></thead><tbody>`;
      h += `<tr><td style="color:var(--wh-mute)">Office</td>${YEARS.map(y => `<td>${esc((partisan(y, "Citywide") || {}).office || "")}</td>`).join("")}</tr>`;
      rows.forEach(w => { h += `<tr class="${w === "Citywide" ? "tot" : ""}"><td>${w}</td>${YEARS.map(y => `<td class="${y <= EST_MAX && w !== "Citywide" ? "est" : ""}">${fMarg(metricVal(m, y, w))}</td>`).join("")}</tr>`; });
      return `<table class="wh-t"><caption>DFL margin = DFL minus Republican share of top-of-ticket votes, in points. Positive favors the DFL candidate.</caption>${h}</tbody></table>`;
    }
    const blk = D.averages[m.avg];
    const hd = blk.header.slice();
    const isMayor = m.id === "mayor" || m.id === "mdrop";
    const colLabels = hd.map((c, i) => (isMayor && i === hd.length - 1 && c === "2014 to 2024") ? "2014 to 2022" : c);
    const keep = hd.map((c, i) => i === 0 || i === 1 || blk.rows.some(r => isNum(r[i])));
    const isChg = i => i >= 10;
    const fmtCell = (i, v) => {
      if (!isNum(v)) return "";
      if (isChg(i)) return m.kind === "count" ? fSgnPct(v) : fPts(v);
      return fmtMetric(m, v);
    };
    let h = "<thead><tr>";
    hd.forEach((c, i) => {
      if (!keep[i]) return;
      const yr = Number(c); const est = YEARS.includes(yr) && yr <= EST_MAX;
      h += `<th class="${est ? "est" : ""} ${i === 7 || i === 10 ? "sep" : ""}">${esc(colLabels[i])}${est ? "\u2020" : ""}</th>`;
    });
    h += "</tr></thead><tbody>";
    blk.rows.forEach(r => {
      const city = r[0] === "Citywide";
      h += `<tr class="${city ? "tot" : ""}">`;
      hd.forEach((c, i) => {
        if (!keep[i]) return;
        const yr = Number(c); const est = !city && YEARS.includes(yr) && yr <= EST_MAX;
        h += `<td class="${est ? "est" : ""} ${i === 7 || i === 10 ? "sep" : ""}">${i === 0 ? esc(r[0]) : fmtCell(i, r[i])}</td>`;
      });
      h += "</tr>";
    });
    const cap = m.kind === "count"
      ? "Counts are shown as whole numbers; the workbook keeps fractional values for rebuilt years. Change columns are percent changes."
      : "Change columns are percentage-point changes.";
    return `<table class="wh-t"><caption>${esc(m.label)} by ward on current (2022) lines. ${cap}</caption>${h}</tbody></table>`;
  }

  function metricSection() {
    const m = METRICS.find(x => x.id === ui.metric);
    const btns = METRICS.map(x => `<button type="button" data-metric="${x.id}" aria-pressed="${x.id === ui.metric}">${esc(x.label)}</button>`).join("");
    const mayorNote = (m.id === "mayor" || m.id === "mdrop") ? `<p class="wh-note">Plymouth elects its mayor in 2014, 2018 and 2022 only, so this metric has three points per ward. The workbook labels the last change column in its mayor tables "2014 to 2024"; the figure is the change from 2014 to 2022, the last mayor election, and is labeled that way here.</p>` : "";
    return `<div class="wh-controls" role="group" aria-label="Choose a measure">${btns}</div>
      ${lineChart(m)}
      <div class="wh-legend">${WARDS.map(w => `<span><i style="border-color:${WARD_COLORS[w]}"></i>${w}</span>`).join("")}${m.kind !== "count" ? '<span><i style="border-color:#16202c"></i>Citywide (actual, all years)</span>' : ""}<span><i class="dash"></i>Dashed line, hollow dot = estimate</span></div>
      <div class="wh-tw">${metricTable(m)}</div>
      <p class="wh-note">\u2020 Ward figures for 2014 to 2020 are estimates: each old precinct was split across the 2022 wards by map overlap and 2024 voter density (see Redistricting below). Citywide figures are actual in every year.</p>${mayorNote}`;
  }

  /* ---------- midterm vs presidential ---------- */
  function typeSection() {
    const h = D.electionType.header, rows = D.electionType.rows;
    const ix = n => h.indexOf(n);
    const cMid = ix("Avg turnout, midterm"), cPres = ix("Avg turnout, presidential");
    let bars = rows.map(r => {
      const city = r[0] === "Citywide";
      return `<div class="wh-bar ${city ? "city" : ""}" style="grid-template-columns:78px 1fr 150px">
        <span class="lab">${esc(r[0])}</span>
        <span style="display:block"><span class="track" style="height:12px;margin-bottom:3px"><span class="seg" style="width:${r[cMid] * 100}%;background:#16202c"></span></span>
        <span class="track" style="height:12px"><span class="seg" style="width:${r[cPres] * 100}%;background:#8a9099"></span></span></span>
        <span class="who">${fPct(r[cMid])} midterm<br>${fPct(r[cPres])} presidential</span></div>`;
    }).join("");
    let t = `<thead><tr><th>Ward</th><th>Avg ballots, mayor years</th><th>Avg ballots, pres. years</th><th>Pres. vs. mayor years</th><th>Turnout gap</th><th>Avg mayor votes</th><th>Avg mayor drop-off</th></tr></thead><tbody>`;
    rows.forEach(r => {
      t += `<tr class="${r[0] === "Citywide" ? "tot" : ""}"><td>${esc(r[0])}</td><td>${fInt(r[ix("Avg ballots, mayor/midterm years")])}</td><td>${fInt(r[ix("Avg ballots, council-only/presidential years")])}</td><td>${fSgnPct(r[ix("Presidential vs. midterm ballots")])}</td><td>${fPts(r[ix("Turnout gap (pts)")])}</td><td>${fInt(r[ix("Avg votes in mayor race")])}</td><td>${fPct(r[ix("Avg mayor drop-off")])}</td></tr>`;
    });
    return `<div class="wh-split"><div><h3>Average turnout by ward</h3><div class="wh-bars">${bars}</div>
      <div class="wh-legend"><span><i style="border-color:#16202c"></i>Mayor / midterm years (2014, 2018, 2022)</span><span><i style="border-color:#8a9099"></i>Council-only / presidential years (2016, 2020, 2024)</span></div></div>
      <div><h3>Mayor race: contested or not</h3>${compTable()}</div></div>
      <h3>Averages, current ward lines</h3><div class="wh-tw"><table class="wh-t">${t}</tbody></table></div><div>
      <p class="wh-note">Every mayor race fell in a midterm year and every council-only year was a presidential year, so the mayor effect and the midterm effect cannot be separated with Plymouth data alone. Ward averages mix estimated (2014\u20132020) and actual (2022\u20132024) values.</p></div>`;
  }

  function compTable() {
    const c = D.competitiveness, h = c.header, ix = n => h.indexOf(n);
    let t = `<thead><tr><th>Year</th><th>Mayor race</th><th>Mayor votes</th><th>Mayor drop-off</th><th>At-large drop-off</th><th>Mayor minus at-large</th></tr></thead><tbody>`;
    c.rows.forEach(r => { t += `<tr><td>${r[0]}</td><td class="name" style="text-align:left">${esc(r[ix("Mayor race")])}</td><td>${fInt(r[ix("Mayor votes")])}</td><td>${fPct(r[ix("Mayor drop-off")])}</td><td>${fPct(r[ix("At-large drop-off")])}</td><td>${fPts(r[ix("Mayor minus at-large drop-off")])}</td></tr>`; });
    return `<div class="wh-tw" style="margin-top:0"><table class="wh-t">${t}</tbody></table></div>
      <p class="wh-note">Drop-off is the share of voters who cast a ballot but skipped the race. The workbook does not test whether contest explains drop-off; three mayor elections is a small sample.</p>`;
  }

  /* ---------- race results ---------- */
  const RANK_COLORS = ["#16202c", "#c0662b", "#3f7d5c", "#7a5195", "#a8761f", "#8a9099"];
  function raceYears(kind) { return D.resultsAsDrawn.filter(r => r.race === kind).map(r => r.year); }
  function raceView(kind, year, lines) {
    const rd = raceDrawn(kind, year);
    if (!rd) return null;
    const cols = [];
    const ncol = 5;
    const useCur = lines === "current" && year < 2022;
    const rc = useCur ? raceCurrent(kind, year) : null;
    const cands = rd.cands.map(c => c.name);
    const names = cands.filter(n => n !== "Write-in").concat(cands.includes("Write-in") ? ["Write-in"] : []);
    const labels = WARDS.concat(["Citywide"]);
    labels.forEach((lab, i) => {
      let votes = {}, pct = {}, total = null, winner = null, margin = null;
      if (useCur && i < 4) {
        rc.cands.forEach(c => { votes[c.name] = c.v[i]; pct[c.name] = c.v[4 + i]; });
        total = rc.total[i]; winner = rc.winner[i]; margin = rc.margin[4 + i];
      } else {
        rd.cands.forEach(c => { votes[c.name] = c.v[i]; pct[c.name] = c.v[5 + i]; });
        total = rd.total[i]; winner = rd.winner[i]; margin = rd.margin[5 + i];
      }
      cols.push({ lab, votes, pct, total, winner, margin, est: useCur && i < 4 });
    });
    return { names, cols, useCur, drawnLines: year < 2022 ? "2012 plan (23 precincts)" : "2022 plan (21 precincts)" };
  }
  function lastName(n) { return n === "Write-in" ? n : n.split(" ").slice(-1)[0]; }
  function raceSection() {
    const kinds = [["Mayor", "Mayor"], ["CM At Large", "City council, at large"]];
    const years = raceYears(ui.raceKind);
    if (!years.includes(ui.raceYear)) ui.raceYear = years[years.length - 1];
    const v = raceView(ui.raceKind, ui.raceYear, ui.lines);
    const kbtn = kinds.map(k => `<button type="button" data-rkind="${k[0]}" aria-pressed="${k[0] === ui.raceKind}">${k[1]}</button>`).join("");
    const ysel = `<select class="wh-sel" id="wh-year" aria-label="Election year">${years.map(y => `<option value="${y}" ${y === ui.raceYear ? "selected" : ""}>${y}</option>`).join("")}</select>`;
    const canCur = ui.raceYear < 2022;
    const lbtn = `<span class="wh-controls" style="margin:0"><button type="button" data-lines="drawn" aria-pressed="${ui.lines === "drawn" || !canCur}">Lines in force then</button><button type="button" data-lines="current" aria-pressed="${ui.lines === "current" && canCur}" ${canCur ? "" : "disabled"}>Current (2022) lines${canCur ? ", estimated" : ""}</button></span>`;
    const colorOf = n => n === "Write-in" ? "#b9bec5" : RANK_COLORS[v.names.indexOf(n)];
    let bars = v.cols.map(c => {
      const segs = v.names.map(n => {
        const p = c.pct[n]; if (!isNum(p) || p <= 0) return "";
        return `<span class="seg" style="width:${p * 100}%;background:${colorOf(n)}" title="${esc(n)}: ${fInt(c.votes[n])} (${fPct(p)})"></span>`;
      }).join("");
      const winTxt = `${esc(lastName(c.winner))} ${fMarg(c.margin * 100)} pts`;
      return `<div class="wh-bar ${c.lab === "Citywide" ? "city" : ""}"><span class="lab">${c.lab}${c.est ? '<span class="wh-est-flag">\u2020</span>' : ""}</span><span class="track">${segs}</span><span class="who">${winTxt}</span></div>`;
    }).join("");
    const legend = v.names.map(n => `<span><i style="border-color:${colorOf(n)}"></i>${esc(n)}</span>`).join("");
    let thead = `<thead><tr><th>Candidate</th>${v.cols.map(c => `<th class="${c.est ? "est" : ""}">${c.lab}${c.est ? "\u2020" : ""}</th>`).join("")}</tr></thead>`;
    let tbody = v.names.map(n => `<tr><td class="name"><span class="wh-dot" style="background:${colorOf(n)}"></span>${esc(n)}</td>${v.cols.map(c => `<td class="${c.est ? "est" : ""} ${c.winner === n ? "win" : ""}">${fInt(c.votes[n])}<br><span style="color:var(--wh-mute);font-weight:400">${fPct(c.pct[n])}</span></td>`).join("")}</tr>`).join("");
    tbody += `<tr class="tot"><td>Total votes</td>${v.cols.map(c => `<td class="${c.est ? "est" : ""}">${fInt(c.total)}</td>`).join("")}</tr>`;
    const diff = v.cols.filter(c => c.lab !== "Citywide" && c.winner !== v.cols[4].winner).map(c => `${c.lab} (${c.winner})`);
    const call = diff.length
      ? `<div class="wh-callout"><strong>Split verdict.</strong> ${esc(v.cols[4].winner)} won citywide, but ${diff.map(esc).join(" and ")} went another way.</div>`
      : `<div class="wh-callout">${esc(v.cols[4].winner)} led in every ward.</div>`;
    const note = v.useCur
      ? "Estimates: the old precinct results were re-cut onto the 2022 ward lines, so wards line up with 2022 and 2024. The Citywide column is actual."
      : `Ward lines in force at the time: ${v.drawnLines}. Ward numbers before and after 2022 do not describe the same ground, so compare wards across 2020 and 2022 only on current lines.`;
    return `<div class="wh-controls" role="group" aria-label="Choose a race">${kbtn}<span style="width:12px"></span>${ysel}<span style="width:12px"></span>${lbtn}</div>
      ${call}
      <div class="wh-bars">${bars}</div>
      <div class="wh-legend">${legend}</div>
      <p class="wh-note" style="margin-bottom:0">The figure at the end of each row is the winner's margin over second place, in points of all votes cast in that ward. ${note}</p>
      <div class="wh-tw">
        <table class="wh-t"><caption>${ui.raceYear} ${ui.raceKind === "Mayor" ? "Mayor" : "City council at-large"}: votes and share of votes cast, as in the workbook's Results by Ward sheet${v.useCur ? " and Citywide Races (Current Lines) sheet" : ""}. Winner in bold.</caption>${thead}<tbody>${tbody}</tbody></table></div>`;
  }

  /* ---------- ward-seat races ---------- */
  function seatSection() {
    const seats = D.resultsAsDrawn.filter(r => /^CM Ward/.test(r.race));
    let t = `<thead><tr><th>Year</th><th style="text-align:left">Seat</th><th style="text-align:left">Winner</th><th>Votes</th><th>Share</th><th style="text-align:left">Runner-up</th><th>Margin</th><th>Names on ballot</th></tr></thead><tbody>`;
    seats.forEach(r => {
      const cs = r.cands.filter(c => c.name !== "Write-in").slice().sort((a, b) => b.v[0] - a.v[0]);
      const w = cs[0], ru = cs[1];
      t += `<tr><td>${r.year}</td><td style="text-align:left">${esc(r.race.replace("CM ", ""))}</td><td class="win" style="text-align:left">${esc(w.name)}</td><td>${fInt(w.v[0])}</td><td>${fPct(w.v[1])}</td><td style="text-align:left">${ru ? esc(ru.name) : "unopposed"}</td><td>${ru ? fMarg(r.margin[1] * 100) + " pts" : "n/a"}</td><td>${cs.length}</td></tr>`;
    });
    return `<div class="wh-tw"><table class="wh-t"><caption>Ward-seat races, as drawn at the time. Margin is winner minus second place, in points of all votes cast in the race (write-ins included in the base).</caption>${t}</tbody></table></div>
      <p class="wh-note">Ward seats are shown only on the lines in force at the time of the election; the workbook does not rebuild them on current lines.</p>`;
  }

  /* ---------- top of ticket (citywide) ---------- */
  function topTicket() {
    const rows = D.partisan.asDrawn.filter(r => r.ward === "Citywide");
    let t = `<thead><tr><th>Year</th><th style="text-align:left">Office</th><th>DFL votes</th><th>Republican votes</th><th>DFL share</th><th>R share</th><th>DFL margin</th></tr></thead><tbody>`;
    rows.forEach(r => { t += `<tr><td>${r.year}</td><td style="text-align:left">${esc(r.office)}</td><td>${fInt(r.dfl)}</td><td>${fInt(r.r)}</td><td>${fPct(r.dflPct)}</td><td>${fPct(r.rPct)}</td><td>${fMarg(r.margin)} pts</td></tr>`; });
    return `<div class="wh-tw"><table class="wh-t"><caption>Plymouth citywide, President or Governor. City offices are nonpartisan; this describes the same voters at the top of the ballot.</caption>${t}</tbody></table></div>`;
  }

  /* ---------- redistricting ---------- */
  function crossSection() {
    const split = D.crosswalk.filter(c => c["Split?"] === "Split");
    let t = `<thead><tr><th>Geometry</th><th>Old precinct</th><th>Old ward</th><th>To current Ward 1</th><th>Ward 2</th><th>Ward 3</th><th>Ward 4</th></tr></thead><tbody>`;
    split.forEach(c => { t += `<tr><td>${c["Geometry year"]}</td><td style="text-align:left">${esc(c["Old precinct"])} (${c["Old precinct code"]})</td><td style="text-align:left">${esc(c["Old ward"])}</td>${[1, 2, 3, 4].map(k => `<td>${c["Current Ward " + k] ? fPct(c["Current Ward " + k]) : "\u2013"}</td>`).join("")}</tr>`; });
    return `<div class="wh-tw"><table class="wh-t"><caption>The split old precincts: share of each precinct's votes allocated to each current ward. The full crosswalk is in the workbook.</caption>${t}</tbody></table></div>`;
  }

  function readmeBlock(startLabel, endLabel) {
    const a = D.readme.indexOf(startLabel), b = endLabel ? D.readme.indexOf(endLabel) : D.readme.length;
    return D.readme.slice(a + 1, b);
  }

  /* ---------- page ---------- */
  function render() {
    const city = y => tc(y, "Citywide");
    const et = D.electionType.rows.find(r => r[0] === "Citywide");
    const eh = D.electionType.header;
    const mid = et[eh.indexOf("Avg ballots, mayor/midterm years")], pres = et[eh.indexOf("Avg ballots, council-only/presidential years")];
    const ratio = et[eh.indexOf("Presidential vs. midterm ballots")];
    const tMid = et[eh.indexOf("Avg turnout, midterm")], tPres = et[eh.indexOf("Avg turnout, presidential")];
    const clark = raceDrawn("CM At Large", 2022).cands.find(c => c.name === "Clark Gregor");
    const nClark = raceDrawn("CM At Large", 2022).cands.filter(c => c.name !== "Write-in").length;
    const md22 = city(2022)["Mayor drop-off"], md18 = city(2018)["Mayor drop-off"];
    const b22 = city(2022)["Ballots cast"], b24 = city(2024)["Ballots cast"];
    const defs = readmeBlock("Definitions", "Election calendar in this period");
    const cal = readmeBlock("Election calendar in this period", "Redistricting and reconciliation");
    const red = readmeBlock("Redistricting and reconciliation", "Sources");
    const src = readmeBlock("Sources", null);
    const methodText = D.readme[1];
    root.innerHTML = `<div class="wh-wrap">
      <p class="wh-kicker">Ward history \u00b7 Plymouth, Minnesota \u00b7 2014\u20132024</p>
      <h1 class="wh-title">Plymouth\u2019s mayor is chosen by the smaller electorate</h1>
      <p class="wh-dek">In the three mayor years (2014, 2018, 2022) Plymouth averaged ${fInt(mid)} ballots. In the three presidential years it averaged ${fInt(pres)}, ${fSgnPct(ratio)} more. Average turnout was ${fPct(tMid)} in mayor years and ${fPct(tPres)} in presidential years. This tab breaks six city elections down by ward.</p>
      <p class="wh-byline">${esc(methodText)} Source: Minnesota Secretary of State precinct results and state GIS precinct maps.</p>
      <div class="wh-facts">
        <div class="wh-fact"><div class="n">${fInt(b22)}</div><div class="l">ballots cast citywide in 2022, the last mayor election. In 2024 it was ${fInt(b24)}, ${fSgnPct(b24 / b22 - 1)}.</div></div>
        <div class="wh-fact"><div class="n">${fPct(md22)}</div><div class="l">of 2022 voters skipped the mayor race, which was unopposed (2018, contested: ${fPct(md18)}).</div></div>
        <div class="wh-fact"><div class="n">${fPct(tPres)}</div><div class="l">average turnout in presidential years, against ${fPct(tMid)} in mayor years: a ${(et[eh.indexOf("Turnout gap (pts)")] * 100).toFixed(1)}-point gap.</div></div>
        <div class="wh-fact"><div class="n">${fPct(clark.v[9])}</div><div class="l">Clark Gregor\u2019s share of the 2022 at-large vote: ${fInt(clark.v[4])} votes, first of ${nClark} candidates.</div></div>
      </div>

      <section class="wh-sec" id="wh-trends"><h2>Four wards, six elections</h2>
        <p class="wh-sub">Every election rebuilt on the 2022 ward lines so the wards can be compared across time. Pick a measure; the table under the chart holds the exact figures. Dashed lines and shaded columns are estimates.</p>
        <div id="wh-metric">${metricSection()}</div></section>

      <section class="wh-sec"><h2>Mayor years against presidential years</h2>
        <p class="wh-sub">Ward averages by election type, on current ward lines.</p>${typeSection()}</section>

      <section class="wh-sec"><h2>Race results by ward</h2>
        <p class="wh-sub">Every mayor and at-large council race from 2014 to 2024, ward by ward.</p>
        <div id="wh-race">${raceSection()}</div></section>

      <section class="wh-sec"><h2>Ward council seats</h2>
        <p class="wh-sub">Each ward seat is on the ballot every four years; Wards 2 and 4 in midterm years, Wards 1 and 3 in presidential years.</p>${seatSection()}</section>

      <section class="wh-sec"><h2>The top of the ticket</h2>
        <p class="wh-sub">City races are nonpartisan. The President and Governor results show how the same electorate leaned.</p>${topTicket()}</section>

      <section class="wh-sec"><h2>Redistricting and estimates</h2>
        <div class="wh-defs"><div>${red.map(p => `<p>${esc(p)}</p>`).join("")}</div><div>${crossSection()}</div></div></section>

      <section class="wh-sec"><h2>Definitions and sources</h2>
        <div class="wh-defs"><div><h3 style="margin-top:0">Definitions</h3>${defs.map(p => `<p>${esc(p)}</p>`).join("")}</div>
        <div><h3 style="margin-top:0">Election calendar</h3>${cal.map(p => `<p>${esc(p)}</p>`).join("")}<h3>Sources</h3>
        <ul class="wh-src">${src.map(p => `<li>${esc(p)}</li>`).join("")}</ul>
        <p class="wh-note">Every figure on this tab is read from a data file exported directly from the workbook; the workbook's full sheet list is described in its Read Me.</p></div></div>
        <p class="wh-note">Suggested citation: Plymouth, MN Municipal Elections by Ward, 2014 to 2024 (prepared October 2026), from Minnesota Secretary of State results and state GIS precinct maps.</p></section>
    </div>`;
    bind();
  }

  function bind() {
    root.querySelectorAll("[data-metric]").forEach(b => b.addEventListener("click", () => { ui.metric = b.dataset.metric; document.getElementById("wh-metric").innerHTML = metricSection(); bind(); }));
    root.querySelectorAll("[data-rkind]").forEach(b => b.addEventListener("click", () => { ui.raceKind = b.dataset.rkind; redrawRace(); }));
    root.querySelectorAll("[data-lines]").forEach(b => b.addEventListener("click", () => { if (b.disabled) return; ui.lines = b.dataset.lines; redrawRace(); }));
    const ys = document.getElementById("wh-year"); if (ys) ys.addEventListener("change", () => { ui.raceYear = Number(ys.value); redrawRace(); });
  }
  let rz = null;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => { const el = document.getElementById("wh-metric"); if (el && D) { el.innerHTML = metricSection(); bind(); } }, 150); });
  document.addEventListener("tabshow", e => { if (e.detail.tab === "wards" && D) { const el = document.getElementById("wh-metric"); if (el) { el.innerHTML = metricSection(); bind(); } } });
  function redrawRace() { document.getElementById("wh-race").innerHTML = raceSection(); bind(); }
})();
