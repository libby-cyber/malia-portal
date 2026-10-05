/* calendar.js — 12-month rotation calendar (Dec 2026 – Nov 2027).
 * Drop milestones + assigned colorways with their own sell-through-adjusted
 * sell-out / handoff dates. Rendered as the Calendar sub-tab of Seasonal plan. */
const CalView = (() => {
  const MONTHS = ["Dec 2026", "Jan 2027", "Feb 2027", "Mar 2027", "Apr 2027", "May 2027",
                  "Jun 2027", "Jul 2027", "Aug 2027", "Sep 2027", "Oct 2027", "Nov 2027"];
  const YMS = ["2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05",
               "2027-06", "2027-07", "2027-08", "2027-09", "2027-10", "2027-11"];

  function render(root) {
    root = root || $("#tab-calendar");
    const asm = getAssumptions();
    const cells = YMS.map(() => []);
    const put = (iso, cls, label) => {
      if (!iso) return;
      const i = YMS.indexOf(iso.slice(0, 7));
      if (i >= 0) cells[i].push({ cls, label });
    };

    DATA.meta.drops.forEach(drop => {
      const m = Plan.dropMath(drop, asm);
      put(m.fabricOrder, "fab", `${esc(drop.name)}: order fabric (${fmtDate(m.fabricOrder)})`);
      put(m.sewingLaunch, "sew", `${esc(drop.name)}: launch sewing (${fmtDate(m.sewingLaunch)})`);
      put(m.inStore, "in", `${esc(drop.name)}: IN STORE (${fmtDate(m.inStore)})`);
      put(m.handoff, "hand", `${esc(drop.name)}: handoff (${fmtDate(m.handoff)})`);
      put(m.sellOut, "out", `${esc(drop.name)}: projected sell-out (${fmtDate(m.sellOut)})`);
      // assigned colorways: own sell-out/handoff from per-colorway months
      (Store.get("drop_colors_" + drop.id, []) || []).forEach(c => {
        const nk = Plan.cwNameKey(c.name);
        const moFb = c.months !== undefined ? c.months : asm["grade_" + String(c.grade).toLowerCase() + "_months"] || 4;
        const mo = Plan.cwMonths(nk, drop.id, moFb);
        const st = Plan.cwStFrac(nk, drop.id, c.st !== undefined ? c.st : asm.sell_through);
        const buy = Plan.cwBuyUnitsEntry(c, drop.id);
        const exp = Plan.cwExpected(buy, st);
        const so = Plan.cwSellOut(m.inStore, mo);
        const ho = addDays(so, -14);
        const ii = YMS.indexOf(m.inStore.slice(0, 7));
        if (ii >= 0) cells[ii].push({ cls: "in", label: `${esc(c.name)} · Grade ${esc(c.grade)} · ${fmt(buy)}u buy, expect ${Math.round(st * 100)}% (${fmt(exp.sales)} sales)` });
        put(so, "out", `${esc(c.name)}: sell-out (${fmtDate(so)})`);
        put(ho, "hand", `${esc(c.name)}: handoff (${fmtDate(ho)})`);
      });
    });

    root.innerHTML = `
    <div class="card"><h2>Rotation calendar <span class="muted small">Dec 2026 – Nov 2027</span></h2>
      <p class="lede">Drops, milestones, and assigned colorways. Each colorway carries its own expected sell-through
      and months, so sell-out and handoff dates are per-colorway. Fabric/sewing back up automatically from lead times.</p>
      <div class="cal">${MONTHS.map((label, i) => `
        <div class="m"><h4>${label}</h4>
          ${cells[i].map(e => `<div class="evt ${e.cls}">${e.label}</div>`).join("") || `<span class="faint">—</span>`}
        </div>`).join("")}</div>
      <div class="callegend">
        <span><span class="swatch" style="background:var(--orange)"></span>fabric order</span>
        <span><span class="swatch" style="background:var(--info)"></span>sewing launch</span>
        <span><span class="swatch" style="background:var(--warn)"></span>in store</span>
        <span><span class="swatch" style="background:#7a4d9b"></span>handoff</span>
        <span><span class="swatch" style="background:var(--bad)"></span>sell-out</span>
      </div>
    </div>`;
  }
  return { render };
})();
