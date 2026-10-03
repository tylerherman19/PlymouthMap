/* War room site shell: switches between the Path to Win, Map, and Record tabs. */
"use strict";

(function () {
  const tabs = Array.from(document.querySelectorAll(".site-tab"));
  const panels = Array.from(document.querySelectorAll(".tab-panel"));
  const valid = tabs.map(t => t.dataset.tab);

  let current = null;
  function activate(name) {
    if (!valid.includes(name) || name === current) return;
    current = name;
    tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === name));
    panels.forEach(p => p.classList.toggle("active", p.dataset.tabPanel === name));
    document.dispatchEvent(new CustomEvent("tabshow", { detail: { tab: name } }));
    try { history.replaceState(null, "", "#" + name); } catch (e) { /* ignore */ }
  }

  tabs.forEach(t => t.addEventListener("click", () => activate(t.dataset.tab)));
  window.showTab = activate;

  // Follow the URL hash so links like #wards and the back button work.
  window.addEventListener("hashchange", () => activate((location.hash || "").replace("#", "")));

  const initial = (location.hash || "").replace("#", "");
  activate(valid.includes(initial) ? initial : "warroom");
})();
