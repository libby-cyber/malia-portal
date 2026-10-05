/* fixnow.js — inventory alerts from baked data.
 * Two framings over the same data:
 *   "signals" — seasonal demand read (Pace & stock signals sub-tab)
 *   "actions" — action-oriented (Fix inventory now top-level tab)                    */
const FixNow = (() => {
  function sections() {
    const alerts = DATA.alerts;
    return {
      hot: alerts.filter(a => a.status === "low_cover")
        .sort((a, b) => (a.cover_wk || 99) - (b.cover_wk || 99)).slice(0, 30),
      sellouts: alerts.filter(a => a.status === "stockout_demand").slice(0, 30),
      hidden: alerts.filter(a => a.status === "unknown_stockout").slice(0, 30),
      transfers: DATA.transfers
    };
  }

  function statusPill(a) {
    if (a.status === "stockout_demand") return `<span class="pill bad">stocked out — demand exists</span>`;
    if (a.status === "unknown_stockout") return `<span class="pill info">Unknown — was stocked out</span>`;
    if (a.status === "low_cover") return `<span class="pill warn">low cover</span>`;
    return `<span class="pill ok">ok</span>`;
  }

  function velTable(list, actionCol) {
    if (!list.length) return `<p class="empty">None right now.</p>`;
    return `<table><tr><th>Style</th><th>Color</th><th>Size</th><th class="num">Vel/wk</th><th class="num">OH (stores)</th><th class="num">Cover</th><th>Status</th>${actionCol ? "<th>Suggested action</th>" : ""}</tr>
      ${list.map(a => `<tr><td>${esc(a.style)}</td><td>${esc(a.color)}</td><td>${esc(a.size)}</td>
        <td class="num">${a.vel_wk}</td><td class="num"><b>${a.oh}</b></td>
        <td class="num">${a.cover_wk != null ? a.cover_wk + " wks" : "—"}</td><td>${statusPill(a)}</td>
        ${actionCol ? `<td class="small">${actionCol(a)}</td>` : ""}</tr>`).join("")}</table>`;
  }

  function renderSections(root, mode) {
    const s = sections();
    const act = mode === "actions";

    const hotTitle = act ? "Reorder now" : "High velocity";
    const hotLede = act
      ? "Low cover with measurable demand — these need hands today. High velocity + 3 left = act now; + 50 left = wait."
      : "Velocity with on-hand and cover next to it. Cover decides urgency: high velocity + 3 left = act now; + 50 left = wait.";
    const hotAction = act ? (a => (a.cover_wk || 99) <= 2 ? "Reorder / expedite now" : "Reorder to target cover") : null;
    const hotCard = `
    <div class="card"><h2>${hotTitle} <span class="muted small">(${s.hot.length})</span></h2>
      <p class="lede">${hotLede}</p>
      ${velTable(s.hot, hotAction)}
    </div>`;

    const sellCard = `
    <div class="card"><h2>${act ? "Stocked out — demand exists" : "Projected sell-outs"} <span class="muted small">(${s.sellouts.length})</span></h2>
      <p class="lede">${act ? "Zero on-hand with measurable demand. Transfer in or reorder; sample-sale colors excluded."
        : "Zero on-hand with measurable demand. Sample-sale colors excluded."}</p>
      ${s.sellouts.length ? `<table><tr><th>Style</th><th>Color</th><th>Size</th><th class="num">Vel/wk</th><th>Status</th>${act ? "<th>Suggested action</th>" : ""}</tr>
      ${s.sellouts.map(a => `<tr><td>${esc(a.style)}</td><td>${esc(a.color)}</td><td>${esc(a.size)}</td>
        <td class="num">${a.vel_wk}</td><td>${statusPill(a)}</td>
        ${act ? `<td class="small">Transfer in or reorder</td>` : ""}</tr>`).join("")}</table>`
      : `<p class="empty">None.</p>`}
    </div>`;

    const transCard = `
    <div class="card"><h2>${act ? "Urgent transfers" : "Broken affinity — transfer suggestions"} <span class="muted small">(${s.transfers.length})</span></h2>
      <p class="lede">Basket affinity at work: these pairs sell together in the same receipt. A store holding one side without the other is leaving complete sets on the table — move units to fix it.</p>
      ${s.transfers.length ? s.transfers.map(t => `
        <div class="alert-row"><div><b>${esc(t.pair)}</b> <span class="muted small">(${t.n} baskets)</span><br>
        <span class="small">${esc(t.suggestion)}</span></div></div>`).join("")
      : `<p class="empty">No imbalances found.</p>`}
    </div>`;

    const hidCard = `
    <div class="card"><h2>Hidden winners / censored demand <span class="muted small">(${s.hidden.length})</span></h2>
      <p class="lede">Zero stock <i>and</i> zero measured sales — demand is unknown, not zero. Review the style's history from when it was in stock before deciding; treat as <b>review</b>, never "covered".</p>
      ${s.hidden.length ? `<table><tr><th>Style</th><th>Color</th><th>Size</th><th>Status</th></tr>
      ${s.hidden.map(a => `<tr><td>${esc(a.style)}</td><td>${esc(a.color)}</td><td>${esc(a.size)}</td><td>${statusPill(a)}</td></tr>`).join("")}</table>`
      : `<p class="empty">None.</p>`}
    </div>`;

    const el = document.createElement("div");
    // signals view leads with affinity: stat strip + broken pairs first
    let statStrip = "";
    if (!act) {
      statStrip = `<div class="statrow">
        <div class="statcard" style="--tc:var(--teal)"><div class="mlabel">Affinity pairs tracked</div>
          <div class="statnum">${fmt(DATA.affinity.pairs.length)}</div><div class="statdesc">same-receipt baskets</div></div>
        <div class="statcard" style="--tc:var(--orange)"><div class="mlabel">Broken pairs</div>
          <div class="statnum">${s.transfers.length}</div><div class="statdesc">transfer to complete the set</div></div>
        <div class="statcard" style="--tc:var(--slate)"><div class="mlabel">High velocity</div>
          <div class="statnum">${s.hot.length}</div><div class="statdesc">low cover, measurable demand</div></div>
        <div class="statcard" style="--tc:var(--orange)"><div class="mlabel">Projected sell-outs</div>
          <div class="statnum">${s.sellouts.length}</div><div class="statdesc">zero OH, demand exists</div></div>
      </div>`;
    }
    el.innerHTML = statStrip + (act ? hotCard + sellCard + transCard + hidCard
                                    : transCard + hotCard + sellCard + hidCard);
    root.appendChild(el);
  }

  function render() {
    const root = $("#tab-fix");
    const s = sections();
    root.innerHTML = `
    <div class="pagehead"><div>
      <h1>Fix inventory now</h1>
      <p class="sub">What needs hands today — reorders, transfers, and stockouts with demand behind them.</p>
    </div></div>
    <div class="statrow">
      <div class="statcard" style="--tc:var(--orange)"><div class="mlabel">Reorder now</div>
        <div class="statnum">${s.hot.length}</div><div class="statdesc">low cover, measurable demand</div></div>
      <div class="statcard" style="--tc:var(--slate)"><div class="mlabel">Stocked out — demand</div>
        <div class="statnum">${s.sellouts.length}</div><div class="statdesc">zero OH, demand exists</div></div>
      <div class="statcard" style="--tc:var(--teal)"><div class="mlabel">Urgent transfers</div>
        <div class="statnum">${s.transfers.length}</div><div class="statdesc">broken affinity pairs</div></div>
      <div class="statcard" style="--tc:var(--orange)"><div class="mlabel">Unknown demand</div>
        <div class="statnum">${s.hidden.length}</div><div class="statdesc">review, never "covered"</div></div>
    </div>
    <div id="fix-sections"></div>`;
    renderSections($("#fix-sections", root), "actions");
  }

  return { render, renderSections };
})();
