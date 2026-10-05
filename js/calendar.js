/* calendar.js — Tab 4: 12-month calendar view (Dec 2026 – Nov 2027) */
const CalView = (() => {
  const MONTHS = ["Dec 2026", "Jan 2027", "Feb 2027", "Mar 2027", "Apr 2027", "May 2027",
                  "Jun 2027", "Jul 2027", "Aug 2027", "Sep 2027", "Oct 2027", "Nov 2027"];
  const YMS = ["2026-12", "2027-01", "2027-02", "2027-03", "2027-04", "2027-05",
               "2027-06", "2027-07", "2027-08", "2027-09", "2027-10", "2027-11"];

  function render() {
    const root = $("#tab-calendar");
    const asm = getAssumptions();
    const cells = YMS.map(() => []);
    DATA.meta.drops.forEach(drop => {
      const m = Plan.dropMath(drop, asm);
      const put = (iso, cls, label) => {
        if (!iso) return;
        const ym = iso.slice(0, 7);
        const i = YMS.indexOf(ym);
        if (i >= 0) cells[i].push({ cls, label: `${esc(drop.name)}: ${label} (${fmtDate(iso)})` });
      };
      put(m.fabricOrder, "", `order fabric`);
      put(m.sewingLaunch, "sew", `launch sewing`);
      put(m.inStore, "in", `IN STORE`);
      put(m.handoff, "hand", `handoff`);
      put(m.sellOut, "out", `projected sell-out`);
      // assigned colorways on the in-store month
      const assigned = Store.get("drop_colors_" + drop.id, []);
      const ii = YMS.indexOf(m.inStore.slice(0, 7));
      assigned.forEach(c => {
        if (ii >= 0) cells[ii].push({ cls: "in", label: `${esc(c.name)} · Grade ${esc(c.grade)} (${fmt(c.units)}u)` });
      });
    });

    root.innerHTML = `
    <div class="card"><h2>Rotation calendar <span class="muted small">Dec 2026 – Nov 2027</span></h2>
      <p class="muted small">Drops, milestones, and assigned colorways. In-store dates and color life are the plan levers;
      fabric/sewing back up automatically from lead times.</p>
      <div class="cal">${MONTHS.map((label, i) => `
        <div class="m"><h4>${label}</h4>
          ${cells[i].map(e => `<div class="evt ${e.cls}">${e.label}</div>`).join("") || `<span class="muted">—</span>`}
        </div>`).join("")}</div>
      <p class="small muted" style="margin-top:10px">
        <span class="pill ok">fabric order</span> <span class="pill info">sewing launch</span>
        <span class="pill warn">in store</span> <span class="pill" style="background:#efe4f5;color:#7a4d9b">handoff</span>
        <span class="pill bad">sell-out</span></p>
    </div>`;
  }
  return { render };
})();
