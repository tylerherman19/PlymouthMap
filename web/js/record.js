/* Clark's Record — maps his tangible impact within the district. */
"use strict";

const REC_CATEGORIES = {
  housing:         { label: "Housing",        color: "#1e3a8a" },
  infrastructure:  { label: "Infrastructure", color: "#b45309" },
  parks:           { label: "Parks",          color: "#166534" },
  environment:     { label: "Environment",    color: "#0f766e" },
  development:     { label: "Development",    color: "#7c3aed" },
  "public-safety": { label: "Public safety",  color: "#b91c1c" },
};
const REC_STATUS_LABEL = { delivered: "Delivered", "in-progress": "In progress", proposed: "Proposed" };

let recImpact = null;
let recMap = null;
let recMarkersLayer = null;
let recWardBounds = null;
let recNeedsRefit = false;
let recActiveCategory = "all";
let recShellBuilt = false;

fetch("data/impact.json").then(r => r.json()).then(d => { recImpact = d; tryRenderRecord(); });

document.addEventListener("appdata", tryRenderRecord);
document.addEventListener("tabshow", e => {
  if (e.detail.tab !== "record") return;
  tryRenderRecord();
  if (recMap) {
    recMap.invalidateSize();
    if (recNeedsRefit && recWardBounds) {
      recMap.fitBounds(recWardBounds.pad(0.05));
      recNeedsRefit = false;
    }
  }
});

function tryRenderRecord() {
  if (!recImpact || !state.dataReady) return;
  renderRecord();
}

function renderRecord() {
  const el = document.getElementById("record-content");
  if (!el) return;
  if (recShellBuilt) { renderRecordList(); return; }
  recShellBuilt = true;

  const bio = recImpact.bio;
  const filterBtns = Object.entries(REC_CATEGORIES).map(([id, c]) => {
    const n = recImpact.items.filter(i => i.category === id).length;
    return n ? `<button class="rec-filter-btn" data-cat="${esc(id)}">${esc(c.label)} (${n})</button>` : "";
  }).join("");
  const legend = Object.values(REC_CATEGORIES).map(c =>
    `<span><span class="swatch" style="background:${c.color}"></span>${esc(c.label)}</span>`).join("");

  el.innerHTML = `
    <div class="rec-wrap">
      <div class="rec-hero">
        <h2>Clark's record in Plymouth</h2>
        <p>Every item below is a real, sourced action from city council coverage and Clark's own campaign
          site — a vote, a finished project, or a named in-progress initiative. Nothing is invented; anything
          not yet built or funded is labeled "Proposed."</p>
      </div>

      <div class="rec-bio-grid">
        <div class="rec-bio-card"><h4>Role</h4><p>${esc(bio.role)}</p></div>
        <div class="rec-bio-card"><h4>Prior service</h4><p>${esc(bio.priorService)}</p></div>
        <div class="rec-bio-card"><h4>Background</h4><p>${esc(bio.background)}</p></div>
        <div class="rec-bio-card"><h4>Committees</h4><p>${esc(bio.committees)}</p></div>
      </div>

      <div class="rec-layout">
        <div>
          <div id="record-map"></div>
          <div class="rec-map-legend">${legend}</div>
          <p class="fineprint" style="margin-top:10px">Pins mark the street or intersection named in the
            source; anything short of a full address is approximate. Items without a specific location
            (citywide policy, resolutions) aren't pinned — see the list.</p>
        </div>
        <div>
          <div class="rec-filters" id="rec-filters">
            <button class="rec-filter-btn active" data-cat="all">All (${recImpact.items.length})</button>
            ${filterBtns}
          </div>
          <div class="rec-list" id="rec-list"></div>
        </div>
      </div>
    </div>`;

  initRecordMap();

  document.getElementById("rec-filters").addEventListener("click", e => {
    const btn = e.target.closest(".rec-filter-btn");
    if (!btn) return;
    recActiveCategory = btn.dataset.cat;
    document.querySelectorAll(".rec-filter-btn").forEach(b => b.classList.toggle("active", b === btn));
    renderRecordList();
    refreshRecordMarkers();
  });

  renderRecordList();
}

function initRecordMap() {
  recMap = L.map("record-map", { zoomSnap: 0.25, scrollWheelZoom: false });
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 17,
  }).addTo(recMap);

  const wardsLayer = L.geoJSON(state.data.wards, {
    style: () => ({ color: "#94a3b8", weight: 1.5, fillColor: "#e2e8f0", fillOpacity: 0.35 }),
    onEachFeature: (f, lyr) => lyr.bindTooltip(f.properties.name, { sticky: true }),
  }).addTo(recMap);

  recWardBounds = wardsLayer.getBounds();
  recNeedsRefit = document.getElementById("record-map").offsetWidth === 0;
  recMap.fitBounds(recWardBounds.pad(0.05));

  recMarkersLayer = L.layerGroup().addTo(recMap);
  refreshRecordMarkers();
}

function refreshRecordMarkers() {
  if (!recMarkersLayer) return;
  recMarkersLayer.clearLayers();
  recImpact.items
    .filter(i => i.lat != null && (recActiveCategory === "all" || i.category === recActiveCategory))
    .forEach(i => {
      const color = REC_CATEGORIES[i.category]?.color ?? "#6b7280";
      const marker = L.circleMarker([i.lat, i.lng], {
        radius: 8, color: "#fff", weight: 2, fillColor: color, fillOpacity: 0.9,
      }).addTo(recMarkersLayer);
      marker._recId = i.id;
      marker.bindPopup(`<b>${esc(i.title)}</b><br>${esc(i.location ?? "")}<br>
        <a href="${esc(i.source)}" target="_blank" rel="noopener">Source →</a>`);
    });
}

function renderRecordList() {
  const listEl = document.getElementById("rec-list");
  if (!listEl) return;
  const items = recImpact.items
    .filter(i => recActiveCategory === "all" || i.category === recActiveCategory)
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  listEl.innerHTML = items.map(i => {
    const cat = REC_CATEGORIES[i.category] ?? { label: i.category, color: "#6b7280" };
    const locHtml = i.location
      ? `<div class="rec-card-loc">${esc(i.location)}${i.ward ? " · Ward " + esc(i.ward) : ""}</div>`
      : `<div class="rec-card-loc">Citywide</div>`;
    return `<div class="rec-card" data-id="${esc(i.id)}">
      <div class="rec-card-head">
        <div class="rec-card-title">${esc(i.title)}</div>
        <div class="rec-card-date">${esc(i.date)}</div>
      </div>
      ${locHtml}
      <p class="rec-card-summary">${esc(i.summary)}</p>
      <div class="rec-card-foot">
        <span class="rec-cat-badge" style="background:${cat.color}22;color:${cat.color}">${esc(cat.label)}</span>
        <span class="rec-status-badge ${esc(i.status)}">${esc(REC_STATUS_LABEL[i.status] ?? i.status)}</span>
        ${i.vote ? `<span class="rec-vote-badge">${esc(i.vote)}</span>` : ""}
        <a class="rec-card-source" href="${esc(i.source)}" target="_blank" rel="noopener">Source →</a>
      </div>
    </div>`;
  }).join("");

  listEl.querySelectorAll(".rec-card").forEach(card => {
    card.addEventListener("click", () => {
      const item = recImpact.items.find(i => i.id === card.dataset.id);
      if (item && item.lat != null && recMap) {
        recMap.invalidateSize();
        recMap.setView([item.lat, item.lng], 14, { animate: true });
        recMarkersLayer.eachLayer(m => { if (m._recId === item.id) m.openPopup(); });
      }
    });
  });
}
