/* fixnow.js — Tab 3: Fix inventory now (velocity w/ cover, sell-outs, broken affinity, transfers, hidden winners) */
const FixNow = (() => {
  function statusPill(a) {
    if (a.status === "stockout_demand") return `<span class="pill bad">stocked out — demand exists</span>`;
    if (a.status === "unknown_stockout") return `<span class="pill info">Unknown — was stocked out</span>`;
    if (a.status === "low_cover") return `<span class="pill warn">low cover</span>`;
    return `<span class="pill ok">ok</span>`;
  }

  function render() {
    const root = $("#tab-fix");
    const alerts = DATA.alerts;
    const hot = alerts.filter(a => a.status === "low_cover")
      .sort((a, b) => (a.cover_wk || 99) - (b.cover_wk || 99)).slice(0, 30);
    const sellouts = alerts.filter(a => a.status === "stockout_demand").slice(0, 30);
    const hidden = alerts.filter(a => a.status === "unknown_stockout").slice(0, 30);

    root.innerHTML = `
    <div class="card"><h2>High velocity <span class="muted small">with on-hand &amp; cover next to it</span></h2>
      <p class="muted small">Velocity = same period last year (seasonal). Cover decides urgency: high velocity + 3 left = act now; + 50 left = wait.</p>
      ${hot.length ? `<table><tr><th>Style</th><th>Color</th><th>Size</th><th>Vel/wk</th><th>OH (stores)</th><th>Cover</th><th>Status</th></tr>
      ${hot.map(a => `<tr><td>${esc(a.style)}</td><td>${esc(a.color)}</td><td>${esc(a.size)}</td>
        <td>${a.vel_wk}</td><td><b>${a.oh}</b></td>
        <td>${a.cover_wk != null ? a.cover_wk + " wks" : "—"}</td><td>${statusPill(a)}</td></tr>`).join("")}</table>`
      : `<p class="muted">No low-cover items right now.</p>`}
    </div>

    <div class="card"><h2>Projected sell-outs <span class="muted small">(${sellouts.length})</span></h2>
      <p class="muted small">Zero on-hand with measurable demand. Sample-sale colors excluded.</p>
      ${sellouts.length ? `<table><tr><th>Style</th><th>Color</th><th>Size</th><th>Vel/wk</th><th>Status</th></tr>
      ${sellouts.map(a => `<tr><td>${esc(a.style)}</td><td>${esc(a.color)}</td><td>${esc(a.size)}</td>
        <td>${a.vel_wk}</td><td>${statusPill(a)}</td></tr>`).join("")}</table>`
      : `<p class="muted">None.</p>`}
    </div>

    <div class="card"><h2>Broken affinity — transfer suggestions <span class="muted small">(${DATA.transfers.length})</span></h2>
      <p class="muted small">Stores holding one side of a proven pair but none of the other. Sample-sale colors excluded.</p>
      ${DATA.transfers.length ? DATA.transfers.map(t => `
        <div class="alert-row"><div><b>${esc(t.pair)}</b> <span class="muted small">(${t.n} baskets)</span><br>
        <span class="small">${esc(t.suggestion)}</span></div></div>`).join("")
      : `<p class="muted">No imbalances found.</p>`}
    </div>

    <div class="card"><h2>Hidden winners / censored demand <span class="muted small">(${hidden.length})</span></h2>
      <p class="muted small">Zero stock <i>and</i> zero measured sales — demand is unknown, not zero. Use the style's history from when it was in stock before deciding; treat as <b>review</b>, never "covered".</p>
      ${hidden.length ? `<table><tr><th>Style</th><th>Color</th><th>Size</th><th>Status</th></tr>
      ${hidden.map(a => `<tr><td>${esc(a.style)}</td><td>${esc(a.color)}</td><td>${esc(a.size)}</td><td>${statusPill(a)}</td></tr>`).join("")}</table>`
      : `<p class="muted">None.</p>`}
    </div>`;
  }
  return { render };
})();
