/* data.js — loads baked-in JSON datasets and exposes them as DATA. */
const DATA = {
  meta: null, colors: [], inventory: [], demand: null,
  affinity: null, black: [], styleVelocity: {}, alerts: [], transfers: [],
  wip: null
};

async function loadData() {
  const files = {
    meta: "data/meta.json",
    colors: "data/colors.json",
    inventory: "data/inventory.json",
    demand: "data/demand.json",
    affinity: "data/affinity.json",
    black: "data/black.json",
    styleVelocity: "data/style_velocity.json",
    alerts: "data/alerts.json",
    transfers: "data/transfers.json"
  };
  const entries = await Promise.all(
    Object.entries(files).map(async ([k, url]) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error("failed to load " + url);
      return [k, await r.json()];
    })
  );
  entries.forEach(([k, v]) => { DATA[k] = v; });
  // WIP is optional: the linesheet-pull feature hides itself when it's absent.
  try {
    const r = await fetch("data/wip.json");
    if (r.ok) {
      const w = await r.json();
      DATA.wip = Array.isArray(w) ? { rows: w } : w;
      if (!Array.isArray(DATA.wip.rows)) DATA.wip = { rows: [] };
    }
  } catch (e) { /* leave DATA.wip null */ }
  return DATA;
}

/* ---------- shared helpers ---------- */
const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c =>
  ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = n => (n == null || !isFinite(n)) ? "—"
  : Number(n).toLocaleString("en-US", {maximumFractionDigits: 1});

function getAssumptions() {
  const d = DATA.meta.defaults;
  const a = {};
  for (const k of Object.keys(d)) a[k] = Store.get("asm_" + k, d[k]);
  return a;
}
function setAssumption(k, v) { Store.set("asm_" + k, v); }

/* user override for any computed unit field: stored value always wins */
function unitField(id, computed, attrs) {
  const stored = Store.get("ovr_" + id, null);
  const val = stored !== null && stored !== undefined && stored !== "" ? stored : Math.round(computed);
  const cls = (stored !== null && stored !== undefined && stored !== "") ? "override" : "";
  return `<input type="number" data-override="${esc(id)}" value="${val}" class="${cls}" ${attrs || ""}>`;
}
function bindOverrides(root) {
  $$("input[data-override]", root).forEach(inp => {
    inp.addEventListener("change", () => {
      const raw = inp.value;
      if (raw === "" || raw === null) { Store.remove("ovr_" + inp.dataset.override); }
      else { Store.set("ovr_" + inp.dataset.override, Number(raw)); }
      inp.classList.add("override");
      // re-render derived numbers, unless we're inside the allocator draft
      // (which is ephemeral UI, not part of the tab render)
      if (typeof refreshDerived === "function" && !inp.closest("#ls-output")) refreshDerived();
    });
  });
}

/* monthly demand template: planning month "YYYY-MM" -> 2026 template index */
function templateDemand(yyyyMM) {
  const m = parseInt(yyyyMM.slice(5, 7), 10);
  return DATA.demand.monthly_2026[m - 1];
}
function monthsBetween(startYM, endYM) {
  // inclusive list of "YYYY-MM"
  const out = [];
  let [y, m] = startYM.split("-").map(Number);
  const [ey, em] = endYM.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}
function addDays(dateStr, days) {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function addWeeks(dateStr, wks) { return addDays(dateStr, Math.round(wks * 7)); }
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric"});
}
