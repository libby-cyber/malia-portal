/* plan.js — Tab 1: Seasonal plan (rotation calendar, drops, line sheet allocator, schedule tracker) */
const Plan = (() => {
  function dropMath(drop, asm) {
    const winMonths = monthsBetween(drop.window[0], drop.window[drop.window.length - 1]);
    let demand = winMonths.reduce((s, ym) => s + templateDemand(ym), 0);
    demand *= (1 + (asm.growth_pct || 0) / 100);
    const buy = demand / asm.sell_through;
    const inStore = drop.in_store;
    const colorMonths = drop.color_months;
    const sellOut = addDays(inStore, Math.round(colorMonths * 30.44));
    const handoff = addDays(sellOut, -14);
    const fabricOrder = addWeeks(inStore, -(asm.fabric_lead_wks + asm.sewing_lead_wks + asm.transit_wks));
    const sewingLaunch = addWeeks(inStore, -(asm.sewing_lead_wks + asm.transit_wks));
    // receipt ramp: spread buy over months ending at in-store month, within factory cap
    const ramp = buildRamp(Math.round(buy), asm, inStore);
    const overCap = ramp.some(r => r.qty > asm.factory_cap_flag);
    return { demand: Math.round(demand), buy: Math.round(buy), inStore, sellOut, handoff,
             fabricOrder, sewingLaunch, ramp, overCap, winMonths };
  }

  function buildRamp(buyR, asm, inStore) {
    const perMonth = Math.min(asm.factory_cap_month, buyR);
    const nMonths = Math.max(1, Math.ceil(buyR / asm.factory_cap_month));
    const ramp = [];
    const [iy, im] = inStore.split("-").map(Number);
    for (let i = nMonths - 1; i >= 0; i--) {
      let y = iy, m = im - i;
      while (m < 1) { m += 12; y--; }
      const q = (i === 0) ? buyR - perMonth * (nMonths - 1) : perMonth;
      ramp.push({ ym: `${y}-${String(m).padStart(2, "0")}`, qty: q });
    }
    return ramp;
  }

  function assumptionsCard(root) {
    const asm = getAssumptions();
    const d = DATA.meta.defaults;
    const fields = [
      ["sell_through", "Sell-through (plan rate)", 0.5, 0.95, 0.01, v => (v * 100).toFixed(0) + "%"],
      ["growth_pct", "Growth %", -20, 50, 1, v => v + "%"],
      ["fabric_lead_wks", "Fabric lead (wks)", 1, 20, 1, v => v],
      ["sewing_lead_wks", "Sewing lead (wks)", 1, 20, 1, v => v],
      ["transit_wks", "Transit (wks)", 0, 8, 1, v => v],
      ["grade_a_units", "Grade A units/color", 100, 1500, 10, v => v],
      ["grade_a_months", "Grade A months", 1, 12, 1, v => v],
      ["grade_b_units", "Grade B units/color", 100, 1000, 10, v => v],
      ["grade_b_months", "Grade B months", 1, 12, 1, v => v],
      ["grade_c_units", "Grade C units/color", 50, 600, 10, v => v],
      ["grade_c_months", "Grade C months", 1, 12, 1, v => v],
      ["factory_cap_month", "Factory cap (units/mo)", 200, 3000, 50, v => v],
      ["factory_cap_flag", "Flag above (units/mo)", 500, 4000, 50, v => v],
      ["tops_pct", "Tops %", 0, 100, 1, v => v + "%"],
      ["bottoms_pct", "Bottoms %", 0, 100, 1, v => v + "%"],
      ["maillots_pct", "Maillots %", 0, 100, 1, v => v + "%"]
    ];
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<h2>Planning assumptions</h2>
      <p class="muted small">Every input recalculates immediately and is saved. Typed unit overrides always win over computed values.</p>
      <div class="grid c4">${fields.map(([k, label, min, max, step, f]) => `
        <label class="f">${esc(label)}
          <input type="number" data-asm="${k}" min="${min}" max="${max}" step="${step}" value="${asm[k]}">
        </label>`).join("")}</div>
      <p style="margin-top:10px"><button class="btn ghost sm" id="asm-reset">Reset to defaults</button></p>`;
    root.appendChild(el);
    $$("input[data-asm]", el).forEach(inp => {
      inp.addEventListener("change", () => {
        setAssumption(inp.dataset.asm, Number(inp.value));
        render();
      });
    });
    $("#asm-reset", el).addEventListener("click", () => {
      Object.keys(d).forEach(k => Store.remove("asm_" + k));
      render();
    });
  }

  function dropCards(root) {
    const asm = getAssumptions();
    const el = document.createElement("div");
    el.innerHTML = `<div class="card"><h2>Color rotation plan</h2>
      <p class="muted small">Three mutually exclusive drops. Annual buy = sum of drop buys.
      Demand anchored to 4,839 swim units sold in 2026 (full assortment), shaped by the real seasonal curve — sharp September cliff included.</p></div>`;
    let annualBuy = 0, annualDemand = 0;
    const wrap = document.createElement("div");
    DATA.meta.drops.forEach(drop => {
      const m = dropMath(drop, asm);
      // manual buy override feeds the ramp + annual total (stored value always wins)
      const ovrBuy = Store.get("ovr_buy_" + drop.id, null);
      if (ovrBuy !== null && ovrBuy !== "" && ovrBuy !== undefined) {
        m.buy = Number(ovrBuy);
        m.ramp = buildRamp(m.buy, asm, m.inStore);
        m.overCap = m.ramp.some(r => r.qty > asm.factory_cap_flag);
      }
      annualBuy += m.buy; annualDemand += m.demand;
      const assigned = Store.get("drop_colors_" + drop.id, []);
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <h2>${esc(drop.name)} <span class="pill info">${m.winMonths.length}-mo window</span>
          ${m.overCap ? `<span class="pill bad">over factory capacity</span>` : ""}</h2>
        <div class="grid c4">
          <div class="stat"><div class="label">Projected demand</div><div class="value">${fmt(m.demand)}</div>
            <div class="note">same months last year × growth</div></div>
          <div class="stat"><div class="label">Drop buy (÷ ${Math.round(asm.sell_through*100)}% ST)</div>
            <div class="value">${unitField("buy_" + drop.id, m.buy)}</div>
            <div class="note">manual entry sticks</div></div>
          <div class="stat"><div class="label">In store</div><div class="value" style="font-size:18px">${fmtDate(m.inStore)}</div>
            <div class="note">sell out ~${fmtDate(m.sellOut)}</div></div>
          <div class="stat"><div class="label">Key dates</div>
            <div class="note">fabric order: <b>${fmtDate(m.fabricOrder)}</b><br>
            sewing launch: <b>${fmtDate(m.sewingLaunch)}</b><br>
            handoff: <b>${fmtDate(m.handoff)}</b></div></div>
        </div>
        <h3>Factory receipt ramp <span class="muted small">(cap ${fmt(asm.factory_cap_month)}/mo, flag &gt;${fmt(asm.factory_cap_flag)})</span></h3>
        <p>${m.ramp.map(r => `<span class="pill ${r.qty > asm.factory_cap_flag ? "bad" : "ok"}">${r.ym}: ${fmt(r.qty)}</span>`).join(" ")}</p>
        <h3>Assigned colorways ${assigned.length ? `(${assigned.length})` : ""}</h3>
        <div id="dc-${drop.id}">${assigned.length ? assigned.map((c, i) => `
          <span class="pill ${c.grade === "A" ? "info" : c.grade === "B" ? "ok" : "warn"}">${esc(c.name)} · Grade ${esc(c.grade)} · ${fmt(c.units)}u
          <a href="#" data-unassign="${drop.id}:${i}" style="color:inherit;margin-left:6px">×</a></span> `).join("")
          : `<span class="muted small">None yet — assign them in the line sheet allocator below.</span>`}</div>`;
      wrap.appendChild(card);
    });
    const sum = document.createElement("div");
    sum.className = "card";
    sum.innerHTML = `<div class="grid c3">
      <div class="stat"><div class="label">Annual rotation buy</div><div class="value">${fmt(annualBuy)}</div>
        <div class="note">sum of drop buys</div></div>
      <div class="stat"><div class="label">12-month demand</div><div class="value">${fmt(annualDemand)}</div>
        <div class="note">Dec 2026 – Nov 2027</div></div>
      <div class="stat"><div class="label">Peak monthly receipt</div><div class="value">${fmt(Math.max(...DATA.meta.drops.flatMap(d => dropMath(d, asm).ramp.map(r => r.qty))))}</div>
        <div class="note">vs ${fmt(asm.factory_cap_month)}/mo cap</div></div></div>`;
    el.appendChild(sum); el.appendChild(wrap); root.appendChild(el);
    bindOverrides(wrap); bindOverrides(sum);
    $$("a[data-unassign]", wrap).forEach(a => a.addEventListener("click", ev => {
      ev.preventDefault();
      const [did, idx] = a.dataset.unassign.split(":");
      const arr = Store.get("drop_colors_" + did, []);
      arr.splice(Number(idx), 1);
      Store.set("drop_colors_" + did, arr);
      render();
    }));
  }

  /* ---------- line sheet allocator ---------- */
  function styleTypeGuess(style) {
    // heuristic for tops/bottoms/maillot split when class data is thin
    const s = style.toLowerCase();
    const bottomWords = ["cinch", "bambi", "brief", "bottom", "cheeky", "thong", "bikini bottom"];
    const maillotWords = ["maillot", "one piece", "one-piece", "suit"];
    if (bottomWords.some(w => s.includes(w))) return "bottoms";
    if (maillotWords.some(w => s.includes(w))) return "maillots";
    return "tops";
  }

  function affinityFor(style) {
    // top pairing partners for a style, ranked
    const out = [];
    DATA.affinity.pairs.forEach(p => {
      if (p.a === style) out.push({ other: p.b, n: p.n });
      else if (p.b === style) out.push({ other: p.a, n: p.n });
    });
    return out.sort((x, y) => y.n - x.n).slice(0, 5);
  }

  function allocatorCard(root) {
    const asm = getAssumptions();
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<h2>Line sheet allocator</h2>
      <p class="muted small">Split a colorway into tops / bottoms / maillots, then check matching-bottom affinity.
      Affinity starts the draft — add, remove, or override any style and your entries always win.</p>
      <div class="toolbar">
        <label class="f">Colorway name <input type="text" id="ls-name" placeholder="e.g. monterrico blue" style="width:200px"></label>
        <label class="f">Drop <select id="ls-drop">${DATA.meta.drops.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join("")}</select></label>
        <label class="f">Grade <select id="ls-grade">
          <option value="A">A (~${asm.grade_a_units}u, ${asm.grade_a_months} mo)</option>
          <option value="B">B (~${asm.grade_b_units}u, ${asm.grade_b_months} mo)</option>
          <option value="C">C (~${asm.grade_c_units}u, ${asm.grade_c_months} mo)</option></select></label>
        <label class="f">Tops % <input type="number" id="ls-tops" value="${asm.tops_pct}" style="width:70px"></label>
        <label class="f">Bottoms % <input type="number" id="ls-bottoms" value="${asm.bottoms_pct}" style="width:70px"></label>
        <label class="f">Maillots % <input type="number" id="ls-maillots" value="${asm.maillots_pct}" style="width:70px"></label>
        <button class="btn sm" id="ls-build">Build draft</button>
      </div>
      <div id="ls-recut-note"></div>
      <div id="ls-output"></div>`;
    root.appendChild(el);

    $("#ls-build", el).addEventListener("click", () => {
      const name = $("#ls-name", el).value.trim().toLowerCase();
      const grade = $("#ls-grade", el).value;
      const dropId = $("#ls-drop", el).value;
      const tp = Number($("#ls-tops", el).value) / 100,
            bp = Number($("#ls-bottoms", el).value) / 100,
            mp = Number($("#ls-maillots", el).value) / 100;
      if (!name) { alert("Name the colorway first."); return; }
      let tierUnits = grade === "A" ? asm.grade_a_units : grade === "B" ? asm.grade_b_units : asm.grade_c_units;

      // RECUT detection: color already exists in inventory (and not excluded)
      const excluded = new Set([...DATA.meta.pull_list_colors, ...DATA.meta.dead_colors]);
      const existingRows = DATA.inventory.filter(e => e.c === name && !excluded.has(e.c));
      const isRecut = existingRows.length > 0;
      let recutHoles = null;
      if (isRecut) {
        // hole analysis: for styles in the affinity draft, planned share vs available
        recutHoles = computeHoles(name, tierUnits, tp, bp, mp, existingRows);
        tierUnits = recutHoles.total;
      }

      const draft = buildDraft(tierUnits, tp, bp, mp);
      renderAllocatorOutput($("#ls-output", el), { name, grade, dropId, tierUnits, tp, bp, mp, draft, isRecut, recutHoles });
      $("#ls-recut-note", el).innerHTML = isRecut
        ? `<p class="pill warn">RECUT — "${esc(name)}" exists in stock. Target set to computed hole quantity (${fmt(tierUnits)}u), not the generic tier default.</p>
           ${recutHoles.urgent.length ? `<p class="small"><b>Also urgent elsewhere:</b> ${recutHoles.urgent.slice(0, 5).map(u => esc(u)).join("; ")}</p>` : ""}`
        : `<p class="hint">New color — target is the editable tier default. Type any number to override; it sticks.</p>`;
    });
  }

  function topStylesByType(type, n) {
    // rank styles by 2026-era sales volume from style_velocity histories
    const totals = {};
    for (const [key, hist] of Object.entries(DATA.styleVelocity)) {
      const [style] = key.split("|");
      if (styleTypeGuess(style) !== type) continue;
      totals[style] = (totals[style] || 0) + Object.values(hist).reduce((a, b) => a + b, 0);
    }
    return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);
  }

  function buildDraft(tierUnits, tp, bp, mp) {
    const draft = [];
    const alloc = [
      ["tops", Math.round(tierUnits * tp)],
      ["bottoms", Math.round(tierUnits * bp)],
      ["maillots", Math.round(tierUnits * mp)]
    ];
    alloc.forEach(([type, units]) => {
      if (units <= 0) return;
      const styles = topStylesByType(type, 5);
      if (!styles.length) { draft.push({ style: "(no " + type + " styles found)", type, units, affinity: [] }); return; }
      // weight by rank
      const weights = styles.map((_, i) => styles.length - i);
      const wsum = weights.reduce((a, b) => a + b, 0);
      let assigned = 0;
      styles.forEach((s, i) => {
        const u = (i === styles.length - 1) ? units - assigned : Math.round(units * weights[i] / wsum);
        assigned += u;
        draft.push({ style: s, type, units: u, affinity: affinityFor(s).slice(0, 3) });
      });
    });
    return draft;
  }

  function computeHoles(colorName, tierUnits, tp, bp, mp, rows) {
    // available by style (active stores)
    const avail = {};
    rows.forEach(r => { avail[r.s] = (avail[r.s] || 0) + r.t; });
    // planned share per style from a draft at tier units
    const draft = buildDraft(tierUnits, tp, bp, mp);
    let total = 0;
    const perStyle = draft.map(d => {
      const hole = Math.max(0, d.units - (avail[d.style] || 0));
      total += hole;
      return { style: d.style, planned: d.units, avail: avail[d.style] || 0, hole };
    });
    // urgent elsewhere: active style/color with 0 OH and recent YoY demand
    const urgent = DATA.alerts.filter(a => a.status === "stockout_demand").slice(0, 8)
      .map(a => `${a.style} (${a.color}, size ${a.size})`);
    return { total, perStyle, urgent };
  }

  function renderAllocatorOutput(out, ctx) {
    const { name, grade, dropId, draft, isRecut, recutHoles } = ctx;
    const key = "alloc_" + name.replace(/\W+/g, "_");
    out.innerHTML = `
      <h3>${isRecut ? "Recut" : "New"} colorway: ${esc(name)} · Grade ${grade} · target ${unitField(key + "_target", ctx.tierUnits)}</h3>
      ${isRecut && recutHoles ? `<details open><summary>Hole analysis (planned vs available)</summary><div class="body">
        <table><tr><th>Style</th><th>Planned</th><th>Available</th><th>Hole (recut)</th></tr>
        ${recutHoles.perStyle.map(p => `<tr><td>${esc(p.style)}</td><td>${fmt(p.planned)}</td><td>${fmt(p.avail)}</td><td><b>${fmt(p.hole)}</b></td></tr>`).join("")}
        </table></div></details>` : ""}
      <table id="ls-table"><tr><th>Style</th><th>Type</th><th>Units</th><th>Affinity signal</th><th></th></tr>
      ${draft.map((d, i) => `<tr>
        <td>${esc(d.style)}</td><td>${esc(d.type)}</td>
        <td>${unitField(key + "_s" + i, d.units)}</td>
        <td class="small muted">${d.affinity.map(a => `${esc(a.other)} (${a.n})`).join("<br>") || "—"}</td>
        <td><button class="btn ghost sm" data-rm="${i}">×</button></td></tr>`).join("")}
      </table>
      <div class="toolbar" style="margin-top:10px">
        <label class="f">Add style <input type="text" id="ls-add-name" placeholder="style name" style="width:180px"></label>
        <label class="f">Units <input type="number" id="ls-add-units" value="50" style="width:80px"></label>
        <button class="btn ghost sm" id="ls-add">Add style</button>
        <button class="btn sm" id="ls-save">Add colorway to ${esc(DATA.meta.drops.find(d => d.id === dropId).name)}</button>
      </div>
      <p class="hint">Removed styles stay removed; typed units never recalculate away.</p>`;
    bindOverrides(out);
    let rows = draft.map((d, i) => ({ ...d, oid: key + "_s" + i }));
    const removed = new Set();
    const table = $("#ls-table", out);
    function extraRow(nm, un, idx) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${esc(nm)}</td><td>manual</td>
        <td>${unitField(key + "_x" + idx, un)}</td>
        <td class="small muted">${affinityFor(nm).slice(0, 3).map(a => `${esc(a.other)} (${a.n})`).join("<br>") || "—"}</td>
        <td><button class="btn ghost sm">×</button></td>`;
      tr.querySelector("button").addEventListener("click", () => {
        const extra = Store.get(key + "_extra", []);
        extra.splice(idx, 1);
        Store.set(key + "_extra", extra);
        tr.remove();
      });
      table.appendChild(tr);
      bindOverrides(tr);
    }
    // restore manually-added styles persisted earlier
    Store.get(key + "_extra", []).forEach((x, i) => extraRow(x.style, x.units, i));
    $$("button[data-rm]", out).forEach(b => b.addEventListener("click", () => {
      removed.add(Number(b.dataset.rm));
      b.closest("tr").remove();
      Store.set(key + "_removed", [...removed]);
    }));
    // restore removals persisted earlier
    (Store.get(key + "_removed", [])).forEach(i => {
      const b = $(`button[data-rm="${i}"]`, out);
      if (b) b.closest("tr").remove();
    });
    $("#ls-add", out).addEventListener("click", () => {
      const nm = $("#ls-add-name", out).value.trim().toLowerCase();
      const un = Number($("#ls-add-units", out).value) || 0;
      if (!nm) return;
      const extra = Store.get(key + "_extra", []);
      extra.push({ style: nm, units: un });
      Store.set(key + "_extra", extra);
      extraRow(nm, un, extra.length - 1);
      $("#ls-add-name", out).value = "";
    });
    $("#ls-save", out).addEventListener("click", () => {
      const target = Store.get("ovr_" + key + "_target", ctx.tierUnits);
      const arr = Store.get("drop_colors_" + dropId, []);
      arr.push({ name, grade, units: Number(target) || ctx.tierUnits });
      Store.set("drop_colors_" + dropId, arr);
      render();
    });
  }

  /* ---------- schedule tracker ---------- */
  function trackerCard(root) {
    const asm = getAssumptions();
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<h2>Schedule tracker</h2>
      <p class="muted small">Planned receipt ramp vs. actual WIP receipts per drop. Enter actuals as they land — status flags automatically.</p>
      <div id="trk"></div>`;
    root.appendChild(el);
    const host = $("#trk", el);
    DATA.meta.drops.forEach(drop => {
      const m = dropMath(drop, asm);
      const rows = m.ramp.map(r => {
        const actual = Store.get(`trk_${drop.id}_${r.ym}`, null);
        const st = actual === null ? `<span class="pill info">pending</span>`
          : actual >= r.qty ? `<span class="pill ok">on track</span>`
          : actual >= r.qty * 0.7 ? `<span class="pill warn">at risk</span>`
          : `<span class="pill bad">behind</span>`;
        return `<tr><td>${r.ym}</td><td>${fmt(r.qty)}</td>
          <td><input type="number" data-trk="${drop.id}_${r.ym}" value="${actual === null ? "" : actual}" placeholder="actual" style="width:90px"></td>
          <td>${st}</td></tr>`;
      }).join("");
      const d = document.createElement("div");
      d.innerHTML = `<h3>${esc(drop.name)} — fabric order ${fmtDate(m.fabricOrder)} · sewing ${fmtDate(m.sewingLaunch)}</h3>
        <table><tr><th>Month</th><th>Planned</th><th>Actual received</th><th>Status</th></tr>${rows}</table>`;
      host.appendChild(d);
    });
    $$("input[data-trk]", host).forEach(inp => {
      inp.addEventListener("change", () => {
        const v = inp.value === "" ? null : Number(inp.value);
        if (v === null) Store.remove("trk_" + inp.dataset.trk);
        else Store.set("trk_" + inp.dataset.trk, v);
        render();
      });
    });
  }

  function render() {
    const root = $("#tab-plan");
    root.innerHTML = "";
    assumptionsCard(root);
    dropCards(root);
    allocatorCard(root);
    trackerCard(root);
  }
  function refreshDerived() { render(); }

  return { render, dropMath };
})();
