/* plan.js — Seasonal plan tab: header stats, sub-tabs (signals / tiers+line sheet / calendar) */
const Plan = (() => {
  /* ---------- drop math (same-months-last-year shaped demand) ---------- */
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

  /* manual buy override always wins */
  function dropCalc(drop) {
    const asm = getAssumptions();
    const m = dropMath(drop, asm);
    const ovr = Store.get("ovr_buy_" + drop.id, null);
    if (ovr !== null && ovr !== "" && ovr !== undefined) {
      m.buy = Math.round(Number(ovr));
      m.ramp = buildRamp(m.buy, asm, m.inStore);
      m.overCap = m.ramp.some(r => r.qty > asm.factory_cap_flag);
    }
    return m;
  }

  /* ---------- fabric tier model ---------- */
  const TIER_DEFAULTS = { fabric_category: "Matte", grade_a_colors: 1, grade_b_colors: 1 };
  function getTier() {
    const t = {};
    for (const k of Object.keys(TIER_DEFAULTS)) t[k] = Store.get("asm_" + k, TIER_DEFAULTS[k]);
    return t;
  }
  function setTier(k, v) { Store.set("asm_" + k, v); }

  let _shares = null;
  function fabricShares() {
    if (_shares) return _shares;
    const cmap = {};
    DATA.colors.forEach(c => { cmap[c.color] = (c.fabric && c.fabric[0]) || "Matte"; });
    const totals = { Matte: 0, Shiny: 0, Novelty: 0, Print: 0 };
    for (const [key, hist] of Object.entries(DATA.styleVelocity)) {
      const color = key.split("|").slice(1).join("|");
      const fab = cmap[color] || "Matte";
      let s = 0;
      for (const [ym, v] of Object.entries(hist)) if (ym.indexOf("2026") === 0) s += v;
      if (totals[fab] === undefined) totals.Matte += s; else totals[fab] += s;
    }
    const tot = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
    _shares = {};
    for (const k of Object.keys(totals)) _shares[k] = totals[k] / tot;
    return _shares;
  }

  function tierMath() {
    const asm = getAssumptions(), t = getTier();
    const calcs = DATA.meta.drops.map(drop => ({ drop, m: dropCalc(drop) }));
    const annualBuy = calcs.reduce((s, c) => s + c.m.buy, 0);
    const demand12 = calcs.reduce((s, c) => s + c.m.demand, 0);
    const shares = fabricShares();
    const cat = t.fabric_category;
    const share = shares[cat] || 0;
    const need = Math.round(annualBuy * share);
    const aU = +asm.grade_a_units || 0, bU = +asm.grade_b_units || 0, cU = +asm.grade_c_units || 0;
    const aN = Math.max(0, Math.round(+t.grade_a_colors || 0));
    const bN = Math.max(0, Math.round(+t.grade_b_colors || 0));
    const rem = need - aU * aN - bU * bN;
    const cN = (rem > 0 && cU > 0) ? Math.ceil(rem / cU) : 0;
    const capacity = aU * aN + bU * bN + cU * cN;
    const slots = aN + bN + cN;
    const blackReorder = Black.computeRows().filter(r => r.status === "reorder").length;
    const sellouts = DATA.alerts.filter(a => a.status === "stockout_demand").length;
    return { asm, t, calcs, annualBuy, demand12, cat, share, need,
             aU, bU, cU, aN, bN, cN, capacity, slots, blackReorder, sellouts };
  }

  function buildSlots(tm) {
    const slots = [];
    let n = 0;
    [["A", tm.aN, tm.aU], ["B", tm.bN, tm.bU], ["C", tm.cN, tm.cU]].forEach(([g, count, u]) => {
      for (let i = 1; i <= count; i++) {
        n++;
        const key = `${tm.cat}_${g}_${i}`;
        slots.push({
          grade: g, i, n, key, target: u,
          name: Store.get("slotname_" + key, `New ${tm.cat} ${g} color ${i}`)
        });
      }
    });
    return slots;
  }

  /* ---------- tab header ---------- */
  function headerBlock(root) {
    const el = document.createElement("div");
    el.className = "pagehead";
    el.innerHTML = `
      <div><h1>Build the next receipt</h1>
      <p class="sub">Every assumption below is editable. Figures recalculate immediately.</p></div>
      <button class="btn ghost" id="dl-signals">Download planning signals</button>`;
    root.appendChild(el);
    $("#dl-signals", el).addEventListener("click", downloadCSV);
  }

  function statCard(label, value, desc, color) {
    return `<div class="statcard" style="--tc:${color}">
      <div class="mlabel">${esc(label)}</div>
      <div class="statnum">${value}</div>
      <div class="statdesc">${desc}</div></div>`;
  }

  function statCards(root, tm) {
    const el = document.createElement("div");
    el.className = "statrow";
    el.innerHTML =
      statCard("Annual rotation buy", fmt(tm.annualBuy), "sum of 3 drop-sized buys", "var(--orange)") +
      statCard("12-month demand", fmt(tm.demand12), "served by December, spring and summer drops", "var(--slate)") +
      statCard("2026 sales anchor", fmt(DATA.demand.annual), "swim units sold · not remnant velocity", "var(--teal)") +
      statCard("Current stock sell-outs", fmt(tm.sellouts), "zero on-hand with measurable demand", "var(--orange)");
    root.appendChild(el);
  }

  /* ---------- sub tabs ---------- */
  const SUBTABS = [
    ["signals", "Pace & stock signals"],
    ["tiers", "Fabric tiers & line sheet"],
    ["calendar", "Calendar"]
  ];
  function subTabs(root) {
    const cur = Store.get("ui_subtab", "tiers");
    const el = document.createElement("div");
    el.className = "subtabs";
    el.innerHTML = SUBTABS.map(([id, label]) =>
      `<button data-sub="${id}" class="${cur === id ? "active" : ""}">${esc(label)}</button>`).join("");
    root.appendChild(el);
    $$("button[data-sub]", el).forEach(b => b.addEventListener("click", () => {
      Store.set("ui_subtab", b.dataset.sub);
      refreshDerived();
    }));
  }

  /* ---------- per-colorway buy / expected sell-through / months ----------
   * Buy is free: tier-target default, typed value always wins.
   * ST% is an expectation, not a formula: sales = buy × ST%, leftover = buy − sales.
   * Low ST% reads as "smaller, fun color" (e.g. 120u buy, expect 50%).
   * Keys: slots → ovr_slot_/ovr_slotbuy_/ovr_slotst_/ovr_slotmo_{cat}_{grade}_{i}
   *       assigned colorways → ovr_cwbuy_/ovr_cwst_/ovr_cwmo_{nameKey}_{dropId} */
  function cwExpected(buy, stFrac) {
    const b = Math.round(+buy || 0);
    const sales = Math.round(b * stFrac);
    return { sales, leftover: b - sales };
  }
  function slotBuyUnits(slot) {
    const v = Store.get("ovr_slotbuy_" + slot.key, null);
    return (v === null || v === "" || v === undefined) ? slotTierUnits(slot) : Math.round(+v);
  }
  function cwBuyUnitsEntry(c, dropId) {
    const nk = cwNameKey(c.name);
    const v = Store.get("ovr_cwbuy_" + nk + "_" + dropId, null);
    const fb = (c.buy !== undefined && c.buy !== null) ? c.buy : c.units;
    return (v === null || v === "" || v === undefined) ? Math.round(+fb || 0) : Math.round(+v);
  }
  function slotStFrac(slot, asm) {
    const v = Store.get("ovr_slotst_" + slot.key, null);
    return (v === null || v === "" || v === undefined) ? asm.sell_through : +v;
  }
  function slotMonths(slot, asm) {
    const v = Store.get("ovr_slotmo_" + slot.key, null);
    const fb = asm["grade_" + slot.grade.toLowerCase() + "_months"];
    return (v === null || v === "" || v === undefined) ? fb : +v;
  }
  function slotTierUnits(slot) {
    const v = Store.get("ovr_slot_" + slot.key, null);
    return (v === null || v === "" || v === undefined) ? slot.target : Math.round(+v);
  }
  function cwNameKey(name) { return String(name).toLowerCase().replace(/\W+/g, "_"); }
  function cwStFrac(nameKey, dropId, fallback) {
    const v = Store.get("ovr_cwst_" + nameKey + "_" + dropId, null);
    return (v === null || v === "" || v === undefined) ? fallback : +v;
  }
  function cwMonths(nameKey, dropId, fallback) {
    const v = Store.get("ovr_cwmo_" + nameKey + "_" + dropId, null);
    return (v === null || v === "" || v === undefined) ? fallback : +v;
  }
  function cwSellOut(inStore, months) { return addDays(inStore, Math.round(months * 30.44)); }

  /* ---------- WIP linesheet pull ----------
   * Match a typed colorway name against WIP colors: exact first, then
   * containment both ways preferring the longest WIP color name.
   * A pulled linesheet is stored under "<allocKey>_wip" as
   * [{style,type,units,received,on_order,pos}] and its rows render exactly
   * like draft rows (editable, removable, typed values persist). */
  function normColor(s) { return String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ").trim(); }

  function matchWipColor(name) {
    const rows = (DATA.wip && DATA.wip.rows) || [];
    const n = normColor(name);
    if (!n || !rows.length) return null;
    const seen = {};
    rows.forEach(r => { const c = normColor(r.color); if (c && !(c in seen)) seen[c] = String(r.color).trim(); });
    if (seen[n]) return { norm: n, display: seen[n] };
    const cands = Object.keys(seen).filter(c => c.indexOf(n) !== -1 || n.indexOf(c) !== -1);
    if (!cands.length) return null;
    cands.sort((a, b) => b.length - a.length);
    return { norm: cands[0], display: seen[cands[0]] };
  }

  function wipRowsFor(colorNorm) {
    return ((DATA.wip && DATA.wip.rows) || []).filter(r => normColor(r.color) === colorNorm);
  }

  function wipLinesheet(colorNorm) {
    const byStyle = {};
    wipRowsFor(colorNorm).forEach(r => {
      const sk = normColor(r.style);
      if (!sk) return;
      if (!byStyle[sk]) byStyle[sk] = { style: String(r.style).trim(), received: 0, on_order: 0, pos: {} };
      byStyle[sk].received += (+r.received || 0);
      byStyle[sk].on_order += (+r.on_order || 0);
      if (r.po) byStyle[sk].pos[String(r.po)] = r.order_date || "";
    });
    return Object.values(byStyle)
      .map(s => Object.assign(s, {
        units: s.received + s.on_order,
        type: styleTypeGuess(s.style),
        affinity: affinityFor(s.style).slice(0, 3)
      }))
      .filter(s => s.units > 0)
      .sort((a, b) => b.units - a.units);
  }

  function wipSummary(colorNorm) {
    const rows = wipRowsFor(colorNorm);
    let received = 0, on_order = 0;
    const pos = {};
    rows.forEach(r => {
      received += (+r.received || 0);
      on_order += (+r.on_order || 0);
      if (r.po) pos[String(r.po)] = r.order_date || "";
    });
    return { styles: wipLinesheet(colorNorm).length, received, on_order, pos };
  }

  /* ---------- tiers sub-tab ---------- */
  function renderTiers(root, tm) {
    tierBar(root, tm);
    tierStats(root, tm);
    const cols = document.createElement("div");
    cols.className = "twocol";
    colorGradePlan(cols, tm);
    allocatorCard(cols, tm);
    root.appendChild(cols);
    dropCardsSection(root, tm);
    styleCoverageCard(root, tm);
    trackerCard(root);
    assumptionsCard(root);
  }

  function tierBar(root, tm) {
    const t = tm.t, asm = tm.asm;
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<h2>Fabric tiers</h2>
      <p class="lede">Tier sizes are editable planning targets. Grade C color count is derived from remaining need.</p>
      <div class="formgrid tierbar">
        <label class="f">Fabric category
          <select id="tb-cat">${["Matte", "Shiny", "Novelty", "Print"].map(c =>
            `<option ${t.fabric_category === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
        <label class="f">Grade A units / color
          <input type="number" id="tb-au" value="${asm.grade_a_units}" min="50" step="10"></label>
        <label class="f">Grade A colors
          <input type="number" id="tb-ac" value="${t.grade_a_colors}" min="0" step="1"></label>
        <label class="f">Grade B units / color
          <input type="number" id="tb-bu" value="${asm.grade_b_units}" min="50" step="10"></label>
        <label class="f">Grade B colors
          <input type="number" id="tb-bc" value="${t.grade_b_colors}" min="0" step="1"></label>
        <label class="f">Grade C units / color
          <input type="number" id="tb-cu" value="${asm.grade_c_units}" min="25" step="10"></label>
      </div>`;
    root.appendChild(el);
    const upd = () => refreshDerived();
    $("#tb-cat", el).addEventListener("change", e => { setTier("fabric_category", e.target.value); upd(); });
    $("#tb-au", el).addEventListener("change", e => { setAssumption("grade_a_units", +e.target.value); upd(); });
    $("#tb-ac", el).addEventListener("change", e => { setTier("grade_a_colors", +e.target.value); upd(); });
    $("#tb-bu", el).addEventListener("change", e => { setAssumption("grade_b_units", +e.target.value); upd(); });
    $("#tb-bc", el).addEventListener("change", e => { setTier("grade_b_colors", +e.target.value); upd(); });
    $("#tb-cu", el).addEventListener("change", e => { setAssumption("grade_c_units", +e.target.value); upd(); });
  }

  function tierStats(root, tm) {
    const el = document.createElement("div");
    el.className = "statrow";
    const diff = tm.capacity - tm.need;
    const capNote = diff === 0 ? "matches need"
      : diff > 0 ? `${fmt(diff)} above need` : `${fmt(-diff)} below need`;
    el.innerHTML =
      statCard("New-color need", fmt(tm.need), `${esc(tm.cat)} units from seasonal demand`, "var(--slate)") +
      statCard("Tier capacity", fmt(tm.capacity), capNote, "var(--slate)") +
      statCard("Color slots", fmt(tm.slots), `${tm.aN} A · ${tm.bN} B · ${tm.cN} C`, "var(--slate)") +
      statCard("Black reorder now", fmt(tm.blackReorder), "separate lean replenishment track", "var(--slate)");
    root.appendChild(el);
  }

  /* ----- color grade plan (slot list) ----- */
  function colorGradePlan(root, tm) {
    const el = document.createElement("div");
    el.className = "card";
    const slots = buildSlots(tm);
    el.innerHTML = `<h2>Color grade plan</h2>
      <p class="lede">Demand-ranked colorways; tier sizes are editable planning targets.</p>
      <div style="max-height:620px;overflow:auto" id="slotlist"></div>`;
    root.appendChild(el);
    const host = $("#slotlist", el);
    const asm = tm.asm;
    slots.forEach(s => {
      const st = slotStFrac(s, asm), mo = slotMonths(s, asm), tu = slotTierUnits(s);
      const buy = slotBuyUnits(s);
      const exp = cwExpected(buy, st);
      const row = document.createElement("div");
      row.className = "slotrow";
      row.innerHTML = `
        <span class="gbadge ${s.grade}">${s.grade}</span>
        <div style="min-width:0;flex:1">
          <div class="slotname">${esc(s.name)}</div>
          <div class="slotsub"><b>${mo} mo</b> in store · expected sales <b>${fmt(exp.sales)}u</b> · leftover ${fmt(exp.leftover)}u · double-click name to rename</div>
        </div>
        <span class="slotrank">#${s.n}</span>
        <div class="slotnums">
          <div><div class="mlabel">Tier target</div>${unitField("slot_" + s.key, tu)}</div>
          <div><div class="mlabel">Buy</div>${unitField("slotbuy_" + s.key, buy)}</div>
          <div><div class="mlabel">ST%</div>
            <input type="number" data-slotst="${esc(s.key)}" value="${Math.round(st * 100)}" min="5" max="200" step="1" title="Expected sell-through %"></div>
          <div><div class="mlabel">Mo</div>
            <input type="number" data-slotmo="${esc(s.key)}" value="${mo}" min="1" max="12" step="1" title="Months in store"></div>
        </div>`;
      host.appendChild(row);
      row.addEventListener("click", e => {
        if (e.target.tagName === "INPUT") return;
        loadSlotIntoAllocator(s, tm);
      });
      const nm = $(".slotname", row);
      nm.addEventListener("dblclick", e => {
        e.stopPropagation();
        const inp = document.createElement("input");
        inp.type = "text"; inp.value = s.name;
        nm.replaceWith(inp); inp.focus(); inp.select();
        const commit = () => {
          const v = inp.value.trim();
          if (v) Store.set("slotname_" + s.key, v);
          refreshDerived();
        };
        inp.addEventListener("blur", commit);
        inp.addEventListener("keydown", ev => { if (ev.key === "Enter") inp.blur(); if (ev.key === "Escape") refreshDerived(); });
        inp.addEventListener("click", ev => ev.stopPropagation());
      });
    });
    bindOverrides(host);
    $$("input[data-slotst]", host).forEach(inp => inp.addEventListener("change", () => {
      const raw = inp.value;
      if (raw === "" || raw === null) Store.remove("ovr_slotst_" + inp.dataset.slotst);
      else Store.set("ovr_slotst_" + inp.dataset.slotst, Math.min(2, Math.max(0.05, +raw / 100)));
      refreshDerived();
    }));
    $$("input[data-slotmo]", host).forEach(inp => inp.addEventListener("change", () => {
      const raw = inp.value;
      if (raw === "" || raw === null) Store.remove("ovr_slotmo_" + inp.dataset.slotmo);
      else Store.set("ovr_slotmo_" + inp.dataset.slotmo, Math.min(12, Math.max(1, +raw)));
      refreshDerived();
    }));
  }

  function loadSlotIntoAllocator(s, tm) {
    const asm = tm.asm;
    const form = getAllocForm();
    form.name = s.name;
    form.grade = s.grade;
    form.fabric = tm.cat;
    form.totalUnits = slotBuyUnits(s);
    form.stPct = Math.round(slotStFrac(s, asm) * 100);
    form.months = slotMonths(s, asm);
    setAllocForm(form);
    refreshDerived();
    setTimeout(() => { const a = $("#allocator"); if (a) a.scrollIntoView({ behavior: "smooth", block: "start" }); }, 60);
  }

  /* ----- line sheet allocator ----- */
  function getAllocForm() {
    const asm = getAssumptions(), t = getTier();
    const d = {
      name: "", family: "Red", fabric: t.fabric_category, dropId: "dec", grade: "A",
      totalUnits: asm.grade_a_units, stPct: Math.round(asm.sell_through * 100),
      months: asm.grade_a_months,
      fabricWks: asm.fabric_lead_wks, sewingWks: asm.sewing_lead_wks,
      topsPct: asm.tops_pct, bottomsPct: asm.bottoms_pct, maillotsPct: asm.maillots_pct
    };
    return Object.assign(d, Store.get("alloc_form", {}));
  }
  function setAllocForm(f) { Store.set("alloc_form", f); }

  /* Real style→type lookup from inventory cls (Tops/Bottoms/Maillots/Tankinis).
   * Style names carry size-range suffixes ("juliette a/b/c", "beach party c/d/dd")
   * which are stripped before lookup; majority vote wins on conflicting cls.
   * Keyword guessing is only a fallback for styles absent from inventory. */
  let _styleClass = null;
  function styleClassMap() {
    if (_styleClass) return _styleClass;
    _styleClass = {};
    const votes = {};
    const suf = /\s+[a-z]+(\/[a-z]+)+$/i;
    ((DATA.inventory) || []).forEach(r => {
      const cls = String(r.cls || "").toLowerCase();
      const t = cls === "tops" ? "tops"
        : cls === "bottoms" ? "bottoms"
        : (cls === "maillots" || cls === "tankinis") ? "maillots"
        : null; // Childrens / SwimCaps / Mens / unknown: no mapping
      if (!t) return;
      const key = String(r.s || "").toLowerCase().replace(suf, "").trim();
      if (!key) return;
      votes[key] = votes[key] || {};
      votes[key][t] = (votes[key][t] || 0) + 1;
    });
    Object.keys(votes).forEach(k => {
      _styleClass[k] = Object.entries(votes[k]).sort((a, b) => b[1] - a[1])[0][0];
    });
    return _styleClass;
  }

  function styleTypeGuess(style) {
    const key = String(style || "").toLowerCase().replace(/\s+[a-z]+(\/[a-z]+)+$/i, "").trim();
    const hit = key && styleClassMap()[key];
    if (hit) return hit;
    const s = String(style || "").toLowerCase();
    if (["cinch", "bambi", "brief", "bottom", "cheeky", "thong", "bikini bottom"].some(w => s.includes(w))) return "bottoms";
    if (["maillot", "one piece", "one-piece", "suit"].some(w => s.includes(w))) return "maillots";
    return "tops";
  }
  /* P(target | given): share of multi-item baskets containing `given` that also
   * contain `target`. Direction matters: pairAttach("juliette a/b/c", "it's a cinch")
   * = P(cinch | juliette) = attach_ba when the pair is stored as a=cinch, b=juliette.
   * Returns null when no pair record exists (graceful if fields are missing). */
  function pairAttach(givenStyle, targetStyle) {
    const g = String(givenStyle || ""), t = String(targetStyle || "");
    if (!g || !t || g === t) return null;
    const pairs = (DATA.affinity && DATA.affinity.pairs) || [];
    for (const p of pairs) {
      if (p.a === g && p.b === t) return p.attach_ab != null ? +p.attach_ab : null;
      if (p.b === g && p.a === t) return p.attach_ba != null ? +p.attach_ba : null;
    }
    return null;
  }
  function affinityFor(style) {
    const out = [];
    const tSelf = styleTypeGuess(style);
    // Maillots are one piece: no pairing signal is meaningful for them (two
    // maillots in one basket isn't set completion). Surface nothing.
    if (tSelf === "maillots") return out;
    (DATA.affinity.pairs || []).forEach(p => {
      let other = null, attach = null;
      if (p.a === style) { other = p.b; attach = p.attach_ab; }   // P(other | style) = P(b | a)
      else if (p.b === style) { other = p.a; attach = p.attach_ba; } // P(other | style) = P(a | b)
      if (other === null) return;
      const tOther = styleTypeGuess(other);
      if (tOther === "maillots") return; // never pair anything with a maillot
      out.push({ other, n: p.n, attach: attach != null ? +attach : null });
    });
    return out.sort((x, y) => y.n - x.n).slice(0, 5);
  }

  /* ---------- size curves + cutting viability ----------
   * Size explosion uses REAL size selling: data/size_curves.json (built from
   * actual transactions: {style: {total, sizes: {size: fraction}}}). Fallback
   * chain for styles missing there: WIP received-by-size -> inventory size
   * distribution -> even split across sizes observed for the same product
   * type in WIP. */
  let _sizeCurves = null;
  function toFracs(bySize) {
    const tot = Object.values(bySize).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(bySize).map(([size, q]) => ({ size, frac: q / tot }));
  }
  function sizeCurve(style) {
    if (!_sizeCurves) _sizeCurves = {};
    const key = String(style || "").toLowerCase().trim();
    if (_sizeCurves[key]) return _sizeCurves[key];
    const wrows = (DATA.wip && DATA.wip.rows) || [];
    let curve = null;
    // 1) real size selling from transactions
    const selling = (DATA.sizeCurves || {})[key];
    if (selling && selling.sizes) {
      const entries = Object.entries(selling.sizes).filter(([, f]) => +f > 0);
      if (entries.length) {
        const tot = entries.reduce((s, [, f]) => s + (+f), 0) || 1;
        curve = entries.map(([size, f]) => ({ size, frac: (+f) / tot }));
      }
    }
    // 2) WIP received by size
    if (!curve) {
      const bySize = {};
      wrows.forEach(r => {
        if (String(r.style || "").toLowerCase().trim() !== key) return;
        const q = +r.received || 0;
        if (q > 0) bySize[r.size] = (bySize[r.size] || 0) + q;
      });
      if (Object.keys(bySize).length) curve = toFracs(bySize);
    }
    // 3) inventory size distribution
    if (!curve) {
      const bySize = {};
      (DATA.inventory || []).forEach(r => {
        if (String(r.s || "").toLowerCase().trim() !== key) return;
        const q = +r.t || 0;
        if (q > 0) bySize[r.z] = (bySize[r.z] || 0) + q;
      });
      if (Object.keys(bySize).length) curve = toFracs(bySize);
    }
    // 4) even split across sizes observed for the same product type in WIP
    if (!curve) {
      const t = styleTypeGuess(style);
      const seen = {};
      wrows.forEach(r => {
        if (styleTypeGuess(r.style) !== t) return;
        seen[r.size] = true;
      });
      const sizes = Object.keys(seen);
      curve = sizes.map(s => ({ size: s, frac: 1 / (sizes.length || 1) }));
    }
    _sizeCurves[key] = curve || [];
    return _sizeCurves[key];
  }
  function explodeUnits(style, units) {
    const curve = sizeCurve(style);
    const U = Math.max(0, Math.round(units));
    if (!curve.length || U <= 0) return [];
    const rows = curve.map(c => ({
      size: c.size, qty: Math.floor(U * c.frac), rem: U * c.frac - Math.floor(U * c.frac)
    }));
    let left = U - rows.reduce((s, r) => s + r.qty, 0);
    rows.sort((a, b) => b.rem - a.rem);
    for (let i = 0; i < rows.length && left > 0; i++, left--) rows[i].qty++;
    const num = v => { const n = parseFloat(v); return isNaN(n) ? null : n; };
    rows.sort((a, b) => {
      const na = num(a.size), nb = num(b.size);
      if (na !== null && nb !== null) return na - nb;
      return String(a.size).localeCompare(String(b.size));
    });
    return rows;
  }
  /* Authoritative store model (user-confirmed 2026-10-05): these 6 hold stock.
   * Web Store / Web Store California are demand-only (no inventory); Bridgehampton
   * is seasonal and currently closed; Studio/Brentwood are not stores. */
  const ACTIVE_STOCK_STORES = ["Wooster", "Madison", "Marin", "Montecito", "Los Angeles", "San Francisco"];
  function activeStoreList() {
    return ACTIVE_STOCK_STORES.slice();
  }
  /* thin-ticket flag: fires only when even the LARGEST per-size allocation
   * can't cover every active store (the user doesn't need 1-per-size as a
   * hard rule — this is a check, not a blocker). */
  function coverageFlag(style, units) {
    const U = Math.round(+units || 0);
    if (!(U > 0)) return "";
    const nStores = activeStoreList().length;
    const exploded = explodeUnits(style, U);
    if (!exploded.length || !nStores) return "";
    const top = exploded.reduce((a, b) => (b.qty > a.qty ? b : a), exploded[0]);
    if (top.qty >= nStores) return "";
    return `<span class="pill warn" title="largest size allocation is below one per store">thin ticket — check store coverage</span>` +
      `<div class="faint small">${U}u → size ${esc(top.size)} gets ~${fmt(top.qty)}u across ${nStores} stores — most stores miss.</div>`;
  }
  /* compact one-line size expandables: <button class="sizes-toggle" data-style>
   * with data-sizes-units for static contexts, else reads the row's units input */
  function bindSizeToggles(host) {
    $$(".sizes-toggle", host).forEach(b => {
      b.addEventListener("click", () => {
        const cell = b.closest("td");
        const det = cell ? cell.querySelector(".sizedetail") : null;
        if (!det) return;
        let units;
        if (b.dataset.sizesUnits !== undefined && b.dataset.sizesUnits !== "") {
          units = +b.dataset.sizesUnits;
        } else {
          const tr = b.closest("tr");
          const inp = tr ? tr.querySelector("input[data-override]") : null;
          units = inp ? (+inp.value || 0) : 0;
        }
        if (det.hidden) {
          const parts = explodeUnits(b.dataset.style, units);
          det.innerHTML = parts.length
            ? parts.map(p => `${esc(p.size)}: ${fmt(p.qty)}u`).join(" · ")
            : `<span class="faint">no size curve</span>`;
        }
        det.hidden = !det.hidden;
        b.textContent = det.hidden ? "sizes ▸" : "sizes ▾";
      });
    });
  }
  function topStylesByType(type, n) {
    const totals = {};
    for (const [key, hist] of Object.entries(DATA.styleVelocity)) {
      const [style] = key.split("|");
      if (styleTypeGuess(style) !== type) continue;
      totals[style] = (totals[style] || 0) + Object.values(hist).reduce((a, b) => a + b, 0);
    }
    return Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]);
  }
  /* Split integer units across weights with largest-remainder so they sum exactly. */
  function splitUnits(weights, total) {
    const wsum = weights.reduce((a, b) => a + b, 0);
    if (!(wsum > 0) || !(total > 0)) return weights.map(() => 0);
    const rows = weights.map(w => {
      const exact = total * w / wsum;
      return { q: Math.floor(exact), rem: exact - Math.floor(exact) };
    });
    let left = total - rows.reduce((s, r) => s + r.q, 0);
    rows.sort((a, b) => b.rem - a.rem);
    for (let i = 0; i < rows.length && left > 0; i++, left--) rows[i].q++;
    return rows.map(r => r.q);
  }
  /* Attach-rate correction: reweight a type's draft units toward set-implied demand.
   * For each target style: implied = Σ over given-side rows of (given units × P(target | given)).
   * New units = 50% velocity split + 50% set-implied, renormalized to the type budget.
   * Never adds/removes styles — reweights only. No-op when no pair data exists. */
  function correctByAttach(groups, targetType, givenType) {
    const T = groups[targetType], G = groups[givenType];
    if (!T || !G || !T.styles.length || !G.styles.length || !(T.units > 0)) return;
    const implied = T.styles.map(t =>
      G.styles.reduce((s, g) => {
        const a = pairAttach(g.style, t.style);
        return s + (a != null ? g.units * a : 0);
      }, 0));
    const impSum = implied.reduce((a, b) => a + b, 0);
    if (!(impSum > 0)) return;
    const blended = T.styles.map((t, i) => 0.5 * t.units + 0.5 * (implied[i] / impSum) * T.units);
    const fixed = splitUnits(blended, T.units);
    T.styles.forEach((t, i) => { t.units = fixed[i]; });
  }
  function buildDraft(tierUnits, tp, bp, mp) {
    const groups = {};
    [["tops", Math.round(tierUnits * tp)], ["bottoms", Math.round(tierUnits * bp)],
     ["maillots", Math.round(tierUnits * mp)]].forEach(([type, units]) => {
      if (units <= 0) { groups[type] = { styles: [], units: 0 }; return; }
      const styles = topStylesByType(type, 5);
      if (!styles.length) { groups[type] = { styles: [], units, empty: true }; return; }
      const weights = styles.map((_, i) => styles.length - i);
      const assigned = splitUnits(weights, units);
      groups[type] = { styles: styles.map((s, i) => ({ style: s, units: assigned[i] })), units };
    });
    // "Not every juliette buyer buys a cinch": correct the assortment with attach
    // rates (auto-draft only — typed overrides always win at render via valOf).
    correctByAttach(groups, "bottoms", "tops");
    correctByAttach(groups, "tops", "bottoms");
    // Maillots: one piece, no pairing signal — velocity allocation only, no attach correction.
    const draft = [];
    ["tops", "bottoms", "maillots"].forEach(type => {
      const g = groups[type];
      if (g.empty) { draft.push({ style: "(no " + type + " styles found)", type, units: g.units, affinity: [] }); return; }
      g.styles.forEach(s => draft.push({ style: s.style, type, units: s.units, affinity: affinityFor(s.style).slice(0, 3) }));
    });
    return draft;
  }
  /* Recut hole analysis — grounded in actual cut history (user rule: never
   * recommend "restocking" a style+color that was never cut).
   * - If the color matches WIP: "Original cut" = received units per style from
   *   the WIP linesheet; hole = max(0, received − available − on_order). Only
   *   styles actually cut in this color appear.
   * - If no WIP match: falls back to the generic velocity draft, labeled
   *   "Suggested (no cut history)" — new-cut suggestions, not restocks.
   * Urgent list prefers stockout alerts in the recut color, else global top. */
  function computeHoles(colorName, tierUnits, tp, bp, mp, rows) {
    const avail = {};
    const stockSet = new Set(ACTIVE_STOCK_STORES.map(s => String(s).toLowerCase().trim()));
    rows.forEach(r => {
      let q = 0;
      Object.entries(r.st || {}).forEach(([store, qty]) => {
        if (stockSet.has(String(store).toLowerCase().trim())) q += (+qty || 0);
      });
      const sk = normColor(r.s);
      avail[sk] = (avail[sk] || 0) + q;
    });
    const colorNorm = normColor(colorName);
    let urgentPool = DATA.alerts.filter(a => a.status === "stockout_demand" && normColor(a.color) === colorNorm);
    const urgentInColor = urgentPool.length > 0;
    if (!urgentInColor) urgentPool = DATA.alerts.filter(a => a.status === "stockout_demand");
    const urgent = urgentPool.slice(0, 8)
      .map(a => `${a.style} (${a.color}, size ${a.size})`);
    const wipMatch = matchWipColor(colorName);
    const sheet = wipMatch ? wipLinesheet(wipMatch.norm) : [];
    if (sheet.length) {
      let total = 0;
      const perStyle = sheet.map(w => {
        const a = avail[normColor(w.style)] || 0;
        const cut = w.received || 0, oo = w.on_order || 0;
        const hole = Math.max(0, cut - a - oo);
        total += hole;
        return { style: w.style, cut, onOrder: oo, avail: a, hole };
      });
      return { total, perStyle, urgent, urgentInColor, wipBased: true };
    }
    const draft = buildDraft(tierUnits, tp, bp, mp);
    let total = 0;
    const perStyle = draft.map(d => {
      const a = avail[normColor(d.style)] || 0;
      const hole = Math.max(0, d.units - a);
      total += hole;
      return { style: d.style, planned: d.units, avail: a, hole };
    });
    return { total, perStyle, urgent, urgentInColor, wipBased: false };
  }

  let _lastDraft = null;

  /* affinity cell: top pairing partner front and center with its attach rate,
   * rest as footnote. attach = P(partner | this style's baskets). */
  function affCell(aff, style) {
    if (!aff || !aff.length) return `<span class="faint">—</span>`;
    const [top, ...rest] = aff;
    const pct = top.attach != null ? ` · ${Math.round(top.attach * 100)}% of ${esc(style)} baskets include it` : "";
    const foot = a => `${esc(a.other)} (${a.n}${a.attach != null ? `, ${Math.round(a.attach * 100)}%` : ""})`;
    return `<div class="aff-top"><span class="afftag">affinity</span>Pairs with <b>${esc(top.other)}</b> · ${top.n} baskets${pct}</div>` +
      (rest.length ? `<div class="small faint">also ${rest.map(foot).join(" · ")}</div>` : "");
  }

  /* timeline strip: makes "months in store" unmissable — every date derives from it */
  function renderTimeline(tm, scope) {
    const host = scope ? $("#al-timeline", scope) : $("#al-timeline");
    if (!host) return;
    const f = getAllocForm(), asm = tm.asm;
    const drop = DATA.meta.drops.find(d => d.id === f.dropId) || DATA.meta.drops[0];
    const inStore = drop.in_store;
    const fw = +f.fabricWks || 0, sw = +f.sewingWks || 0, tr = asm.transit_wks || 0;
    const mo = +f.months || 4;
    const fab = addWeeks(inStore, -(fw + sw + tr));
    const sew = addWeeks(inStore, -(sw + tr));
    const so = cwSellOut(inStore, mo);
    const ho = addDays(so, -14);
    host.innerHTML = `<div class="timeline">
      <div class="tchip"><span class="mlabel">Fabric order</span><b>${fmtDate(fab)}</b></div><span class="tarrow">→</span>
      <div class="tchip"><span class="mlabel">Sewing launch</span><b>${fmtDate(sew)}</b></div><span class="tarrow">→</span>
      <div class="tchip"><span class="mlabel">In store</span><b>${fmtDate(inStore)}</b></div><span class="tarrow">→</span>
      <div class="tchip hot"><span class="mlabel">${mo} mo in store</span><b>Handoff ${fmtDate(ho)}</b></div><span class="tarrow">→</span>
      <div class="tchip hot"><span class="mlabel">Sell-out</span><b>${fmtDate(so)}</b></div>
    </div>`;
  }

  function allocatorCard(root, tm) {
    const asm = tm.asm, f = getAllocForm();
    const el = document.createElement("div");
    el.className = "card";
    el.id = "allocator";
    const gradeOpts = [["A", tm.aU], ["B", tm.bU], ["C", tm.cU]].map(([g, u]) =>
      `<option value="${g}" ${f.grade === g ? "selected" : ""}>Grade ${g} · ${fmt(u)}u</option>`).join("");
    const fams = ["Red", "Blue", "Green", "Purple", "Pink", "Yellow", "Orange", "Brown", "Black", "White", "Neutral", "Print", "Multi"];
    el.innerHTML = `<h2>Line sheet allocator</h2>
      <p class="lede">Draft seeded by basket affinity — styles are ranked by what actually sells together in the same receipt. Each row shows its top pairing partners so you can balance the set.</p>
      <div class="formgrid" style="grid-template-columns:repeat(5,minmax(0,1fr))">
        <label class="f">New colorway <input type="text" id="al-name" value="${esc(f.name)}" placeholder="e.g. monterrico blue"></label>
        <label class="f">Color family <select id="al-fam">${fams.map(c =>
          `<option ${f.family === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
        <label class="f">Fabric <select id="al-fab">${["Matte", "Shiny", "Novelty", "Print"].map(c =>
          `<option ${f.fabric === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
        <label class="f">Drop <select id="al-drop">${DATA.meta.drops.map(d =>
          `<option value="${d.id}" ${f.dropId === d.id ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label>
        <label class="f">Color grade <select id="al-grade">${gradeOpts}</select></label>
      </div>
      <div class="formgrid" style="grid-template-columns:repeat(5,minmax(0,1fr));margin-top:14px">
        <label class="f">Buy units <input type="number" id="al-units" value="${f.totalUnits}" min="0" step="10"></label>
        <label class="f">Sell-through % <input type="number" id="al-st" value="${f.stPct}" min="5" max="200" step="1"></label>
        <label class="f">Months <input type="number" id="al-mo" value="${f.months}" min="1" max="12" step="1"></label>
        <label class="f">Fabric wks <input type="number" id="al-fw" value="${f.fabricWks}" min="1" max="20"></label>
        <label class="f">Sewing wks <input type="number" id="al-sw" value="${f.sewingWks}" min="1" max="20"></label>
      </div>
      <div class="formgrid" style="grid-template-columns:repeat(5,minmax(0,1fr));margin-top:14px">
        <label class="f">Tops % <input type="number" id="al-tp" value="${f.topsPct}" min="0" max="100"></label>
        <label class="f">Bottoms % <input type="number" id="al-bp" value="${f.bottomsPct}" min="0" max="100"></label>
        <label class="f">Maillots % <input type="number" id="al-mp" value="${f.maillotsPct}" min="0" max="100"></label>
      </div>
      <div class="alloc-head">
        <p class="affinity-note" id="al-note"></p>
        <button class="btn" id="al-save">Add colorway to session plan</button>
      </div>
      <div id="al-timeline"></div>
      <div class="addstyle">
        <label class="f">Add a style by name <input type="text" id="as-name" placeholder="style name"></label>
        <label class="f">Type <select id="as-type"><option value="tops">Tops</option><option value="bottoms">Bottoms</option><option value="maillots">Maillots</option></select></label>
        <label class="f">Units <input type="number" id="as-units" value="50" min="0"></label>
        <div><button class="btn ghost" id="as-add">Add style</button></div>
      </div>
      <div class="sessionbox" id="session-plan"></div>
      <div id="ls-output"></div>`;
    root.appendChild(el);

    const upd = () => {
      const nf = {
        name: $("#al-name", el).value, family: $("#al-fam", el).value, fabric: $("#al-fab", el).value,
        dropId: $("#al-drop", el).value, grade: $("#al-grade", el).value,
        totalUnits: +$("#al-units", el).value || 0, stPct: +$("#al-st", el).value || 70,
        months: +$("#al-mo", el).value || 4,
        fabricWks: +$("#al-fw", el).value || 0, sewingWks: +$("#al-sw", el).value || 0,
        topsPct: +$("#al-tp", el).value || 0, bottomsPct: $("#al-bp", el).value === "" ? 0 : +$("#al-bp", el).value,
        maillotsPct: $("#al-mp", el).value === "" ? 0 : +$("#al-mp", el).value
      };
      // grade change re-seeds tier target + months from grade defaults
      if (nf.grade !== f.grade) {
        nf.totalUnits = nf.grade === "A" ? tm.aU : nf.grade === "B" ? tm.bU : tm.cU;
        nf.months = asm["grade_" + nf.grade.toLowerCase() + "_months"];
        $("#al-units", el).value = nf.totalUnits;
        $("#al-mo", el).value = nf.months;
      }
      setAllocForm(nf);
      renderDraft(tm);
    };
    ["al-name", "al-fam", "al-fab", "al-drop", "al-grade", "al-units", "al-st", "al-mo",
     "al-fw", "al-sw", "al-tp", "al-bp", "al-mp"].forEach(id => {
      $("#" + id, el).addEventListener("change", upd);
      $("#" + id, el).addEventListener("input", e => {
        if (id === "al-name") { const nf = getAllocForm(); nf.name = e.target.value; setAllocForm(nf); renderDraft(tm); }
      });
    });

    $("#as-add", el).addEventListener("click", () => {
      const nm = $("#as-name", el).value.trim().toLowerCase();
      if (!nm) return;
      const form = getAllocForm();
      const key = "alloc_" + cwNameKey(form.name || "unnamed");
      const extra = Store.get(key + "_extra", []);
      extra.push({ style: nm, units: +$("#as-units", el).value || 0, type: $("#as-type", el).value });
      Store.set(key + "_extra", extra);
      $("#as-name", el).value = "";
      renderDraft(tm);
    });
    $("#al-save", el).addEventListener("click", () => saveColorway(tm));

    renderSessionBox(el, tm);
    renderDraft(tm, el);
  }

  function draftNameKey() {
    const f = getAllocForm();
    return "alloc_" + cwNameKey(f.name || "unnamed");
  }

  function renderDraft(tm, scope) {
    const host = scope ? $("#ls-output", scope) : $("#ls-output");
    if (!host) return;
    const asm = tm.asm, f = getAllocForm();
    renderTimeline(tm, scope);
    const rawName = (f.name || "").trim();
    const name = rawName.toLowerCase();
    const key = draftNameKey();
    const stFrac = (+f.stPct || 70) / 100;
    const tierUnits = Math.max(0, Math.round(+f.totalUnits || 0));
    if (!name) {
      host.innerHTML = `<p class="hint">Name a colorway above to build its line sheet draft.</p>`;
      setAllocNote(tm, f, tierUnits, stFrac, 0, false, undefined, scope);
      _lastDraft = null;
      return;
    }
    const tp = (+f.topsPct || 0) / 100, bp = (+f.bottomsPct || 0) / 100, mp = (+f.maillotsPct || 0) / 100;

    // recut detection
    const excluded = new Set([...DATA.meta.pull_list_colors, ...DATA.meta.dead_colors]);
    const existingRows = DATA.inventory.filter(e => e.c === name && !excluded.has(e.c));
    const isRecut = existingRows.length > 0;
    let recutHoles = null, holeTarget = tierUnits;
    if (isRecut) {
      recutHoles = computeHoles(name, tierUnits, tp, bp, mp, existingRows);
      holeTarget = recutHoles.total;
    }
    const buyUnits = holeTarget;

    // WIP linesheet pull: a pulled linesheet replaces the affinity draft rows
    const wipMatch = matchWipColor(rawName);
    const wipPulled = Store.get(key + "_wip", null);
    const useWip = !!(wipMatch && Array.isArray(wipPulled) && wipPulled.length);
    const rows = [];
    if (useWip) {
      wipPulled.forEach((w, i) => rows.push({
        style: w.style, type: w.type || "tops", units: w.units,
        affinity: affinityFor(w.style).slice(0, 3),
        oid: key + "_w" + i, wip: true, wi: i,
        received: w.received || 0, on_order: w.on_order || 0, pos: w.pos || {}
      }));
    } else {
      const draft = buildDraft(buyUnits, tp, bp, mp);
      const removed = new Set(Store.get(key + "_removed", []));
      draft.forEach((d, i) => {
        if (removed.has(i)) return;
        rows.push({ style: d.style, type: d.type, units: d.units, affinity: d.affinity, oid: key + "_s" + i, extra: false });
      });
    }
    const extras = Store.get(key + "_extra", []);
    extras.forEach((x, xi) => rows.push({ style: x.style, type: x.type || "tops", units: x.units, affinity: affinityFor(x.style).slice(0, 3), oid: key + "_x" + xi, extra: true, xi }));

    const targets = { tops: Math.round(buyUnits * tp), bottoms: Math.round(buyUnits * bp), maillots: Math.round(buyUnits * mp) };
    const valOf = r => { const v = Store.get("ovr_" + r.oid, null); return (v === null || v === "" || v === undefined) ? r.units : +v; };

    let html = "";
    if (isRecut) {
      const holeExp = cwExpected(buyUnits, stFrac);
      html += `<div class="recutflag">RECUT — "${esc(rawName)}" exists in stock. Hole target ${fmt(holeTarget)}u = buy ${fmt(buyUnits)}u → ${fmt(holeExp.sales)} expected sales @ ${Math.round(stFrac * 100)}%.</div>
      <details class="hole" open><summary>Hole analysis (${recutHoles.wipBased ? "original cut" : "suggested"} vs available)</summary><div class="body">
      ${recutHoles.wipBased ? "" : `<p class="small faint" style="margin:0 0 8px">No cut history found for this color — these are new-cut suggestions, not restocks.</p>`}
      <table class="holetable"><tr><th>Style</th>${recutHoles.wipBased ? `<th class="num">Original cut</th><th class="num">On order</th>` : `<th class="num">Suggested (no cut history)</th>`}<th class="num">Available</th><th class="num">Hole</th></tr>
      ${recutHoles.perStyle.map(p => `<tr><td>${esc(p.style)}</td>${recutHoles.wipBased ? `<td class="num">${fmt(p.cut)}</td><td class="num">${fmt(p.onOrder)}</td>` : `<td class="num">${fmt(p.planned)}</td>`}<td class="num">${fmt(p.avail)}</td><td class="num"><b>${fmt(p.hole)}</b></td></tr>`).join("")}
      </table>
      ${recutHoles.urgent.length ? `<p class="small" style="margin-top:10px"><b>${recutHoles.urgentInColor ? "Also urgent in this color:" : "Also urgent elsewhere:"}</b> ${recutHoles.urgent.slice(0, 5).map(esc).join("; ")}</p>` : ""}
      </div></details>`;
    }
    // WIP linesheet pull banner (coexists with recut flag — both are shown when both apply)
    if (wipMatch) {
      const ws = wipSummary(wipMatch.norm);
      const poKeys = Object.keys(ws.pos);
      if (useWip) {
        html += `<div class="wipflag pulled"><div class="wipflag-text"><b>WIP linesheet</b> — pulled ${wipPulled.length} styles from WIP color "${esc(wipMatch.display)}". Edit units freely; typed values stick.</div><button class="linkbtn" id="wip-clear">clear, use affinity draft</button></div>`;
      } else if (ws.styles > 0) {
        const poList = poKeys.slice(0, 5).map(po =>
          `${esc(po)}${ws.pos[po] ? " · " + fmtDate(ws.pos[po]) : ""}`).join("; ");
        const more = poKeys.length > 5 ? ` <span class="faint">+${poKeys.length - 5} more</span>` : "";
        html += `<div class="wipflag"><div class="wipflag-text"><b>Found in WIP</b> — matched color "${esc(wipMatch.display)}": <b>${ws.styles} styles</b> · ${fmt(ws.received)} received + ${fmt(ws.on_order)} on order · across ${poKeys.length} PO${poKeys.length === 1 ? "" : "s"} (${poList}${more})</div><button class="btn sm" id="wip-pull">Pull linesheet from WIP</button></div>`;
      } else {
        html += `<div class="wipflag"><div class="wipflag-text">Matched WIP color "${esc(wipMatch.display)}" — no received/on-order quantities to pull.</div></div>`;
      }
    }
    // affinity headline: strongest pairs inside this draft, front and center
    // (skipped when showing a pulled WIP linesheet)
    if (!useWip) {
    const pairSeen = new Set(), pairList = [];
    rows.forEach(r => (r.affinity || []).forEach(a => {
      const k = [r.style, a.other].sort().join("");
      if (!pairSeen.has(k)) { pairSeen.add(k); pairList.push({ a: r.style, b: a.other, n: a.n, attach: a.attach }); }
    }));
    pairList.sort((x, y) => y.n - x.n);
    const topPairs = pairList.slice(0, 3);
    if (topPairs.length) {
      html += `<div class="aff-lede">Affinity-seeded draft — strongest pairs in this colorway: ` +
        topPairs.map(p => `<b>${esc(p.a)} + ${esc(p.b)}</b> (${p.n} baskets` +
          (p.attach != null ? `, ${Math.round(p.attach * 100)}% attach` : "") + `)`).join(" · ") +
        (topPairs.some(p => p.attach != null)
          ? ` <span class="faint small">— attach = share of the first style's baskets that also include the partner</span>` : "") +
        `</div>`;
    }
    } // end if (!useWip)
    ["tops", "bottoms", "maillots"].forEach(type => {
      const trs = rows.filter(r => r.type === type);
      if (!trs.length && targets[type] <= 0) return;
      const alloc = trs.reduce((s, r) => s + valOf(r), 0);
      html += `<div class="alloc-sec">${type} · ${fmt(alloc)} allocated / ${fmt(targets[type])} ratio target</div>
      <table><tr><th>Style</th><th>Type</th><th class="num">Units</th><th>Affinity signal</th><th></th></tr>
      ${trs.map(r => `<tr>
        <td>${esc(r.style)}${r.wip ? `<div class="small faint">${fmt(r.received)} received + ${fmt(r.on_order)} on order · PO ${esc(Object.keys(r.pos || {}).join(", "))}</div>` : ""}<div><button class="linkbtn sm sizes-toggle" data-style="${esc(r.style)}">sizes ▸</button></div><div class="sizedetail" hidden></div></td><td class="muted small">${esc(r.type)}</td>
        <td class="num">${unitField(r.oid, r.units, 'style="width:84px;text-align:right"')}<div class="covflag" data-covstyle="${esc(r.style)}" data-covoid="${esc(r.oid)}">${coverageFlag(r.style, valOf(r))}</div></td>
        <td>${affCell(r.affinity, r.style)}</td>
        <td><button class="linkbtn" data-rm="${esc(r.oid)}" title="Remove style">×</button></td></tr>`).join("")}
      </table>`;
    });
    html += `<p class="hint">Removed styles stay removed; typed units never recalculate away.</p>`;
    host.innerHTML = html;

    bindOverrides(host); // no refreshDerived inside #ls-output (guard in data.js)
    bindSizeToggles(host);
    const wipPullBtn = $("#wip-pull", host);
    if (wipPullBtn) wipPullBtn.addEventListener("click", () => {
      const sheet = wipLinesheet(wipMatch.norm).map(s => ({
        style: s.style, type: s.type, units: s.units,
        received: s.received, on_order: s.on_order, pos: s.pos
      }));
      Store.set(key + "_wip", sheet);
      renderDraft(tm);
    });
    const wipClearBtn = $("#wip-clear", host);
    if (wipClearBtn) wipClearBtn.addEventListener("click", () => {
      Store.remove(key + "_wip");
      renderDraft(tm);
    });
    const recount = () => {
      const alloc = rows.reduce((s, r) => s + valOf(r), 0);
      setAllocNote(tm, f, tierUnits, stFrac, alloc, isRecut, buyUnits, scope,
                   useWip ? wipMatch.display : null);
      // keep cutting-viability flags live as units are typed
      $$(".covflag", host).forEach(sp => {
        const inp = host.querySelector('input[data-override="' + sp.dataset.covoid + '"]');
        sp.innerHTML = coverageFlag(sp.dataset.covstyle, inp ? (+inp.value || 0) : 0);
      });
    };
    $$("input[data-override]", host).forEach(inp => inp.addEventListener("input", recount));
    $$("button[data-rm]", host).forEach(b => b.addEventListener("click", () => {
      const oid = b.dataset.rm;
      const sm = oid.match(/_s(\d+)$/);
      const xm = oid.match(/_x(\d+)$/);
      const wm = oid.match(/_w(\d+)$/);
      if (sm) {
        const rem = new Set(Store.get(key + "_removed", []));
        rem.add(+sm[1]); Store.set(key + "_removed", [...rem]);
      } else if (xm) {
        const ex = Store.get(key + "_extra", []); ex.splice(+xm[1], 1); Store.set(key + "_extra", ex);
      } else if (wm) {
        const w = Store.get(key + "_wip", []); w.splice(+wm[1], 1); Store.set(key + "_wip", w);
      }
      renderDraft(tm);
    }));

    _lastDraft = { rows, valOf, buyUnits, tierUnits, stFrac, rawName, name, key, isRecut };
    recount();
  }

  function setAllocNote(tm, f, tierUnits, stFrac, allocated, isRecut, buyUnits, scope, wipMode) {
    const n = scope ? $("#al-note", scope) : $("#al-note");
    if (!n) return;
    const gpct = Math.round(tm.asm.sell_through * 100), spct = Math.round(stFrac * 100);
    const buy = (buyUnits !== undefined) ? buyUnits : Math.max(0, Math.round(+f.totalUnits || 0));
    const exp = cwExpected(buy, stFrac);
    n.textContent = `Expected sell-through ${spct}% (default ${gpct}%): ${fmt(buy)}u buy → ${fmt(exp.sales)} expected sales, ${fmt(exp.leftover)} planned leftover. ` +
      (wipMode ? `Linesheet pulled from WIP color "${wipMode}". ` : `Affinity starts the draft; manual style and unit overrides are active. `) +
      `${fmt(allocated)} of ${fmt(buy)} units allocated.` +
      (isRecut ? " Recut hole target shown." : "");
  }

  function renderSessionBox(scopeEl, tm) {
    const box = $("#session-plan", scopeEl) || $("#session-plan");
    if (!box) return;
    const items = [];
    DATA.meta.drops.forEach(d => {
      (Store.get("drop_colors_" + d.id, []) || []).forEach((c, i) => items.push({ drop: d, c, i }));
    });
    if (!items.length) {
      box.className = "sessionbox";
      box.innerHTML = `No new seasonal colorways added yet.`;
      return;
    }
    box.className = "sessionbox has";
    box.innerHTML = items.map(({ drop, c, i }) => {
      const nk = cwNameKey(c.name);
      const st = cwStFrac(nk, drop.id, (c.st !== undefined ? c.st : tm.asm.sell_through));
      const mo = cwMonths(nk, drop.id, (c.months !== undefined ? c.months : tm.asm["grade_" + String(c.grade).toLowerCase() + "_months"] || 4));
      const tu = (c.units !== undefined ? c.units : 0);
      const buy = cwBuyUnitsEntry(c, drop.id);
      const exp = cwExpected(buy, st);
      return `<div class="sessrow"><span class="gbadge ${esc(c.grade)}" style="width:24px;height:24px;font-size:11px">${esc(c.grade)}</span>
        <div><b>${esc(c.name)}</b> <span class="muted small">· ${esc(drop.name)} · ${fmt(buy)}u buy, expect ${Math.round(st * 100)}% → ${fmt(exp.sales)} sales · ${mo} mo</span></div>
        <button class="linkbtn x" data-sessrm="${drop.id}:${i}">×</button></div>`;
    }).join("");
    $$("button[data-sessrm]", box).forEach(b => b.addEventListener("click", () => {
      const [did, idx] = b.dataset.sessrm.split(":");
      const arr = Store.get("drop_colors_" + did, []);
      arr.splice(+idx, 1);
      Store.set("drop_colors_" + did, arr);
      refreshDerived();
    }));
  }

  function saveColorway(tm) {
    const f = getAllocForm();
    const rawName = (f.name || "").trim();
    if (!rawName) { alert("Name the colorway first."); return; }
    const nk = cwNameKey(rawName);
    const stFrac = (+f.stPct || 70) / 100;
    const months = +f.months || 4;
    const tierUnits = Math.max(0, Math.round(+f.totalUnits || 0));
    const buy = (_lastDraft && _lastDraft.key === draftNameKey()) ? _lastDraft.buyUnits : tierUnits;
    Store.set("ovr_cwst_" + nk + "_" + f.dropId, stFrac);
    Store.set("ovr_cwmo_" + nk + "_" + f.dropId, months);
    Store.set("ovr_cwbuy_" + nk + "_" + f.dropId, buy);
    const styles = (_lastDraft ? _lastDraft.rows : []).map(r => ({
      style: r.style, type: r.type, units: _lastDraft.valOf(r)
    }));
    const arr = Store.get("drop_colors_" + f.dropId, []);
    arr.push({ name: rawName, grade: f.grade, units: tierUnits, buy, st: stFrac, months,
               family: f.family, fabric: f.fabric, styles });
    Store.set("drop_colors_" + f.dropId, arr);
    refreshDerived();
  }

  /* ----- drop cards: rotation plan with assigned colorways + ST reconciliation ----- */
  function dropCardsSection(root, tm) {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<h2>Rotation plan — drops</h2>
      <p class="lede">Drop buy = seasonal demand ÷ ${Math.round(tm.asm.sell_through * 100)}% sell-through (aggregate anchor).
      Each assigned colorway has its own buy and expected sell-through — total expected sales reconciles against projected demand.
      Manual entries always win.</p>
      <div class="dropgrid" id="dropgrid"></div>`;
    root.appendChild(el);
    const grid = $("#dropgrid", el);
    tm.calcs.forEach(({ drop, m }) => {
      const assigned = Store.get("drop_colors_" + drop.id, []) || [];
      let cwBuySum = 0, cwSalesSum = 0, cwLeftSum = 0;
      const cwRows = assigned.map((c, i) => {
        const nk = cwNameKey(c.name);
        const stFb = (c.st !== undefined ? c.st : tm.asm.sell_through);
        const moFb = (c.months !== undefined ? c.months : tm.asm["grade_" + String(c.grade).toLowerCase() + "_months"] || 4);
        const st = cwStFrac(nk, drop.id, stFb);
        const mo = cwMonths(nk, drop.id, moFb);
        const tu = (c.units !== undefined && c.units !== null) ? +c.units : 0;
        const buy = cwBuyUnitsEntry(c, drop.id);
        const exp = cwExpected(buy, st);
        cwBuySum += buy; cwSalesSum += exp.sales; cwLeftSum += exp.leftover;
        const so = cwSellOut(m.inStore, mo);
        return { c, i, nk, st, mo, tu, buy, exp, so };
      });
      const salesDiff = cwSalesSum - m.demand;
      const card = document.createElement("div");
      card.className = "card";
      card.style.marginBottom = "0";
      card.innerHTML = `
        <h3 style="margin-top:0">${esc(drop.name)}
          <span class="pill info">${m.winMonths.length}-mo window</span>
          ${m.overCap ? `<span class="pill bad">over factory capacity</span>` : ""}</h3>
        <div class="kv4">
          <div class="kv"><div class="k">Projected demand</div><div class="v">${fmt(m.demand)}</div>
            <div class="n">same months last year × growth</div></div>
          <div class="kv"><div class="k">Drop buy (anchor)</div><div class="v">${unitField("buy_" + drop.id, m.buy, 'style="width:110px;font-size:20px;font-weight:800;text-align:right"')}</div>
            <div class="n">demand ÷ ${Math.round(tm.asm.sell_through * 100)}% · manual sticks</div></div>
          <div class="kv"><div class="k">Colorway exp. sales</div><div class="v">${fmt(cwSalesSum)}</div>
            <div class="n">vs demand ${fmt(m.demand)} (${salesDiff >= 0 ? "+" : ""}${fmt(salesDiff)})</div></div>
          <div class="kv"><div class="k">In store</div><div class="v" style="font-size:17px">${fmtDate(m.inStore)}</div>
            <div class="n">sell out ~${fmtDate(m.sellOut)}</div></div>
        </div>
        <div class="n" style="margin:2px 0 10px">Colorway mix: buy Σ <b>${fmt(cwBuySum)}u</b> → expected sales <b>${fmt(cwSalesSum)}u</b>, planned leftover <b>${fmt(cwLeftSum)}u</b> · drop buy anchor <b>${fmt(m.buy)}u</b></div>
        <div class="k"><b>Key dates</b></div>
        <div class="n" style="margin:4px 0 8px">fabric order <b>${fmtDate(m.fabricOrder)}</b> ·
          sewing launch <b>${fmtDate(m.sewingLaunch)}</b> · handoff <b>${fmtDate(m.handoff)}</b></div>
        <div class="k"><b>Factory receipt ramp</b> <span class="muted small">(cap ${fmt(tm.asm.factory_cap_month)}/mo)</span></div>
        <div class="ramp">${m.ramp.map(r => `<span class="pill ${r.qty > tm.asm.factory_cap_flag ? "bad" : "ok"}">${r.ym}: ${fmt(r.qty)}</span>`).join(" ")}</div>
        <div class="k" style="margin-top:10px"><b>Assigned colorways ${assigned.length ? `(${assigned.length})` : ""}</b></div>
        ${cwRows.length ? `<table style="margin-top:6px"><tr><th>Colorway</th><th>Gr</th><th class="num">Tier</th>
          <th class="num">Buy</th><th class="num">ST%</th><th class="num">Mo in store</th><th class="num">Exp sales</th><th class="num">Leftover</th><th>Sell-out</th><th></th></tr>
          ${cwRows.map(r => `<tr>
            <td><b>${esc(r.c.name)}</b>${r.c.family ? ` <span class="muted small">${esc(r.c.family)} · ${esc(r.c.fabric || "")}</span>` : ""}</td>
            <td><span class="gbadge ${esc(r.c.grade)}" style="width:24px;height:24px;font-size:11px">${esc(r.c.grade)}</span></td>
            <td class="num">${fmt(r.tu)}</td>
            <td class="num"><input type="number" data-cwbuy="${drop.id}|${esc(r.nk)}" value="${r.buy}" min="0" step="10" style="width:76px;text-align:right" title="Buy units"></td>
            <td class="num"><input type="number" data-cwst="${drop.id}|${esc(r.nk)}" value="${Math.round(r.st * 100)}" min="5" max="200" step="1" style="width:64px;text-align:right" title="Expected sell-through %"></td>
            <td class="num"><input type="number" data-cwmo="${drop.id}|${esc(r.nk)}" value="${r.mo}" min="1" max="12" step="1" style="width:56px;text-align:right" title="Months in store"></td>
            <td class="num">${fmt(r.exp.sales)}</td>
            <td class="num muted">${fmt(r.exp.leftover)}</td>
            <td><b>${fmtDate(r.so)}</b><div class="faint small">${r.mo} mo</div></td>
            <td><button class="linkbtn" data-unassign="${drop.id}:${r.i}" title="Remove">×</button></td></tr>`).join("")}
          </table>` :
          `<p class="empty">None yet — build one in the line sheet allocator above.</p>`}`;
      grid.appendChild(card);
    });
    bindOverrides(grid);
    $$("input[data-cwbuy]", grid).forEach(inp => inp.addEventListener("change", () => {
      const [did, nk] = inp.dataset.cwbuy.split("|");
      const raw = inp.value;
      if (raw === "" || raw === null) Store.remove("ovr_cwbuy_" + nk + "_" + did);
      else Store.set("ovr_cwbuy_" + nk + "_" + did, Math.max(0, Math.round(+raw)));
      refreshDerived();
    }));
    $$("input[data-cwst]", grid).forEach(inp => inp.addEventListener("change", () => {
      const [did, nk] = inp.dataset.cwst.split("|");
      const raw = inp.value;
      if (raw === "" || raw === null) Store.remove("ovr_cwst_" + nk + "_" + did);
      else Store.set("ovr_cwst_" + nk + "_" + did, Math.min(2, Math.max(0.05, +raw / 100)));
      refreshDerived();
    }));
    $$("input[data-cwmo]", grid).forEach(inp => inp.addEventListener("change", () => {
      const [did, nk] = inp.dataset.cwmo.split("|");
      const raw = inp.value;
      if (raw === "" || raw === null) Store.remove("ovr_cwmo_" + nk + "_" + did);
      else Store.set("ovr_cwmo_" + nk + "_" + did, Math.min(12, Math.max(1, +raw)));
      refreshDerived();
    }));
    $$("button[data-unassign]", grid).forEach(b => b.addEventListener("click", () => {
      const [did, idx] = b.dataset.unassign.split(":");
      const arr = Store.get("drop_colors_" + did, []);
      arr.splice(+idx, 1);
      Store.set("drop_colors_" + did, arr);
      refreshDerived();
    }));
  }

  /* ----- style coverage: YoY need vs on hand vs planned (net) -----
   * One row per style. Need = same calendar months last year (Dec 2026–Nov 2027
   * planning window) × growth ÷ sell-through. On hand nets out sample-sale
   * colors/locations and Bridgehampton. Planned = sum across saved colorways.
   * Net gap = need − on hand − planned. */
  function styleCoverageCard(root, tm) {
    const asm = tm.asm;
    const normKey = s => String(s == null ? "" : s).toLowerCase().trim();
    const wins = DATA.meta.drops.map(d => d.window);
    const planMonths = monthsBetween(wins[0][0], wins[wins.length - 1][wins[wins.length - 1].length - 1]);
    const priorMonths = planMonths.map(ym => (parseInt(ym.slice(0, 4), 10) - 1) + ym.slice(4));
    const growthF = 1 + (asm.growth_pct || 0) / 100;
    const stDef = asm.sell_through || 0.7;

    const labelOf = {};
    const yoyByStyle = {};
    Object.entries(DATA.styleVelocity || {}).forEach(([key, hist]) => {
      const style = key.split("|")[0];
      const nk = normKey(style);
      if (!labelOf[nk]) labelOf[nk] = String(style).trim();
      let u = 0;
      priorMonths.forEach(ym => { u += (+hist[ym] || 0); });
      yoyByStyle[nk] = (yoyByStyle[nk] || 0) + u;
    });

    const colorExcluded = new Set([...(DATA.meta.pull_list_colors || []), ...(DATA.meta.dead_colors || [])].map(normKey));
    const stockSet = new Set(ACTIVE_STOCK_STORES.map(normKey));
    const onHand = {};
    (DATA.inventory || []).forEach(r => {
      if (colorExcluded.has(normKey(r.c))) return;
      const nk = normKey(r.s);
      if (!labelOf[nk]) labelOf[nk] = String(r.s || "").trim();
      let q = 0;
      Object.entries(r.st || {}).forEach(([store, qty]) => {
        if (stockSet.has(normKey(store))) q += (+qty || 0);
      });
      onHand[nk] = (onHand[nk] || 0) + q;
    });

    const planned = {};
    DATA.meta.drops.forEach(d => {
      (Store.get("drop_colors_" + d.id, []) || []).forEach(c => {
        (c.styles || []).forEach(s => {
          const nk = normKey(s.style);
          if (!labelOf[nk]) labelOf[nk] = String(s.style || "").trim();
          planned[nk] = (planned[nk] || 0) + (+s.units || 0);
        });
      });
    });

    const rows = [];
    new Set([...Object.keys(yoyByStyle), ...Object.keys(onHand), ...Object.keys(planned)]).forEach(nk => {
      const hasHist = nk in yoyByStyle;
      const need = hasHist ? Math.round((yoyByStyle[nk] || 0) * growthF / stDef) : null;
      const oh = Math.round(onHand[nk] || 0);
      const pl = Math.round(planned[nk] || 0);
      const netGap = need === null ? null : need - oh - pl;
      let status;
      if (need === null) status = `<span class="pill info">new style</span>`;
      else if (netGap > 0) status = `<span class="pill ${netGap / need > 0.25 ? "bad" : "warn"}">short ${fmt(netGap)}</span>`;
      else status = `<span class="pill ok">covered</span>`;
      rows.push({ nk, label: labelOf[nk] || nk, need, oh, pl, netGap, status });
    });
    rows.sort((a, b) => {
      const ga = a.netGap === null ? -Infinity : a.netGap;
      const gb = b.netGap === null ? -Infinity : b.netGap;
      if (gb !== ga) return gb - ga;
      return (b.need === null ? -1 : b.need) - (a.need === null ? -1 : a.need);
    });

    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<h2>Style coverage</h2>
      <p class="lede">Need = same months last year × growth ÷ sell-through · Net gap = need − on hand − planned across your saved colorways.</p>
      <p><input type="text" id="cov-q" placeholder="Find a style" style="width:240px"></p>
      <div style="max-height:520px;overflow:auto"><table id="cov-table">
      <tr><th>Style</th><th class="num">Need</th><th class="num">On hand</th><th class="num">Planned</th><th class="num">Net gap</th><th>Status</th></tr>
      ${rows.map(r => `<tr data-s="${esc(r.label.toLowerCase())}">
        <td><b>${esc(r.label)}</b>${r.netGap > 0 ? ` <button class="linkbtn sm sizes-toggle" data-style="${esc(r.label)}" data-sizes-units="${r.netGap}">sizes ▸</button><div class="sizedetail" hidden></div>` : ""}</td>
        <td class="num">${r.need === null ? "—" : fmt(r.need)}</td>
        <td class="num">${fmt(r.oh)}</td>
        <td class="num">${fmt(r.pl)}</td>
        <td class="num">${r.netGap === null ? "—" : (r.netGap > 0 ? "+" : "") + fmt(r.netGap)}${r.netGap > 0 ? `<div class="covflag">${coverageFlag(r.label, r.netGap)}</div>` : ""}</td>
        <td>${r.status}</td></tr>`).join("")}
      </table></div>
      <p class="hint">${rows.length} styles · on hand sums the 6 stock-holding stores only (Wooster, Madison, Marin, Montecito, Los Angeles, San Francisco) and nets out sample-sale colors.</p>`;
    root.appendChild(el);
    bindSizeToggles(el);
    $("#cov-q", el).addEventListener("input", e => {
      const q = e.target.value.toLowerCase();
      $$("#cov-table tr[data-s]", el).forEach(tr => {
        tr.style.display = tr.dataset.s.includes(q) ? "" : "none";
      });
    });
  }

  /* ----- schedule tracker ----- */
  function trackerCard(root) {
    const asm = getAssumptions();
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<h2>Schedule tracker</h2>
      <p class="lede">Planned receipt ramp vs. actual WIP receipts per drop. Enter actuals as they land — status flags automatically.</p>
      <div id="trk"></div>`;
    root.appendChild(el);
    const host = $("#trk", el);
    DATA.meta.drops.forEach(drop => {
      const m = dropCalc(drop);
      const rows = m.ramp.map(r => {
        const actual = Store.get(`trk_${drop.id}_${r.ym}`, null);
        const st = actual === null ? `<span class="pill info">pending</span>`
          : actual >= r.qty ? `<span class="pill ok">on track</span>`
          : actual >= r.qty * 0.7 ? `<span class="pill warn">at risk</span>`
          : `<span class="pill bad">behind</span>`;
        return `<tr><td>${r.ym}</td><td class="num">${fmt(r.qty)}</td>
          <td><input type="number" data-trk="${drop.id}_${r.ym}" value="${actual === null ? "" : actual}" placeholder="actual" style="width:96px"></td>
          <td>${st}</td></tr>`;
      }).join("");
      const d = document.createElement("div");
      d.innerHTML = `<h3>${esc(drop.name)} — fabric order ${fmtDate(m.fabricOrder)} · sewing ${fmtDate(m.sewingLaunch)}</h3>
        <table><tr><th>Month</th><th class="num">Planned</th><th>Actual received</th><th>Status</th></tr>${rows}</table>`;
      host.appendChild(d);
    });
    $$("input[data-trk]", host).forEach(inp => {
      inp.addEventListener("change", () => {
        const v = inp.value === "" ? null : Number(inp.value);
        if (v === null) Store.remove("trk_" + inp.dataset.trk);
        else Store.set("trk_" + inp.dataset.trk, v);
        refreshDerived();
      });
    });
  }

  /* ----- remaining global assumptions ----- */
  function assumptionsCard(root) {
    const asm = getAssumptions();
    const fields = [
      ["sell_through", "Sell-through default (0–1)", 0.3, 1, 0.01],
      ["growth_pct", "Growth %", -20, 50, 1],
      ["fabric_lead_wks", "Fabric lead (wks)", 1, 20, 1],
      ["sewing_lead_wks", "Sewing lead (wks)", 1, 20, 1],
      ["transit_wks", "Transit (wks)", 0, 8, 1],
      ["factory_cap_month", "Factory cap (units/mo)", 200, 3000, 50],
      ["factory_cap_flag", "Flag above (units/mo)", 500, 4000, 50],
      ["grade_a_months", "Grade A months", 1, 12, 1],
      ["grade_b_months", "Grade B months", 1, 12, 1],
      ["grade_c_months", "Grade C months", 1, 12, 1],
      ["tops_pct", "Default tops %", 0, 100, 1],
      ["bottoms_pct", "Default bottoms %", 0, 100, 1],
      ["maillots_pct", "Default maillots %", 0, 100, 1]
    ];
    const el = document.createElement("details");
    el.className = "assump";
    el.innerHTML = `<summary>Planning assumptions</summary><div class="body">
      <p class="lede">Every input recalculates immediately and is saved. The sell-through default anchors drop buys and scales per-colorway buys.</p>
      <div class="asmgrid">${fields.map(([k, label, min, max, step]) => `
        <label class="f">${esc(label)}<input type="number" data-asm="${k}" min="${min}" max="${max}" step="${step}" value="${asm[k]}"></label>`).join("")}
      </div>
      <p style="margin-top:14px"><button class="btn ghost sm" id="asm-reset">Reset to defaults</button></p></div>`;
    root.appendChild(el);
    $$("input[data-asm]", el).forEach(inp => inp.addEventListener("change", () => {
      setAssumption(inp.dataset.asm, Number(inp.value));
      refreshDerived();
    }));
    $("#asm-reset", el).addEventListener("click", () => {
      Object.keys(DATA.meta.defaults).forEach(k => Store.remove("asm_" + k));
      Object.keys(TIER_DEFAULTS).forEach(k => Store.remove("asm_" + k));
      refreshDerived();
    });
  }

  /* ----- pace & stock signals sub-tab ----- */
  function renderSignals(root) {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<h2>Pace &amp; stock signals</h2>
      <p class="lede">Affinity-led demand read: broken pairs to fix first, then velocity with on-hand and cover. Velocity uses the same period last year — never peak-summer pace for fall.</p>`;
    root.appendChild(el);
    const host = document.createElement("div");
    root.appendChild(host);
    FixNow.renderSections(host, "signals");
  }

  /* ----- main render ----- */
  function render() {
    const root = $("#tab-plan");
    root.innerHTML = "";
    headerBlock(root);
    const tm = tierMath();
    statCards(root, tm);
    subTabs(root);
    const sub = document.createElement("div");
    sub.id = "plan-sub";
    root.appendChild(sub);
    const which = Store.get("ui_subtab", "tiers");
    if (which === "signals") renderSignals(sub);
    else if (which === "calendar") CalView.render(sub);
    else renderTiers(sub, tm);
  }

  /* ----- download planning signals (CSV) ----- */
  function downloadCSV() {
    const tm = tierMath(), asm = tm.asm;
    const L = [];
    const today = new Date().toISOString().slice(0, 10);
    L.push(["Malia Mills planning signals", today]);
    L.push([]);
    L.push(["DROP", "DEMAND", "BUY (anchor)", "IN STORE", "SELL OUT", "FABRIC ORDER", "SEWING LAUNCH",
            "CW BUY SUM", "CW EXP SALES", "CW LEFTOVER"]);
    tm.calcs.forEach(({ drop, m }) => {
      const assigned = Store.get("drop_colors_" + drop.id, []) || [];
      let bsum = 0, ssum = 0, lsum = 0;
      assigned.forEach(c => {
        const nk = cwNameKey(c.name);
        const st = cwStFrac(nk, drop.id, c.st !== undefined ? c.st : asm.sell_through);
        const b = cwBuyUnitsEntry(c, drop.id);
        const e = cwExpected(b, st);
        bsum += b; ssum += e.sales; lsum += e.leftover;
      });
      L.push([drop.name, m.demand, m.buy, m.inStore, m.sellOut, m.fabricOrder, m.sewingLaunch, bsum, ssum, lsum]);
    });
    L.push([]);
    L.push(["ASSIGNED COLORWAY", "DROP", "GRADE", "TIER TARGET", "BUY", "ST%", "MONTHS", "EXPECTED SALES", "LEFTOVER", "SELL OUT"]);
    tm.calcs.forEach(({ drop, m }) => {
      (Store.get("drop_colors_" + drop.id, []) || []).forEach(c => {
        const nk = cwNameKey(c.name);
        const st = cwStFrac(nk, drop.id, c.st !== undefined ? c.st : asm.sell_through);
        const moFb = c.months !== undefined ? c.months : asm["grade_" + String(c.grade).toLowerCase() + "_months"] || 4;
        const mo = cwMonths(nk, drop.id, moFb);
        const buy = cwBuyUnitsEntry(c, drop.id);
        const exp = cwExpected(buy, st);
        L.push([c.name, drop.name, c.grade, c.units, buy, Math.round(st * 100), mo,
                exp.sales, exp.leftover, cwSellOut(m.inStore, mo)]);
      });
    });
    L.push([]);
    L.push(["TIER", "UNITS/COLOR", "COLORS"]);
    L.push(["Grade A (" + tm.cat + ")", tm.aU, tm.aN]);
    L.push(["Grade B (" + tm.cat + ")", tm.bU, tm.bN]);
    L.push(["Grade C (" + tm.cat + ", derived)", tm.cU, tm.cN]);
    L.push(["New-color need", tm.need]);
    L.push(["Tier capacity", tm.capacity]);
    L.push([]);
    L.push(["BLACK REORDER", "STYLE", "SIZE", "OH", "VEL/WK", "COVER WKS", "REORDER"]);
    Black.computeRows().filter(r => r.status === "reorder")
      .forEach(r => L.push(["", r.style, r.size, r.total, +r.vel.toFixed(2),
        isFinite(r.cover) ? +r.cover.toFixed(1) : "", r.rec]));
    const csv = L.map(r => r.map(c => `"${String(c === null || c === undefined ? "" : c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "planning-signals-" + today + ".csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }

  return { render, dropMath, dropCalc, tierMath, downloadCSV, cwNameKey, cwStFrac, cwMonths,
           cwSellOut, cwExpected, cwBuyUnitsEntry, slotBuyUnits, styleTypeGuess,
           ACTIVE_STOCK_STORES, activeStoreList, pairAttach, buildDraft, topStylesByType, affCell,
           correctByAttach, computeHoles };
})();
