/* app.js — boot + top-level tab routing (plan / black / fix).
 * Plan tab owns its sub-tabs (signals / tiers / calendar) via Store "ui_subtab". */
function refreshDerived() {
  renderCurrent();
}

function renderCurrent() {
  const tab = Store.get("ui_tab", "plan");
  $$("#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  $$(".tabpane").forEach(p => p.classList.toggle("active", p.id === "tab-" + tab));
  if (tab === "plan") Plan.render();
  else if (tab === "black") Black.render();
  else FixNow.render();
  window.scrollTo({ top: 0 });
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
    `${DATA.colors.length} colors · ${(typeof Plan !== "undefined" && Plan.ACTIVE_STOCK_STORES ? Plan.ACTIVE_STOCK_STORES.length : DATA.meta.stores.length)} stores`;
  const snap = $("#snapshot-note");
  if (snap) snap.textContent = DATA.meta.inventory_snapshot || "";
  $$("#tabs button").forEach(b => b.addEventListener("click", () => {
    Store.set("ui_tab", b.dataset.tab);
    renderCurrent();
  }));
  renderCurrent();
}

document.addEventListener("DOMContentLoaded", boot);
