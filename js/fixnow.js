/* fixnow.js — inventory alerts from baked data.
 * Two framings over the same data:
 *   "signals" — seasonal demand read (Pace & stock signals sub-tab)
 *   "actions" — action-oriented (Fix inventory now top-level tab)                    */
const FixNow = (() => {
  function sections() {
    const alerts = DATA.alerts;
    const maxVel = a => Math.max(+a.vel_wk || 0, +a.recent_wk || 0);
    return {
      hot: alerts.filter(a => a.status === "low_cover")
        .sort((a, b) => (a.cover_wk || 99) - (b.cover_wk || 99)).slice(0, 30),
      sellouts: alerts.filter(a => a.status === "stockout_demand")
        .sort((a, b) => maxVel(b) - maxVel(a)).slice(0, 30),
      hidden: alerts.filter(a => a.status === "unknown_stockout").slice(0, 30),
      transfers: getTransfers()
    };
  }

  function statusPill(a) {
    if (a.status === "stockout_demand") return `<span class="pill bad">stocked out — demand exists</span>`;
    if (a.status === "unknown_stockout") return `<span class="pill info">Unknown — was stocked out</span>`;
    if (a.status === "low_cover") return `<span class="pill warn">low cover</span>`;
    return `<span class="pill ok">ok</span>`;
  }
  const fmt2 = n => (n == null || !isFinite(n)) ? "—" : Number(n).toFixed(2);

  /* ---------- broken-affinity transfers, recomputed live ----------
   * The baked 2-row precompute was far too narrow. For each active store and
   * each tops<->bottoms affinity pair (maillots are their own thing — no set
   * completion applies), a store holding one side but zero of the other is a
   * candidate, ranked per store by pair basket count. Each suggestion names
   * WHICH color to pull and from where, plus the have-side's top colors. */
  const TR_MIN_PAIR_N = 20;   // pair must appear in this many baskets
  const TR_MIN_AVAIL = 5;     // missing side needs this many units elsewhere
  const TR_PER_STORE = 10;    // cap suggestions per store
  function styleTypeOf(s) {
    if (typeof Plan !== "undefined" && Plan.styleTypeGuess) return Plan.styleTypeGuess(s);
    const x = String(s || "").toLowerCase(); // defensive fallback (plan.js loads first)
    if (["maillot", "one piece", "one-piece", "suit"].some(w => x.includes(w))) return "maillots";
    if (["cinch", "bambi", "brief", "bottom", "cheeky", "thong", "bikini bottom"].some(w => x.includes(w))) return "bottoms";
    return "tops";
  }
  function computeTransfers() {
    const norm = s => String(s == null ? "" : s).toLowerCase().trim();
    const exclColors = new Set([...(DATA.meta.pull_list_colors || []), ...(DATA.meta.dead_colors || [])].map(norm));
    // Authoritative 6-store model: Plan owns it; local fallback keeps this working standalone.
    const six = (typeof Plan !== "undefined" && Plan.ACTIVE_STOCK_STORES) ||
      ["Wooster", "Madison", "Marin", "Montecito", "Los Angeles", "San Francisco"];
    const stores = six.slice();
    const storeSet = new Set(six.map(norm));
    const byStyle = {};
    (DATA.inventory || []).forEach(r => {
      if (exclColors.has(norm(r.c))) return;
      const k = norm(r.s);
      (byStyle[k] = byStyle[k] || []).push(r);
    });
    const qtyAt = (styleKey, store) => {
      let q = 0;
      (byStyle[styleKey] || []).forEach(r => { q += +((r.st || {})[store] || 0); });
      return q;
    };
    const colorsAt = (styleKey, store) => {
      const m = {};
      (byStyle[styleKey] || []).forEach(r => {
        const q = +((r.st || {})[store] || 0);
        if (q > 0) m[r.c] = (m[r.c] || 0) + q;
      });
      return Object.entries(m).sort((a, b) => b[1] - a[1]);
    };
    const availElsewhere = (styleKey, store) => {
      const m = {};
      (byStyle[styleKey] || []).forEach(r => {
        Object.entries(r.st || {}).forEach(([st, q]) => {
          if (norm(st) === norm(store) || !storeSet.has(norm(st))) return;
          q = +q || 0;
          if (q <= 0) return;
          const e = m[r.c] = m[r.c] || { qty: 0, src: {} };
          e.qty += q;
          e.src[st] = (e.src[st] || 0) + q;
        });
      });
      return Object.entries(m)
        .map(([color, e]) => ({ color, qty: e.qty,
          sources: Object.entries(e.src).sort((a, b) => b[1] - a[1]) }))
        .sort((a, b) => b.qty - a.qty);
    };
    const out = [];
    (DATA.affinity.pairs || []).forEach(p => {
      if ((+p.n || 0) < TR_MIN_PAIR_N) return;
      const ta = styleTypeOf(p.a), tb = styleTypeOf(p.b);
      const setPair = (ta === "tops" && tb === "bottoms") || (ta === "bottoms" && tb === "tops");
      if (!setPair) return;
      const ka = norm(p.a), kb = norm(p.b);
      stores.forEach(store => {
        [[p.a, ka, p.b, kb], [p.b, kb, p.a, ka]].forEach(([haveS, haveK, missS, missK]) => {
          const haveQ = qtyAt(haveK, store);
          if (!(haveQ > 0)) return;
          if (qtyAt(missK, store) > 0) return;
          const avail = availElsewhere(missK, store);
          if (avail.reduce((s, a) => s + a.qty, 0) < TR_MIN_AVAIL) return;
          const haveColors = colorsAt(haveK, store).slice(0, 2).map(([c]) => c);
          const pullOpts = avail.slice(0, 3).map(a =>
            `${a.color} (${fmt(a.qty)}u via ${a.sources[0][0]})`).join(" or ");
          out.push({
            pair: `${p.a} + ${p.b}`, n: p.n, store,
            suggestion: `${store} has ${fmt(haveQ)}× ${haveS}` +
              (haveColors.length ? ` (mostly ${haveColors.join(", ")})` : "") +
              ` but no ${missS} — pull ${pullOpts} to complete the set.`
          });
        });
      });
    });
    // rank per store by pair strength, cap TR_PER_STORE
    const ranked = [];
    stores.forEach(store => {
      out.filter(t => t.store === store)
        .sort((a, b) => b.n - a.n)
        .slice(0, TR_PER_STORE)
        .forEach((t, i) => ranked.push({ ...t, rank: i + 1 }));
    });
    return ranked;
  }
  function getTransfers() {
    try {
      const c = computeTransfers();
      if (c && c.length) return c;
    } catch (e) { /* defensive fallback below */ }
    return DATA.transfers || [];
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
      <p class="hint">Demand = same period last year <i>or</i> recent weeks. Styles with YoY 0 but recent sales are newer colors with no year-ago history.</p>
      ${s.sellouts.length ? `<table><tr><th>Style</th><th>Color</th><th>Size</th><th class="num">Vel/wk (YoY)</th><th class="num">Vel/wk (recent)</th><th>Status</th>${act ? "<th>Suggested action</th>" : ""}</tr>
      ${s.sellouts.map(a => `<tr><td>${esc(a.style)}</td><td>${esc(a.color)}</td><td>${esc(a.size)}</td>
        <td class="num">${fmt2(a.vel_wk)}</td><td class="num">${fmt2(a.recent_wk)}</td><td>${statusPill(a)}</td>
        ${act ? `<td class="small">Transfer in or reorder</td>` : ""}</tr>`).join("")}</table>`
      : `<p class="empty">None.</p>`}
    </div>`;

    const transCard = `
    <div class="card"><h2>${act ? "Urgent transfers" : "Broken affinity — transfer suggestions"} <span class="muted small">(${s.transfers.length})</span></h2>
      <p class="lede">Basket affinity at work: these pairs sell together in the same receipt. A store holding one side without the other is leaving complete sets on the table — move units to fix it.</p>
      ${s.transfers.length ? s.transfers.map(t => `
        <div class="alert-row"><div>${t.rank ? `<span class="pill info">#${t.rank}</span> ` : ""}<b>${esc(t.pair)}</b> <span class="muted small">(${t.n} baskets)</span><br>
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
