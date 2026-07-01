/* War room site shell: switches between the Path to Win, Map, and Record tabs. */
"use strict";

(function () {
  const tabs = Array.from(document.querySelectorAll(".site-tab"));
  const panels = Array.from(document.querySelectorAll(".tab-panel"));
  const valid = tabs.map(t => t.dataset.tab);

  function activate(name) {
    if (!valid.includes(name)) return;
    tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === name));
    panels.forEach(p => p.classList.toggle("active", p.dataset.tabPanel === name));
    document.dispatchEvent(new CustomEvent("tabshow", { detail: { tab: name } }));
    try { history.replaceState(null, "", "#" + name); } catch (e) { /* ignore */ }
  }

  tabs.forEach(t => t.addEventListener("click", () => activate(t.dataset.tab)));
  window.showTab = activate;

  const initial = (location.hash || "").replace("#", "");
  activate(valid.includes(initial) ? initial : "warroom");
})();
