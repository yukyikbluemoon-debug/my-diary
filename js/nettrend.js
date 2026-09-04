/* nettrend.js — "แนวโน้ม" (Net Worth Timeline): a line chart of combined
   cash + bank account balance over a chosen date range.

   Deliberately does NOT include assets (stocks/ETFs) — the Assets module
   only stores each holding's CURRENT price, not a price history, so
   plotting them "over time" would mean pasting today's price onto past
   dates, which is simply wrong. This chart is accurate because it's built
   from real transaction history: transfers between the user's own wallets
   are excluded (net zero for the combined total), only income/expense
   move the line.

   Plain SVG, no charting library — one <path> for the line, one for the
   area fill, and a set of invisible wide rectangles per point for hover/
   tap tooltips. */

const NetTrend = (() => {
  function computeSeries(fromDate, toDate) {
    // Everything up to the end date, so we can carry forward a correct
    // running total into the start of the visible range.
    const allUpToEnd = Finance.getTransactionsInRange("0001-01-01", toDate);
    let runningBeforeRange = 0;
    const deltaByDate = {};
    allUpToEnd.forEach((t) => {
      if (t.type === "transfer") return; // moves money between own wallets — net zero for the combined total
      const delta = t.type === "income" ? t.amount : -t.amount;
      if (t.date < fromDate) runningBeforeRange += delta;
      else deltaByDate[t.date] = (deltaByDate[t.date] || 0) + delta;
    });

    const series = [];
    let running = runningBeforeRange;
    const cursor = new Date(fromDate + "T00:00:00");
    const end = new Date(toDate + "T00:00:00");
    while (cursor <= end) {
      const iso = cursor.toISOString().slice(0, 10);
      running += deltaByDate[iso] || 0;
      series.push({ date: iso, value: running });
      cursor.setDate(cursor.getDate() + 1);
    }
    return series;
  }

  function renderChart(series) {
    const wrap = $("netTrendChartWrap");
    if (series.length < 2) {
      wrap.innerHTML = '<p class="settings-note">ต้องมีข้อมูลอย่างน้อย 2 วันขึ้นไปถึงจะวาดกราฟได้</p>';
      return;
    }

    const W = 100, H = 40; // viewBox units — scales responsively via CSS width
    const padTop = 4, padBottom = 4;
    const values = series.map((p) => p.value);
    const min = Math.min(...values), max = Math.max(...values);
    const range = max - min || 1;
    const stepX = W / (series.length - 1);
    const yFor = (v) => padTop + (1 - (v - min) / range) * (H - padTop - padBottom);

    const points = series.map((p, i) => ({ x: i * stepX, y: yFor(p.value), ...p }));
    const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
    const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(2)},${H} L0,${H} Z`;

    const first = series[0].value, last = series[series.length - 1].value;
    const change = last - first;
    const changePct = first !== 0 ? (change / Math.abs(first)) * 100 : 0;
    const changeClass = change >= 0 ? "positive" : "negative";

    const hoverRects = points.map((p, i) =>
      `<rect class="nettrend-hover-zone" data-i="${i}" x="${(p.x - stepX / 2).toFixed(2)}" y="0" width="${stepX.toFixed(2)}" height="${H}" fill="transparent"></rect>`
    ).join("");

    wrap.innerHTML = `
      <div class="nettrend-summary">
        <div><span class="nettrend-summary-label">เริ่มต้น</span><span class="nettrend-summary-value">${Finance.formatMoney(first)}</span></div>
        <div><span class="nettrend-summary-label">ล่าสุด</span><span class="nettrend-summary-value">${Finance.formatMoney(last)}</span></div>
        <div><span class="nettrend-summary-label">เปลี่ยนแปลง</span><span class="nettrend-summary-value ${changeClass}">${change >= 0 ? "+" : ""}${Finance.formatMoney(change)} (${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%)</span></div>
      </div>
      <svg class="nettrend-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
        <path class="nettrend-area" d="${areaPath}"></path>
        <path class="nettrend-line" d="${linePath}"></path>
        ${hoverRects}
      </svg>
      <div class="nettrend-tooltip" id="netTrendTooltip" hidden></div>
      <div class="nettrend-axis">
        <span>${escapeHTML(formatDateHeading(series[0].date))}</span>
        <span>${escapeHTML(formatDateHeading(series[series.length - 1].date))}</span>
      </div>`;

    const svg = wrap.querySelector(".nettrend-svg");
    const tooltip = $("netTrendTooltip");
    svg.addEventListener("pointermove", (e) => showPointTooltip(e, svg, points, tooltip));
    svg.addEventListener("pointerdown", (e) => showPointTooltip(e, svg, points, tooltip));
    svg.addEventListener("pointerleave", () => { tooltip.hidden = true; });
  }

  function showPointTooltip(e, svg, points, tooltip) {
    const rect = e.target.closest(".nettrend-hover-zone");
    if (!rect) return;
    const p = points[parseInt(rect.dataset.i, 10)];
    if (!p) return;
    tooltip.hidden = false;
    tooltip.innerHTML = `<strong>${escapeHTML(formatFullThaiDate(p.date))}</strong><br>${escapeHTML(Finance.formatMoney(p.value))}`;
    const svgRect = svg.getBoundingClientRect();
    const xPct = svgRect.width ? (p.x / 100) * svgRect.width : 0;
    tooltip.style.left = Math.min(Math.max(xPct - 50, 0), svgRect.width - 110) + "px";
  }

  function getSelectedRange() {
    return { from: $("netTrendFromDateValue").value, to: $("netTrendToDateValue").value };
  }
  function setDate(fieldPrefix, dateStr) {
    $(fieldPrefix + "Value").value = dateStr;
    $(fieldPrefix + "Btn").textContent = formatFullThaiDate(dateStr);
  }

  function refresh() {
    const { from, to } = getSelectedRange();
    if (!from || !to) return;
    renderChart(computeSeries(from, to));
  }

  function openModal() {
    if (!$("netTrendFromDateValue").value) {
      const today = todayISO();
      const d = new Date(today + "T00:00:00");
      d.setDate(d.getDate() - 29);
      setDate("netTrendFromDate", d.toISOString().slice(0, 10));
      setDate("netTrendToDate", today);
    }
    refresh();
    $("netTrendModal").hidden = false;
    pushNavState("nettrend");
  }
  function closeModalVisual() { $("netTrendModal").hidden = true; }
  function closeModal() { closeModalVisual(); popNavState(); }

  function wireEvents() {
    $("openNetTrendBtn").addEventListener("click", openModal);
    $("netTrendCloseBtn").addEventListener("click", closeModal);
    $("netTrendFromDateBtn").addEventListener("click", () => {
      openCalendarForPick($("netTrendFromDateValue").value || todayISO(), (d) => { setDate("netTrendFromDate", d); refresh(); });
    });
    $("netTrendToDateBtn").addEventListener("click", () => {
      openCalendarForPick($("netTrendToDateValue").value || todayISO(), (d) => { setDate("netTrendToDate", d); refresh(); });
    });
    document.querySelectorAll(".nettrend-preset-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const days = parseInt(btn.dataset.days, 10);
        const today = todayISO();
        const d = new Date(today + "T00:00:00");
        d.setDate(d.getDate() - (days - 1));
        setDate("netTrendFromDate", d.toISOString().slice(0, 10));
        setDate("netTrendToDate", today);
        refresh();
      });
    });
  }

  function init() { wireEvents(); }

  return { init, closeModalVisual };
})();
