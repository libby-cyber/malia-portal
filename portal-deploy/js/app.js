/* app.js — boot, tab routing */
function refreshDerived() {
  // called after any override/assumption change: re-render active tab
  const active = document.querySelector("#tabs button.active");
  if (active) showTab(active.dataset.tab, true);
}

function showTab(name, force) {
  $$("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  $$(".tabpane").forEach(p => p.classList.toggle("active", p.id === "tab-" + name));
  ({ plan: Plan.render, black: Black.render, fix: FixNow.render, calendar: CalView.render })[name]();
}

async function boot() {
  try {
    await loadData();
  } catch (e) {
    document.querySelector("main").innerHTML =
      `<div class="card"><h2>Couldn't load data</h2><p>${esc(e.message)}</p>
       <p class="muted small">Serve this folder over http (e.g. <code>npx vercel dev</code>) — browsers block fetch() on file://.</p></div>`;
    return;
  }
  $("#data-note").textContent =
    `Swim demand anchored to ${DATA.demand.annual.toLocaleString()} units sold in 2026 · ` +
    `${DATA.colors.length} colors · ${DATA.meta.stores.length} stores`;
  $$("#tabs button").forEach(b => b.addEventListener("click", () => showTab(b.dataset.tab)));
  showTab("plan");
}

document.addEventListener("DOMContentLoaded", boot);
