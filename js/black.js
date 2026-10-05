/* black.js — Tab 2: Black replenishment (separate lean track, size-level) */
const Black = (() => {
  /* YoY velocity: same calendar months last year, per style|size */
  function yoyVelocity(entry, monthsBack) {
    // monthsBack: how many months of history to match, e.g. next 3 months -> same 3 months last year
    const now = new Date(2026, 9, 5); // snapshot date
    let units = 0, wks = 0;
    for (let i = 0; i < monthsBack; i++) {
      const d = new Date(now.getFullYear() - 1, now.getMonth() + i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      units += entry.hist[ym] || 0;
      wks += 4.33;
    }
    return wks ? units / wks : 0;
  }

  function render() {
    const root = $("#tab-black");
    const asm = getAssumptions();
    const horizonMo = Store.get("blk_horizon_mo", 3);
    const targetCoverWks = Store.get("blk_target_cover_wks", 8);
    const reorderPtWks = Store.get("blk_reorder_pt_wks", 4);

    const rows = DATA.black.map(e => {
      const vel = yoyVelocity(e, horizonMo);
      const cover = vel > 0 ? e.total / vel : (e.total > 0 ? Infinity : 0);
      let status, rec = 0;
      if (e.total === 0 && vel === 0) { status = "unknown_stockout"; }
      else if (cover <= reorderPtWks) { status = "reorder"; rec = Math.max(0, Math.ceil(targetCoverWks * vel - e.total)); }
      else if (cover <= targetCoverWks) { status = "watch"; }
      else { status = "ok"; }
      return { ...e, vel, cover, status, rec };
    });
    const needReorder = rows.filter(r => r.status === "reorder");
    const unknown = rows.filter(r => r.status === "unknown_stockout");

    root.innerHTML = `
    <div class="card"><h2>Black replenishment — lean track</h2>
      <p class="muted small">Black is perennial and re-orderable: keep it lean, never deep. Velocity uses the
      <b>same months last year</b> (seasonal arc), never peak-summer pace for fall. Zero stock + zero measured
      sales = <b>Unknown — was stocked out</b>, never "covered".</p>
      <div class="toolbar">
        <label class="f">Planning horizon (mo) <input type="number" id="blk-h" value="${horizonMo}" min="1" max="12"></label>
        <label class="f">Reorder point (wks cover) <input type="number" id="blk-rp" value="${reorderPtWks}" min="1" max="26"></label>
        <label class="f">Target cover (wks) <input type="number" id="blk-tc" value="${targetCoverWks}" min="1" max="52"></label>
      </div>
      <div class="grid c4">
        <div class="stat"><div class="label">Black OH (stores)</div><div class="value">${fmt(rows.reduce((s, r) => s + r.total, 0))}</div></div>
        <div class="stat"><div class="label">Sizes needing reorder</div><div class="value">${needReorder.length}</div>
          <div class="note">${fmt(needReorder.reduce((s, r) => s + r.rec, 0))} units suggested</div></div>
        <div class="stat"><div class="label">Unknown (stocked out)</div><div class="value">${unknown.length}</div>
          <div class="note">no measurable demand</div></div>
        <div class="stat"><div class="label">Velocity basis</div><div class="value" style="font-size:16px">YoY ${horizonMo}mo</div>
          <div class="note">same months last year</div></div>
      </div></div>
    <div class="card"><h2>Reorder list <span class="muted small">(${needReorder.length})</span></h2>
      ${needReorder.length ? `<table><tr><th>Style</th><th>Size</th><th>OH</th><th>Vel/wk (YoY)</th><th>Cover</th><th>Reorder</th><th>Stores</th></tr>
      ${needReorder.sort((a, b) => a.cover - b.cover).map(r => `<tr>
        <td>${esc(r.style)}</td><td>${esc(r.size)}</td><td>${r.total}</td>
        <td>${r.vel.toFixed(2)}</td><td>${isFinite(r.cover) ? r.cover.toFixed(1) + " wks" : "—"}</td>
        <td><b>${r.rec}</b> ${unitField("blkrec_" + r.key.replace(/\W+/g, "_"), r.rec)}</td>
        <td class="small muted">${Object.entries(r.stores).map(([s, q]) => `${esc(s)}:${q}`).join(" ")}</td></tr>`).join("")}</table>`
      : `<p class="muted">Nothing at or below reorder point. Lean and clean.</p>`}
    </div>
    <div class="card"><h2>All black sizes <span class="muted small">(${rows.length})</span></h2>
      <p><input type="text" id="blk-q" placeholder="Find a style or size" style="width:240px"></p>
      <div style="max-height:520px;overflow:auto"><table id="blk-table">
      <tr><th>Style</th><th>Size</th><th>OH</th><th>Vel/wk</th><th>Cover</th><th>Status</th></tr>
      ${rows.map(r => `<tr data-s="${esc(r.style + " " + r.size)}">
        <td>${esc(r.style)}</td><td>${esc(r.size)}</td><td>${r.total}</td>
        <td>${r.vel.toFixed(2)}</td>
        <td>${r.status === "unknown_stockout" ? "—" : isFinite(r.cover) ? r.cover.toFixed(1) + " wks" : "∞"}</td>
        <td>${r.status === "reorder" ? `<span class="pill bad">reorder ${r.rec}</span>`
          : r.status === "watch" ? `<span class="pill warn">watch</span>`
          : r.status === "unknown_stockout" ? `<span class="pill info">Unknown — was stocked out</span>`
          : `<span class="pill ok">ok</span>`}</td></tr>`).join("")}
      </table></div></div>`;

    $("#blk-h").addEventListener("change", e => { Store.set("blk_horizon_mo", Number(e.target.value)); render(); });
    $("#blk-rp").addEventListener("change", e => { Store.set("blk_reorder_pt_wks", Number(e.target.value)); render(); });
    $("#blk-tc").addEventListener("change", e => { Store.set("blk_target_cover_wks", Number(e.target.value)); render(); });
    $("#blk-q").addEventListener("input", e => {
      const q = e.target.value.toLowerCase();
      $$("#blk-table tr[data-s]").forEach(tr => {
        tr.style.display = tr.dataset.s.includes(q) ? "" : "none";
      });
    });
    bindOverrides(root);
  }
  return { render };
})();
