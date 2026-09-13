/* assets.js — portfolio / net-worth tracking (stocks, ETFs, crypto, gold,
   cash, etc). Values are entered and updated by hand — this module never
   fetches live prices, on purpose (keeps the app fully offline-capable and
   avoids depending on a paid/rate-limited price API). */

const Assets = (() => {
  let allAssets = []; // includes soft-deleted; filter with activeAssets()
  let allAssetLogs = [];
  let groupMode = ""; // "" | "market" | "broker"

  function activeAssets() {
    return allAssets.filter((a) => !a.deletedAt);
  }

  function toTHB(perUnitValue, quantity, currency, exchangeRate) {
    const total = perUnitValue * quantity;
    return currency === "USD" ? total * (exchangeRate || 0) : total;
  }

  function assetValueTHB(a) { return toTHB(a.currentValuePerUnit, a.quantity, a.currency, a.exchangeRate); }
  function assetCostTHB(a) { return toTHB(a.costPerUnit, a.quantity, a.currency, a.exchangeRate); }

  function setAssetCurrency(currency) {
    $("assetCurrency").value = currency;
    $("assetExchangeRateField").hidden = currency !== "USD";
    if (currency === "USD" && !$("assetExchangeRate").value) {
      const lastRate = localStorage.getItem("diary_last_exchange_rate");
      if (lastRate) $("assetExchangeRate").value = lastRate;
    }
    if (currency === "USD" && typeof ExchangeRate !== "undefined") {
      const rate = ExchangeRate.getRate();
      $("assetRateInfo").textContent = rate ? `อัตราในระบบ: ${rate.toFixed(2)} บาท (ปรับแก้ได้)` : "";
    }
  }

  function guessMarketCode(marketText) {
    const t = (marketText || "").toLowerCase();
    if (t.includes("ไทย") || t.includes("thai")) return "TH";
    if (t.includes("จีน") || t.includes("ฮ่องกง") || t.includes("hk") || t.includes("china") || t.includes("hong kong")) return "HK";
    return "US"; // most common default among global tickers
  }

  function getQuoteProxyBase() {
    return (localStorage.getItem("diary_quote_proxy_url") || "").trim()
      || "https://sudgnxcdzdpoksqvzraj.supabase.co/functions/v1/quote-proxy";
  }

  /** Best-effort live quote fetch — a third-party proxy (not an official
   *  data source), so every caller must handle failure gracefully and
   *  fall back to the existing manual-entry flow. Never assume this
   *  keeps working; the base URL is deliberately configurable in
   *  Settings so it can be swapped without an app update if it breaks. */
  async function fetchLivePrice(symbol, market) {
    const base = getQuoteProxyBase();
    const url = `${base}?action=full&symbol=${encodeURIComponent(symbol)}&market=${encodeURIComponent(market)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`เชื่อมต่อไม่สำเร็จ (${res.status})`);
    const json = await res.json();
    if (!json.ok || !json.data || typeof json.data.price !== "number") throw new Error("ไม่พบข้อมูลราคาสำหรับสัญลักษณ์นี้");
    return json.data;
  }

  function updatePriceCheckLink(linkEl, name, type) {
    const q = (name || "").trim();
    if (!q) { linkEl.href = "#"; return; }
    if (type === "หุ้น" || type === "ETF") {
      linkEl.href = `https://finance.yahoo.com/quote/${encodeURIComponent(q)}`;
      linkEl.textContent = "🔍 เช็คราคาที่ Yahoo Finance";
    } else {
      linkEl.href = `https://www.google.com/search?q=${encodeURIComponent(q + " price")}`;
      linkEl.textContent = "🔍 เช็คราคาปัจจุบัน";
    }
  }

  function openNewAsset() {
    $("assetId").value = "";
    $("assetType").value = "หุ้น";
    $("assetName").value = "";
    $("assetQuantity").value = "1";
    setAssetCurrency("THB");
    $("assetExchangeRate").value = "";
    $("assetCost").value = "";
    $("assetCurrentValue").value = "";
    $("assetMarket").value = "";
    $("assetBroker").value = "";
    $("assetNote").value = "";
    $("assetFetchMarket").value = "US";
    $("assetFetchResult").textContent = "";
    $("assetModalTitle").textContent = "เพิ่มทรัพย์สิน";
    $("assetDeleteBtn").hidden = true;
    updatePriceCheckLink($("assetPriceCheckLink"), "", "หุ้น");
    $("assetModal").hidden = false;
    pushNavState("asset");
  }

  function openEditAsset(id) {
    const a = allAssets.find((x) => x.id === id);
    if (!a) return;
    $("assetId").value = a.id;
    $("assetType").value = a.type;
    $("assetName").value = a.name;
    $("assetQuantity").value = a.quantity;
    setAssetCurrency(a.currency || "THB");
    if (a.currency === "USD") $("assetExchangeRate").value = a.exchangeRate || "";
    $("assetCost").value = a.costPerUnit;
    $("assetCurrentValue").value = a.currentValuePerUnit;
    $("assetMarket").value = a.market || "";
    $("assetBroker").value = a.broker || "";
    $("assetNote").value = a.note || "";
    $("assetFetchMarket").value = guessMarketCode(a.market);
    $("assetFetchResult").textContent = "";
    $("assetModalTitle").textContent = "แก้ไขทรัพย์สิน";
    $("assetDeleteBtn").hidden = false;
    updatePriceCheckLink($("assetPriceCheckLink"), a.name, a.type);
    $("assetModal").hidden = false;
    pushNavState("asset");
  }

  function closeAssetModalVisual() { $("assetModal").hidden = true; }
  function closeAssetModal() { closeAssetModalVisual(); popNavState(); }

  async function saveAsset() {
    const name = $("assetName").value.trim();
    const quantity = parseFloat($("assetQuantity").value);
    const costPerUnit = parseFloat($("assetCost").value) || 0;
    const currentValuePerUnit = parseFloat($("assetCurrentValue").value) || 0;
    if (!name) { showToast("กรุณาใส่ชื่อทรัพย์สิน"); return; }
    if (!quantity || quantity <= 0) { showToast("กรุณาใส่จำนวนที่ถูกต้อง"); return; }
    const currency = $("assetCurrency").value;
    let exchangeRate = null;
    if (currency === "USD") {
      exchangeRate = parseFloat($("assetExchangeRate").value);
      if (!exchangeRate || exchangeRate <= 0) { showToast("กรุณาใส่อัตราแลกเปลี่ยน"); return; }
      localStorage.setItem("diary_last_exchange_rate", exchangeRate);
    }

    const id = $("assetId").value || uid();
    const existing = allAssets.find((a) => a.id === id);
    const asset = {
      id, type: $("assetType").value, name, quantity,
      currency, exchangeRate,
      costPerUnit, currentValuePerUnit,
      market: $("assetMarket").value.trim(),
      broker: $("assetBroker").value.trim(),
      note: $("assetNote").value.trim(),
      deletedAt: null,
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await DiaryDB.putAsset(asset);
    const idx = allAssets.findIndex((a) => a.id === id);
    if (idx >= 0) allAssets[idx] = asset; else allAssets.push(asset);

    closeAssetModalVisual();
    popNavState();
    render();
    showToast("บันทึกแล้ว");
  }

  async function deleteAsset() {
    const id = $("assetId").value;
    if (!id) return;
    if (!confirm("ลบทรัพย์สินนี้หรือไม่?")) return;
    const a = allAssets.find((x) => x.id === id);
    if (!a) return;
    a.deletedAt = new Date().toISOString();
    a.updatedAt = new Date().toISOString();
    await DiaryDB.putAsset(a);
    closeAssetModalVisual();
    popNavState();
    render();
    showToast("ลบแล้ว");
  }

  function buildAssetRowHTML(a) {
    const value = assetValueTHB(a);
    const cost = assetCostTHB(a);
    const gain = value - cost;
    const gainPct = cost > 0 ? (gain / cost) * 100 : 0;
    const unitLabel = a.currency === "USD" ? `$${a.currentValuePerUnit}` : Finance.formatMoney(a.currentValuePerUnit);
    const updatedLabel = typeof formatDateHeading === "function" ? formatDateHeading((a.updatedAt || a.createdAt).slice(0, 10)) : (a.updatedAt || "").slice(0, 10);
    return `
      <button type="button" class="asset-quick-update-btn" data-id="${a.id}" aria-label="อัปเดตมูลค่า">🔄</button>
      <button type="button" class="asset-send-btn" data-id="${a.id}" aria-label="ส่งเข้า Telegram">📨</button>
      <div class="asset-row-body">
        <div class="asset-row-title">${assetLogoHTML(a.name)} ${escapeHTML(a.name)}</div>
        <div class="asset-row-sub">${escapeHTML(a.type)} · ${a.quantity} หน่วย @ ${unitLabel}</div>
        <div class="asset-row-updated">อัปเดตล่าสุด ${updatedLabel}</div>
      </div>
      <div class="asset-row-value">
        <div class="asset-row-total money-blur">${Finance.formatMoney(value)}</div>
        <div class="asset-row-gain money-blur ${gain >= 0 ? "positive" : "negative"}">${gain >= 0 ? "+" : ""}${Finance.formatMoney(gain)} (${gainPct >= 0 ? "+" : ""}${gainPct.toFixed(1)}%)</div>
      </div>`;
  }

  function renderAssetList() {
    const items = activeAssets().slice().sort((a, b) => assetValueTHB(b) - assetValueTHB(a));
    const list = $("assetList");
    list.innerHTML = "";
    $("assetEmptyState").hidden = items.length > 0;

    let totalValue = 0, totalCost = 0;
    const typeTotals = {};
    const typeCosts = {};
    items.forEach((a) => {
      totalValue += assetValueTHB(a);
      totalCost += assetCostTHB(a);
      typeTotals[a.type] = (typeTotals[a.type] || 0) + assetValueTHB(a);
      typeCosts[a.type] = (typeCosts[a.type] || 0) + assetCostTHB(a);
    });

    if (groupMode === "market" || groupMode === "broker") {
      const field = groupMode;
      const groups = new Map();
      items.forEach((a) => {
        const key = (a[field] || "").trim() || "(ไม่ระบุ)";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(a);
      });
      // groups ordered by total value, largest first
      const ordered = [...groups.entries()].sort((x, y) => {
        const sumX = x[1].reduce((s, a) => s + assetValueTHB(a), 0);
        const sumY = y[1].reduce((s, a) => s + assetValueTHB(a), 0);
        return sumY - sumX;
      });
      ordered.forEach(([key, groupItems]) => {
        const groupTotal = groupItems.reduce((s, a) => s + assetValueTHB(a), 0);
        const heading = document.createElement("div");
        heading.className = "asset-group-heading";
        heading.innerHTML = `<span>${escapeHTML(key)} · ${groupItems.length} รายการ</span><span class="money-blur">${Finance.formatMoney(groupTotal)}</span>`;
        list.appendChild(heading);
        groupItems.forEach((a) => {
          const row = document.createElement("div");
          row.className = "asset-row";
          row.dataset.id = a.id;
          row.innerHTML = buildAssetRowHTML(a);
          list.appendChild(row);
        });
      });
    } else {
      items.forEach((a) => {
        const row = document.createElement("div");
        row.className = "asset-row";
        row.dataset.id = a.id;
        row.innerHTML = buildAssetRowHTML(a);
        list.appendChild(row);
      });
    }

    $("assetTotalValue").textContent = Finance.formatMoney(totalValue);
    const totalGain = totalValue - totalCost;
    $("assetTotalGain").textContent = (totalGain >= 0 ? "+" : "") + Finance.formatMoney(totalGain);

    const typeRows = Object.entries(typeTotals).sort((a, b) => b[1] - a[1]).map(([label, amount]) => {
      const cost = typeCosts[label] || 0;
      const gain = amount - cost;
      const gainPct = cost > 0 ? (gain / cost) * 100 : 0;
      return { label, amount, gain, gainPct };
    });
    renderDonutChart(typeRows, totalValue);
    const chartEl = $("assetTypeChart");
    if (typeRows.length === 0) { chartEl.innerHTML = ""; }
    else {
      chartEl.innerHTML = `<div class="asset-type-grid">${typeRows.map((r) => `
        <div class="asset-type-card">
          <div class="asset-type-card-label">${assetTypeIcon(r.label)} ${escapeHTML(r.label)}</div>
          <div class="asset-type-card-value money-blur">${Finance.formatMoney(r.amount)}</div>
          <div class="asset-type-card-gain money-blur ${r.gain >= 0 ? "positive" : "negative"}">${r.gain >= 0 ? "↗" : "↘"} ${Finance.formatMoney(Math.abs(r.gain))} (${r.gainPct >= 0 ? "+" : ""}${r.gainPct.toFixed(1)}%)</div>
        </div>`).join("")}</div>`;
    }
    renderTop5();
  }

  function renderTop5() {
    const el = $("assetTop5");
    if (!el) return;
    const items = activeAssets().slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);
    if (items.length === 0) { el.innerHTML = ""; return; }
    el.innerHTML = items.map((a, i) => `
      <div class="asset-top5-row" data-id="${a.id}" style="cursor:pointer;">
        <span class="asset-top5-rank">${i + 1}</span>
        ${assetLogoHTML(a.name)}
        <span class="asset-top5-name">${escapeHTML(a.name)}</span>
        <span class="asset-top5-value money-blur">${Finance.formatMoney(assetValueTHB(a))}</span>
      </div>`).join("");
  }

  /** Plain SVG donut chart (stroke-dasharray technique on a circle, one
   *  arc per category) — no charting library, matching how the Net Worth
   *  Timeline chart was built. Always grouped by asset TYPE regardless of
   *  the list's own market/broker grouping toggle — a separate, fixed
   *  breakdown, same as the reference screenshot had. */
  function renderDonutChart(typeRows, totalValue) {
    const wrap = $("assetDonutWrap");
    if (!wrap) return;
    if (typeRows.length === 0 || totalValue <= 0) { wrap.innerHTML = ""; return; }

    const palette = ["pastel-purple", "pastel-green", "pastel-orange", "pastel-pink", "pastel-teal", "pastel-blue", "pastel-red", "pastel-yellow"];
    const R = 15.9155; // radius that makes the circle's circumference exactly 100 units — lets each arc's dasharray be a plain percentage
    const CIRC = 2 * Math.PI * R;
    let offset = 0;
    const arcs = typeRows.map((r, i) => {
      const pct = (r.amount / totalValue) * 100;
      const color = `var(--${palette[i % palette.length]})`;
      const arc = `<circle cx="21" cy="21" r="${R}" fill="transparent" stroke="${color}" stroke-width="5"
        stroke-dasharray="${(pct / 100) * CIRC} ${CIRC}" stroke-dashoffset="${-offset}"></circle>`;
      offset += (pct / 100) * CIRC;
      return { svg: arc, pct, color, label: r.label };
    });

    wrap.innerHTML = `
      <div class="asset-donut-header">📊 สัดส่วนพอร์ต</div>
      <div class="asset-donut-row">
        <div class="asset-donut-chart-wrap">
          <svg viewBox="0 0 42 42" class="asset-donut-svg">
            ${arcs.map((a) => a.svg).join("")}
          </svg>
          <div class="asset-donut-center">
            <div class="asset-donut-center-label">รวมทั้งหมด</div>
            <div class="asset-donut-center-value money-blur">${Finance.formatMoney(totalValue)}</div>
          </div>
        </div>
        <div class="asset-donut-legend">
          ${arcs.map((a) => `
            <div class="asset-donut-legend-row">
              <span class="asset-donut-swatch" style="background:${a.color};"></span>
              <span class="asset-donut-legend-label">${assetTypeIcon(a.label)} ${escapeHTML(a.label)}</span>
              <span class="asset-donut-legend-pct">${a.pct.toFixed(1)}%</span>
            </div>`).join("")}
        </div>
      </div>`;
  }

  function assetTypeIcon(type) {
    const t = (type || "").toLowerCase();
    if (t.includes("หุ้น") || t.includes("stock")) return "📈";
    if (t.includes("etf") || t.includes("กองทุน")) return "📊";
    if (t.includes("คริป") || t.includes("crypto") || t.includes("bitcoin")) return "🪙";
    if (t.includes("ทอง") || t.includes("gold")) return "🥇";
    if (t.includes("พันธบัตร") || t.includes("ตราสารหนี้") || t.includes("bond")) return "🏦";
    if (t.includes("อสังหา") || t.includes("บ้าน") || t.includes("ที่ดิน") || t.includes("estate")) return "🏠";
    return "💼";
  }

  function assetLogoHTML(name) {
    // Best-effort: financialmodelingprep.com serves a keyless static logo
    // image per ticker at this exact path (confirmed working for US-listed
    // tickers) — no API key, no account, just a plain <img> hotlink. Falls
    // back to a colored initials avatar if the ticker isn't recognized
    // (Thai/HK-listed stocks, crypto, or anything not on FMP) or the
    // request fails for any reason — this is why it's safe to just try it
    // for every asset rather than needing a curated list like the bank
    // logos: worst case is a graceful fallback, not a broken app.
    const clean = (name || "").trim();
    const ticker = clean.toUpperCase().replace(/[^A-Z0-9.]/g, "");
    const initials = escapeHTML(clean.slice(0, 2).toUpperCase() || "?");
    const pastels = ["pastel-red", "pastel-orange", "pastel-yellow", "pastel-green", "pastel-teal", "pastel-blue", "pastel-purple", "pastel-pink"];
    let hash = 0;
    for (let i = 0; i < clean.length; i++) hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
    const color = `var(--${pastels[hash % pastels.length]})`;
    if (!ticker) return `<span class="asset-logo-icon" style="background:${color}; font-size:10px; font-weight:700; color:var(--ink-900);">${initials}</span>`;
    return `<span class="asset-logo-icon">
      <img src="https://financialmodelingprep.com/image-stock/${ticker}.png" alt=""
           onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';">
      <span class="asset-logo-fallback" style="display:none; background:${color};">${initials}</span>
    </span>`;
  }

  function openQuickUpdate(id) {
    const a = allAssets.find((x) => x.id === id);
    if (!a) return;
    $("quickUpdateAssetId").value = a.id;
    $("quickUpdateAssetName").textContent = `${a.name} (${a.type})`;
    $("quickUpdateValueLabel").textContent = a.currency === "USD" ? "มูลค่าปัจจุบันต่อหน่วย (USD)" : "มูลค่าปัจจุบันต่อหน่วย (บาท)";
    $("quickUpdateValue").value = a.currentValuePerUnit;
    updatePriceCheckLink($("quickUpdatePriceCheckLink"), a.name, a.type);
    $("quickUpdateFetchMarket").value = guessMarketCode(a.market);
    $("quickUpdateFetchResult").textContent = "";
    $("assetQuickUpdateModal").hidden = false;
    pushNavState("assetquick");
  }
  function closeQuickUpdateVisual() { $("assetQuickUpdateModal").hidden = true; }
  function closeQuickUpdate() { closeQuickUpdateVisual(); popNavState(); }

  async function saveQuickUpdate() {
    const id = $("quickUpdateAssetId").value;
    const a = allAssets.find((x) => x.id === id);
    if (!a) return;
    const newValue = parseFloat($("quickUpdateValue").value);
    if (isNaN(newValue) || newValue < 0) { showToast("กรุณาใส่มูลค่าที่ถูกต้อง"); return; }
    a.currentValuePerUnit = newValue;
    a.updatedAt = new Date().toISOString();
    await DiaryDB.putAsset(a);
    closeQuickUpdateVisual();
    popNavState();
    render();
    showToast("อัปเดตมูลค่าแล้ว");
  }

  function assetDetailLines(a, includeHeader) {
    const value = assetValueTHB(a);
    const cost = assetCostTHB(a);
    const gain = value - cost;
    const gainPct = cost > 0 ? (gain / cost) * 100 : 0;
    const unitLabel = a.currency === "USD" ? `$${a.currentValuePerUnit}` : Finance.formatMoney(a.currentValuePerUnit);
    const updatedLabel = formatFullThaiDate((a.updatedAt || a.createdAt).slice(0, 10));
    const lines = [
      includeHeader ? `📊 ทรัพย์สิน — ${a.name} (${a.type})` : `${a.name} (${a.type})`,
      `${a.quantity} หน่วย @ ${unitLabel}`,
      `มูลค่า: ${Finance.formatMoney(value)}`,
      `${gain >= 0 ? "+" : ""}${Finance.formatMoney(gain)} (${gainPct >= 0 ? "+" : ""}${gainPct.toFixed(1)}%)`,
      `อัปเดตราคาล่าสุด: ${updatedLabel}`,
    ];
    if (a.note) lines.push("หมายเหตุ: " + a.note);
    return lines;
  }

  function buildAssetText(a) {
    return assetDetailLines(a, true).join("\n");
  }

  async function sendAssetToTelegram(id) {
    const a = allAssets.find((x) => x.id === id);
    if (!a) return;
    if (typeof TelegramNotify === "undefined" || !TelegramNotify.isConfigured()) {
      showToast("ยังไม่ได้ตั้งค่า Telegram (ตั้งค่า → Telegram)");
      return;
    }
    try {
      await TelegramNotify.sendMessage(buildAssetText(a));
      showToast("ส่งเข้า Telegram แล้ว");
    } catch (err) {
      showToast("ส่งไม่สำเร็จ: " + (err && err.message ? err.message : ""));
    }
  }

  async function sendPortfolioSummary() {
    if (typeof TelegramNotify === "undefined" || !TelegramNotify.isConfigured()) {
      showToast("ยังไม่ได้ตั้งค่า Telegram (ตั้งค่า → Telegram)");
      return;
    }
    const items = activeAssets().slice().sort((a, b) => assetValueTHB(b) - assetValueTHB(a));
    const wallets = (typeof Finance !== "undefined") ? Finance.getWalletOptions() : [];

    // Nothing in Banking is encrypted anymore, so no unlock gate is needed
    // here at all — just pull the list directly.
    let debts = [];
    if (typeof Banking !== "undefined") {
      debts = await Banking.getDebtsList();
    }

    if (items.length === 0 && wallets.length === 0 && debts.length === 0) { showToast("ยังไม่มีข้อมูลให้ส่ง"); return; }

    const now = new Date();
    const nowLabel = `${formatFullThaiDate(todayISO())} ${now.toTimeString().slice(0, 5)} น.`;
    const lines = [`📊 สรุปการเงินทั้งหมด — ${nowLabel}`, ""];

    let walletTotal = 0;
    if (wallets.length > 0) {
      lines.push("💰 กระเป๋าเงิน");
      wallets.forEach((o) => {
        const bal = Finance.computeWalletBalance(o.key);
        walletTotal += bal;
        lines.push(`${o.label}: ${Finance.formatMoney(bal)}`);
        // Deliberate exception to "encrypted data never leaves the
        // device" — the account number + owner name (not branch/note).
        if (o.key.indexOf("bank:") === 0 && typeof Banking !== "undefined") {
          const acc = Banking.findBankAccountById(o.key.slice(5));
          if (acc && acc.accountNumber) lines.push(`  เลขบัญชี: ${acc.accountNumber}`);
          if (acc && acc.ownerName) lines.push(`  ชื่อบัญชี: ${acc.ownerName}`);
        }
        lines.push(""); // blank line between each account — with 20+ accounts, no gap makes them run together
      });
      lines.push(`รวมกระเป๋าเงิน: ${Finance.formatMoney(walletTotal)}`);
    }

    if (debts.length > 0) {
      lines.push("---------------", "💳 หนี้สิน");
      debts.forEach((d) => {
        lines.push(d.debtName || "(ไม่มีชื่อ)");
        lines.push(`  เจ้าหนี้: ${d.creditor || "-"}`);
        lines.push(`  ยอดกู้: ${Finance.formatMoney(parseFloat(d.originalAmount) || 0)}`);
        lines.push(`  ค่างวด: ${Finance.formatMoney(parseFloat(d.installmentAmount) || 0)}`);
        lines.push(`  วันชำระ: ${d.dueDay || "-"}`);
        lines.push("");
      });
    }

    let assetTotal = 0, assetCost = 0;
    if (items.length > 0) {
      lines.push("---------------", "📈 ทรัพย์สิน");
      items.forEach((a) => {
        assetTotal += assetValueTHB(a);
        assetCost += assetCostTHB(a);
        lines.push(...assetDetailLines(a, false), "");
      });
      const assetGain = assetTotal - assetCost;
      lines.push(`รวมทรัพย์สิน: ${Finance.formatMoney(assetTotal)} (${assetGain >= 0 ? "+" : ""}${Finance.formatMoney(assetGain)})`);
    }

    lines.push("---------------", `💵 มูลค่าสุทธิรวมทั้งหมด: ${Finance.formatMoney(walletTotal + assetTotal)}`);
    if (items.length > 0) {
      lines.push("", "ℹ️ ราคาหุ้น/ETF เป็นค่าที่อัปเดตด้วยมือเป็นระยะ ไม่ใช่ราคาตลาดเรียลไทม์");
    }

    $("sendPortfolioBtn").disabled = true;
    try {
      await TelegramNotify.sendMessage(lines.join("\n"));
      showToast("ส่งสรุปการเงินเข้า Telegram แล้ว");
    } catch (err) {
      showToast("ส่งไม่สำเร็จ: " + (err && err.message ? err.message : ""));
    } finally {
      $("sendPortfolioBtn").disabled = false;
    }
  }

  /* ---------------- buy/sell log ---------------- */

  function populateAssetLogNameList() {
    const dl = $("assetLogNameList");
    if (!dl) return;
    const names = [...new Set(activeAssets().map((a) => a.name))];
    dl.innerHTML = names.map((n) => `<option value="${escapeHTML(n)}"></option>`).join("");
  }

  function openAssetLogModal() {
    populateAssetLogNameList();
    $("assetLogName").value = "";
    $("assetLogAction").value = "BUY";
    $("assetLogQuantity").value = "";
    $("assetLogPrice").value = "";
    const today = todayISO();
    $("assetLogDateValue").value = today;
    $("assetLogDateBtn").textContent = formatFullThaiDate(today);
    renderAssetLogList();
    $("assetLogModal").hidden = false;
    pushNavState("assetlog");
  }
  function closeAssetLogModalVisual() { $("assetLogModal").hidden = true; }
  function closeAssetLogModal() { closeAssetLogModalVisual(); popNavState(); }

  function renderAssetLogList() {
    const el = $("assetLogList");
    if (!el) return;
    const logs = allAssetLogs.slice().sort((a, b) => (b.date + (b.createdAt || "")).localeCompare(a.date + (a.createdAt || "")));
    if (logs.length === 0) { el.innerHTML = '<p class="settings-note">ยังไม่มีประวัติ</p>'; return; }
    el.innerHTML = logs.map((l) => `
      <div class="asset-log-row">
        <div class="asset-log-row-body">
          <div class="asset-log-row-title">${escapeHTML(l.name)} <span class="asset-log-action ${l.action === "BUY" ? "buy" : "sell"}">${l.action === "BUY" ? "ซื้อ" : "ขาย"}</span></div>
          <div class="asset-log-row-sub">${formatFullThaiDate(l.date)} · จำนวน ${l.quantity}${l.price ? ` · ราคา ${Finance.formatMoney(l.price)}/หน่วย` : ""}</div>
        </div>
        <button type="button" class="asset-log-delete-btn" data-id="${l.id}" aria-label="ลบ">🗑️</button>
      </div>`).join("");
  }

  async function addAssetLogEntry() {
    const name = $("assetLogName").value.trim();
    const quantity = parseFloat($("assetLogQuantity").value);
    if (!name) { showToast("กรุณาใส่ชื่อทรัพย์สิน"); return; }
    if (!quantity || quantity <= 0) { showToast("กรุณาใส่จำนวนที่ถูกต้อง"); return; }
    const rec = {
      id: uid(),
      name,
      action: $("assetLogAction").value,
      quantity,
      price: parseFloat($("assetLogPrice").value) || null,
      date: $("assetLogDateValue").value || todayISO(),
      createdAt: new Date().toISOString(),
    };
    await DiaryDB.putAssetLog(rec);
    allAssetLogs.push(rec);
    $("assetLogQuantity").value = "";
    $("assetLogPrice").value = "";
    renderAssetLogList();
    showToast("เพิ่มรายการแล้ว");
  }

  async function deleteAssetLogEntry(id) {
    if (!confirm("ลบรายการนี้หรือไม่?")) return;
    await DiaryDB.removeAssetLog(id);
    allAssetLogs = allAssetLogs.filter((l) => l.id !== id);
    renderAssetLogList();
  }

  async function handleFetchPriceClick(symbol, market, resultElId, targetInputId, currencySetter, assetId) {
    const resultEl = $(resultElId);
    if (!symbol) { showToast("กรุณาใส่ชื่อ/สัญลักษณ์ก่อน"); return; }
    resultEl.textContent = "กำลังดึงราคา...";
    try {
      const data = await fetchLivePrice(symbol, market);
      if (targetInputId) $(targetInputId).value = data.price;
      if (data.currency === "USD" && currencySetter) currencySetter("USD");
      const changeSign = data.change >= 0 ? "+" : "";
      resultEl.textContent = `✅ ${data.name || symbol}: ${data.price} ${data.currency} (${changeSign}${data.changePct.toFixed(2)}%) — อัปเดต ${new Date(data.updatedAt).toLocaleString("th-TH")}`;
      // Cache the full response on the asset record itself (RSI/MACD/EMA/
      // P/E/EPS/PEG etc.) so the detail view can show it without a fresh
      // fetch every time it's opened.
      if (assetId) {
        const a = allAssets.find((x) => x.id === assetId);
        if (a) {
          a.marketData = data;
          a.marketDataAt = new Date().toISOString();
          await DiaryDB.putAsset(a);
        }
      }
      return data;
    } catch (err) {
      resultEl.textContent = `❌ ดึงราคาไม่สำเร็จ: ${err.message} — ลองเช็คด้วยตนเองแทน หรือเปลี่ยนตลาดที่เลือก`;
      return null;
    }
  }

  /* ---------------- asset detail view (rich market data) ---------------- */

  let assetDetailCurrentId = null;

  function openAssetDetail(id) {
    const a = allAssets.find((x) => x.id === id);
    if (!a) return;
    assetDetailCurrentId = id;
    $("assetDetailTitle").innerHTML = `${assetLogoHTML(a.name)} ${escapeHTML(a.name)}`;
    const unitLabel = a.currency === "USD" ? `$${a.currentValuePerUnit}` : Finance.formatMoney(a.currentValuePerUnit);
    $("assetDetailBasic").innerHTML = `${escapeHTML(a.type)} · ${a.quantity} หน่วย @ ${unitLabel}${a.market ? " · " + escapeHTML(a.market) : ""}${a.broker ? " · " + escapeHTML(a.broker) : ""}`;
    if (a.marketData) {
      renderAssetDetailData(a.marketData);
      const ageHours = (Date.now() - new Date(a.marketDataAt).getTime()) / 3600000;
      $("assetDetailStale").hidden = ageHours < 24;
    } else {
      $("assetDetailMarketData").innerHTML = '<p class="settings-note">ยังไม่มีข้อมูลตลาดสำหรับรายการนี้ — กด "ดึง/อัปเดตข้อมูลตลาด" ด้านล่าง</p>';
      $("assetDetailStale").hidden = true;
    }
    $("assetDetailTvSymbol").value = a.tvSymbol || guessTvSymbol(a.name, guessMarketCode(a.market));
    loadTradingViewChart($("assetDetailTvSymbol").value);
    $("assetDetailModal").hidden = false;
    pushNavState("assetdetail");
  }
  function closeAssetDetailModalVisual() { $("assetDetailModal").hidden = true; }
  function closeAssetDetailModal() { closeAssetDetailModalVisual(); popNavState(); }

  function guessTvSymbol(name, marketCode) {
    const ticker = (name || "").trim().toUpperCase().replace(/[^A-Z0-9.]/g, "");
    if (marketCode === "TH") return `SET:${ticker}`;
    if (marketCode === "HK") return `HKEX:${ticker}`;
    return `NASDAQ:${ticker}`; // best guess for US — many large names are actually NYSE, TradingView's widget still often resolves it, or the user corrects it manually below
  }

  /** TradingView's free embed widget — a real chart with actual historical
   *  price data, unlike anything we could build from the quote proxy's
   *  single current-snapshot response. No API key, but it's a <script>
   *  tag whose JSON config is its text content, so it has to be built
   *  with createElement (innerHTML never executes scripts) and the
   *  container cleared first so re-opening the modal doesn't stack up
   *  duplicate widgets underneath each other. */
  function loadTradingViewChart(symbol) {
    const wrap = $("assetDetailChartWrap");
    wrap.innerHTML = "";
    if (!symbol) return;
    // Switched from the "auto-init" embed script (a <script> tag that's
    // meant to read its own inline JSON config and inject an iframe on
    // execution) to a plain iframe pointing at TradingView's widget page
    // directly. The script version is written for scripts already present
    // when the page is parsed — dynamically created+appended scripts often
    // can't reliably find their own container via document.currentScript,
    // so it can silently render nothing. A bare iframe has no such
    // dependency and just works once given a URL.
    const config = {
      symbol, width: "100%", height: "220", locale: "th",
      dateRange: "12M", colorTheme: "dark", isTransparent: true,
    };
    const iframe = document.createElement("iframe");
    iframe.src = `https://s.tradingview.com/embed-widget/mini-symbol-overview/#${encodeURIComponent(JSON.stringify(config))}`;
    iframe.style.width = "100%";
    iframe.style.height = "220px";
    iframe.style.border = "none";
    iframe.setAttribute("scrolling", "no");
    iframe.setAttribute("allowtransparency", "true");
    iframe.setAttribute("frameborder", "0");
    wrap.appendChild(iframe);
  }

  // A one-line plain-language gloss for each jargon term — shown right
  // under the label in the table instead of a hover tooltip (tooltips
  // don't work reliably on mobile taps).
  const METRIC_GLOSS = {
    "RSI (14 วัน)": "วัดความแรงซื้อ/ขายช่วงสั้น (0-100, เกิน 70=ซื้อเยอะ ต่ำกว่า 30=ขายเยอะ)",
    "RSI (14 สัปดาห์)": "แบบเดียวกับ RSI 14 วัน แต่มองภาพระยะยาวกว่า",
    "MACD vs Signal": "เส้นแนวโน้ม 2 เส้น — ถ้า MACD สูงกว่า Signal มักตีความว่าแนวโน้มเป็นบวก",
    "EMA50 (วัน) vs ราคา": "ราคาเฉลี่ยเคลื่อนที่ 50 วัน — ราคาปัจจุบันอยู่เหนือ/ใต้เส้นนี้บอกแนวโน้มระยะกลาง",
    "EMA50 (สัปดาห์) vs ราคา": "แบบเดียวกับ EMA50 วัน แต่เป็นรายสัปดาห์ ภาพรวมยาวกว่า",
    "P/E": "ราคาหุ้นเทียบกำไรต่อหุ้น — ยิ่งสูงมักแปลว่าตลาดคาดหวังการเติบโตสูง",
    "EPS": "กำไรสุทธิต่อหุ้น (บาท/ดอลลาร์ต่อหุ้น)",
    "EPS Growth": "อัตราการเติบโตของกำไรต่อหุ้นเทียบปีก่อน",
    "PEG": "P/E หารด้วยอัตราการเติบโต — ต่ำกว่า 1 มักตีความว่าราคายังไม่แพงเทียบการเติบโต",
    "ช่วง 52 สัปดาห์": "ราคาต่ำสุด-สูงสุดในรอบ 1 ปีที่ผ่านมา",
  };

  function rsiLabel(rsi) {
    if (rsi == null) return "";
    if (rsi >= 70) return " (ซื้อมากเกินไป)";
    if (rsi <= 30) return " (ขายมากเกินไป)";
    return " (ปกติ)";
  }
  function rsiTier(rsi) {
    if (rsi == null) return "";
    if (rsi >= 70) return "negative";
    if (rsi <= 30) return "positive";
    return "";
  }

  function renderAssetDetailData(data) {
    const el = $("assetDetailMarketData");
    const changeSign = data.change >= 0 ? "+" : "";
    const changeTier = data.change >= 0 ? "positive" : "negative";

    const rows = [];
    if (data.high52w != null && data.low52w != null) {
      const pct = data.high52w > data.low52w ? Math.round(((data.price - data.low52w) / (data.high52w - data.low52w)) * 100) : null;
      rows.push(["ช่วง 52 สัปดาห์", `${data.low52w} – ${data.high52w}${pct != null ? ` (ตอนนี้ ${pct}%)` : ""}`, ""]);
    }
    if (data.rsi14 != null) rows.push(["RSI (14 วัน)", `${data.rsi14.toFixed(1)}${rsiLabel(data.rsi14)}`, rsiTier(data.rsi14)]);
    if (data.rsi14w != null) rows.push(["RSI (14 สัปดาห์)", `${data.rsi14w.toFixed(1)}${rsiLabel(data.rsi14w)}`, rsiTier(data.rsi14w)]);
    if (data.macd != null && data.macdSignal != null) rows.push(["MACD vs Signal", `${data.macd.toFixed(2)} / ${data.macdSignal.toFixed(2)}`, data.macd >= data.macdSignal ? "positive" : "negative"]);
    if (data.ema50 != null) rows.push(["EMA50 (วัน) vs ราคา", `${data.ema50.toFixed(2)} ${data.price >= data.ema50 ? "(ราคาสูงกว่า)" : "(ราคาต่ำกว่า)"}`, data.price >= data.ema50 ? "positive" : "negative"]);
    if (data.ema50w != null) rows.push(["EMA50 (สัปดาห์) vs ราคา", `${data.ema50w.toFixed(2)} ${data.price >= data.ema50w ? "(ราคาสูงกว่า)" : "(ราคาต่ำกว่า)"}`, data.price >= data.ema50w ? "positive" : "negative"]);
    if (data.pe != null) rows.push(["P/E", data.pe.toFixed(2), ""]);
    if (data.eps != null) rows.push(["EPS", data.eps.toFixed(2), ""]);
    if (data.epsGrowth != null) rows.push(["EPS Growth", `${data.epsGrowth >= 0 ? "+" : ""}${data.epsGrowth.toFixed(1)}%`, data.epsGrowth >= 0 ? "positive" : "negative"]);
    if (data.peg != null) rows.push(["PEG", data.peg.toFixed(2), ""]);

    el.innerHTML = `
      <div class="asset-detail-price">
        <span class="asset-detail-price-num">${data.price} ${data.currency}</span>
        <span class="asset-detail-change ${changeTier}">${changeSign}${data.change.toFixed(2)} (${changeSign}${data.changePct.toFixed(2)}%)</span>
      </div>
      <div class="asset-detail-table">
        ${rows.map(([label, value, tier]) => `
          <div class="asset-detail-row">
            <span class="asset-detail-label">${escapeHTML(label)}${METRIC_GLOSS[label] ? `<span class="asset-detail-gloss">${escapeHTML(METRIC_GLOSS[label])}</span>` : ""}</span>
            <span class="asset-detail-val ${tier}">${escapeHTML(value)}</span>
          </div>`).join("")}
      </div>
      <p class="settings-note">ที่มา: ${escapeHTML(data.source || "ไม่ทราบ")} · อัปเดต ${new Date(data.updatedAt).toLocaleString("th-TH")}</p>`;
  }

  async function render() {
    allAssets = await DiaryDB.getAllAssets();
    renderAssetList();
  }

  function wireEvents() {
    $("addAssetBtn").addEventListener("click", openNewAsset);
    $("assetCancelBtn").addEventListener("click", closeAssetModal);
    $("assetSaveBtn").addEventListener("click", saveAsset);
    $("assetDeleteBtn").addEventListener("click", deleteAsset);
    $("assetCurrency").addEventListener("change", (e) => setAssetCurrency(e.target.value));
    $("assetName").addEventListener("input", (e) => updatePriceCheckLink($("assetPriceCheckLink"), e.target.value, $("assetType").value));
    $("assetType").addEventListener("change", () => updatePriceCheckLink($("assetPriceCheckLink"), $("assetName").value, $("assetType").value));
    $("sendPortfolioBtn").addEventListener("click", sendPortfolioSummary);
    $("assetList").addEventListener("click", (e) => {
      const quickBtn = e.target.closest(".asset-quick-update-btn");
      if (quickBtn) { openQuickUpdate(quickBtn.dataset.id); return; }
      const sendBtn = e.target.closest(".asset-send-btn");
      if (sendBtn) { sendAssetToTelegram(sendBtn.dataset.id); return; }
      const row = e.target.closest(".asset-row");
      if (row) openAssetDetail(row.dataset.id);
    });
    $("quickUpdateCancelBtn").addEventListener("click", closeQuickUpdate);
    $("quickUpdateSaveBtn").addEventListener("click", saveQuickUpdate);

    $("assetFetchPriceBtn").addEventListener("click", () => {
      handleFetchPriceClick($("assetName").value.trim(), $("assetFetchMarket").value, "assetFetchResult", "assetCurrentValue", setAssetCurrency, $("assetId").value || null);
    });
    $("quickUpdateFetchPriceBtn").addEventListener("click", () => {
      const a = allAssets.find((x) => x.id === $("quickUpdateAssetId").value);
      handleFetchPriceClick(a ? a.name : "", $("quickUpdateFetchMarket").value, "quickUpdateFetchResult", "quickUpdateValue", null, a ? a.id : null);
    });

    $("assetDetailCloseBtn").addEventListener("click", closeAssetDetailModal);
    $("assetDetailTvApplyBtn").addEventListener("click", async () => {
      const symbol = $("assetDetailTvSymbol").value.trim();
      loadTradingViewChart(symbol);
      const a = allAssets.find((x) => x.id === assetDetailCurrentId);
      if (a) { a.tvSymbol = symbol; await DiaryDB.putAsset(a); }
    });
    $("assetDetailEditBtn").addEventListener("click", () => {
      const id = assetDetailCurrentId;
      closeAssetDetailModalVisual();
      popNavState();
      openEditAsset(id);
    });
    $("assetDetailFetchBtn").addEventListener("click", async () => {
      const a = allAssets.find((x) => x.id === assetDetailCurrentId);
      if (!a) return;
      $("assetDetailMarketData").innerHTML = '<p class="settings-note">กำลังดึงข้อมูล...</p>';
      try {
        const data = await fetchLivePrice(a.name, guessMarketCode(a.market));
        a.marketData = data;
        a.marketDataAt = new Date().toISOString();
        await DiaryDB.putAsset(a);
        renderAssetDetailData(data);
        $("assetDetailStale").hidden = true;
        renderAssetList(); // refresh list in case it shows cached data too
      } catch (err) {
        $("assetDetailMarketData").innerHTML = `<p class="settings-note">❌ ดึงข้อมูลไม่สำเร็จ: ${escapeHTML(err.message)}</p>`;
      }
    });

    $("assetGroupFilter").addEventListener("click", (e) => {
      const btn = e.target.closest(".entry-type-filter-btn");
      if (!btn) return;
      groupMode = btn.dataset.group;
      document.querySelectorAll("#assetGroupFilter .entry-type-filter-btn").forEach((b) => b.classList.toggle("selected", b === btn));
      renderAssetList();
    });

    $("assetLogOpenBtn").addEventListener("click", openAssetLogModal);
    $("assetLogCloseBtn").addEventListener("click", closeAssetLogModal);
    $("assetLogAddBtn").addEventListener("click", addAssetLogEntry);
    $("assetLogDateBtn").addEventListener("click", () => {
      openCalendarForPick($("assetLogDateValue").value || todayISO(), (d) => {
        $("assetLogDateValue").value = d;
        $("assetLogDateBtn").textContent = formatFullThaiDate(d);
      });
    });
    $("assetTop5").addEventListener("click", (e) => {
      const row = e.target.closest(".asset-top5-row");
      if (row) openAssetDetail(row.dataset.id);
    });
    $("assetLogList").addEventListener("click", (e) => {
      const delBtn = e.target.closest(".asset-log-delete-btn");
      if (delBtn) deleteAssetLogEntry(delBtn.dataset.id);
    });
  }

  async function init() {
    wireEvents();
    allAssets = await DiaryDB.getAllAssets();
    allAssetLogs = await DiaryDB.getAllAssetLogs();
  }

  return { init, render, closeAssetModalVisual, closeQuickUpdateVisual, closeAssetLogModalVisual, closeAssetDetailModalVisual };
})();
