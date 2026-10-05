/* black.js — Black replenishment tab: lean track, size-level OH/velocity/cover/reorder.
 * Velocity uses the SAME months last year (seasonal arc). Zero stock + zero measured
 * sales = "Unknown — was stocked out", never "covered". */
const Black = (() => {
  function yoyVelocity(entry, monthsBack) {
    const now = new Date(2026, 9, 5); // inventory snapshot date
    let units = 0, wks = 0;
    for (let i = 0; i < monthsBack; i++) {
      const d = new Date(now.getFullYear() - 1, now.getMonth() + i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      units += entry.hist[ym] || 0;
      wks += 4.33;
    }
    return wks ? units / wks : 0;
  }

  /* 6-store model: only Wooster/Madison/Marin/Montecito/LA/SF count as stock.
   * Studio (negative units) and Brentwood are excluded; totals recomputed. */
  const SIX = ["Wooster", "Madison", "Marin", "Montecito", "Los Angeles", "San Francisco"];
  function sixStores(e) {
    const out = {};
    Object.entries(e.stores || {}).forEach(([s, q]) => {
      if (SIX.includes(s)) out[s] = q;
    });
    return out;
  }

  function computeRows() {
    const horizonMo = Store.get("blk_horizon_mo", 3);
    const targetCoverWks = Store.get("blk_target_cover_wks", 8);
    const reorderPtWks = Store.get("blk_reorder_pt_wks", 4);
    return DATA.black.map(e0 => {
      const stores = sixStores(e0);
      const total = Object.values(stores).reduce((a, b) => a + (+b || 0), 0);
      const e = { ...e0, stores, total };
      const vel = yoyVelocity(e, horizonMo);
      const cover = vel > 0 ? e.total / vel : (e.total > 0 ? Infinity : 0);
      let status, rec = 0;
      if (e.total === 0 && vel === 0) { status = "unknown_stockout"; }
      else if (cover <= reorderPtWks) { status = "reorder"; rec = Math.max(0, Math.ceil(targetCoverWks * vel - e.total)); }
      else if (cover <= targetCoverWks) { status = "watch"; }
      else { status = "ok"; }
      return { ...e, vel, cover, status, rec, horizonMo, targetCoverWks, reorderPtWks };
    });
  }

  function statusPill(r) {
    if (r.status === "reorder") return `<span class="pill bad">reorder ${r.rec}</span>`;
    if (r.status === "watch") return `<span class="pill warn">watch</span>`;
    if (r.status === "unknown_stockout") return `<span class="pill info">Unknown — was stocked out</span>`;
    return `<span class="pill ok">ok</span>`;
  }

  function render() {
    const root = $("#tab-black");
    const rows = computeRows();
    const horizonMo = rows.length ? rows[0].horizonMo : 3;
    const needReorder = rows.filter(r => r.status === "reorder");
    const unknown = rows.filter(r => r.status === "unknown_stockout");
    const totalOH = rows.reduce((s, r) => s + r.total, 0);
    const totalRec = needReorder.reduce((s, r) => s + r.rec, 0);

    root.innerHTML = `
    <div class="pagehead"><div>
      <h1>Black replenishment</h1>
      <p class="sub">Perennial black, kept lean. Velocity uses the same months last year — never peak-summer pace for fall.</p>
    </div></div>
    <div class="statrow">
      <div class="statcard" style="--tc:var(--slate)"><div class="mlabel">Black OH (stores)</div>
        <div class="statnum">${fmt(totalOH)}</div><div class="statdesc">across ${fmt(rows.length)} style-sizes</div></div>
      <div class="statcard" style="--tc:var(--orange)"><div class="mlabel">Sizes needing reorder</div>
        <div class="statnum">${needReorder.length}</div><div class="statdesc">${fmt(totalRec)} units suggested</div></div>
      <div class="statcard" style="--tc:var(--teal)"><div class="mlabel">Unknown — stocked out</div>
        <div class="statnum">${unknown.length}</div><div class="statdesc">zero stock, zero measured sales</div></div>
      <div class="statcard" style="--tc:var(--orange)"><div class="mlabel">Velocity basis</div>
        <div class="statnum" style="font-size:26px">YoY ${horizonMo}mo</div><div class="statdesc">same months last year</div></div>
    </div>
    <div class="card"><h2>Reorder controls</h2>
      <p class="lede">Tune the horizon and cover targets; the list below recalculates immediately.</p>
      <div class="toolbar">
        <label class="f">Planning horizon (mo)<input type="number" id="blk-h" value="${Store.get("blk_horizon_mo", 3)}" min="1" max="12"></label>
        <label class="f">Reorder point (wks cover)<input type="number" id="blk-rp" value="${Store.get("blk_reorder_pt_wks", 4)}" min="1" max="26"></label>
        <label class="f">Target cover (wks)<input type="number" id="blk-tc" value="${Store.get("blk_target_cover_wks", 8)}" min="1" max="52"></label>
      </div></div>
    <div class="card"><h2>Reorder list <span class="muted small">(${needReorder.length})</span></h2>
      ${needReorder.length ? `<table><tr><th>Style</th><th>Size</th><th class="num">OH</th><th class="num">Vel/wk (YoY)</th><th class="num">Cover</th><th class="num">Reorder</th><th>Stores</th></tr>
      ${needReorder.sort((a, b) => a.cover - b.cover).map(r => `<tr>
        <td>${esc(r.style)}</td><td>${esc(r.size)}</td><td class="num">${r.total}</td>
        <td class="num">${r.vel.toFixed(2)}</td><td class="num">${isFinite(r.cover) ? r.cover.toFixed(1) + " wks" : "—"}</td>
        <td class="num"><b>${r.rec}</b> ${unitField("blkrec_" + r.key.replace(/\W+/g, "_"), r.rec, 'style="width:76px;text-align:right"')}</td>
        <td class="small muted">${Object.entries(r.stores).map(([s, q]) => `${esc(s)}:${q}`).join(" ")}</td></tr>`).join("")}</table>`
      : `<p class="empty">Nothing at or below reorder point. Lean and clean.</p>`}
    </div>
    <div class="card"><h2>All black sizes <span class="muted small">(${rows.length})</span></h2>
      <p><input type="text" id="blk-q" placeholder="Find a style or size" style="max-width:260px"></p>
      <div class="tablescroll"><table id="blk-table">
      <tr><th>Style</th><th>Size</th><th class="num">OH</th><th class="num">Vel/wk</th><th class="num">Cover</th><th>Status</th></tr>
      ${rows.map(r => `<tr data-s="${esc((r.style + " " + r.size).toLowerCase())}">
        <td>${esc(r.style)}</td><td>${esc(r.size)}</td><td class="num">${r.total}</td>
        <td class="num">${r.vel.toFixed(2)}</td>
        <td class="num">${r.status === "unknown_stockout" ? "—" : isFinite(r.cover) ? r.cover.toFixed(1) + " wks" : "∞"}</td>
        <td>${statusPill(r)}</td></tr>`).join("")}
      </table></div></div>`;

    $("#blk-h").addEventListener("change", e => { Store.set("blk_horizon_mo", +e.target.value); refreshDerived(); });
    $("#blk-rp").addEventListener("change", e => { Store.set("blk_reorder_pt_wks", +e.target.value); refreshDerived(); });
    $("#blk-tc").addEventListener("change", e => { Store.set("blk_target_cover_wks", +e.target.value); refreshDerived(); });
    $("#blk-q").addEventListener("input", e => {
      const q = e.target.value.toLowerCase();
      $$("#blk-table tr[data-s]").forEach(tr => { tr.style.display = tr.dataset.s.includes(q) ? "" : "none"; });
    });
    bindOverrides(root);
  }

  return { render, computeRows };
})();
