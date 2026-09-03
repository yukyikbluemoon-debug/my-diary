/* assets.js — portfolio / net-worth tracking (stocks, ETFs, crypto, gold,
   cash, etc). Values are entered and updated by hand — this module never
   fetches live prices, on purpose (keeps the app fully offline-capable and
   avoids depending on a paid/rate-limited price API). */

const Assets = (() => {
  let allAssets = []; // includes soft-deleted; filter with activeAssets()

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
    $("assetNote").value = "";
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
    $("assetNote").value = a.note || "";
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

  function renderAssetList() {
    const items = activeAssets().slice().sort((a, b) => assetValueTHB(b) - assetValueTHB(a));
    const list = $("assetList");
    list.innerHTML = "";
    $("assetEmptyState").hidden = items.length > 0;

    let totalValue = 0, totalCost = 0;
    const typeTotals = {};
    items.forEach((a) => {
      const value = assetValueTHB(a);
      const cost = assetCostTHB(a);
      totalValue += value;
      totalCost += cost;
      typeTotals[a.type] = (typeTotals[a.type] || 0) + value;
      const gain = value - cost;
      const gainPct = cost > 0 ? (gain / cost) * 100 : 0;
      const row = document.createElement("div");
      row.className = "asset-row";
      row.dataset.id = a.id;
      const unitLabel = a.currency === "USD" ? `$${a.currentValuePerUnit}` : Finance.formatMoney(a.currentValuePerUnit);
      const updatedLabel = typeof formatDateHeading === "function" ? formatDateHeading((a.updatedAt || a.createdAt).slice(0, 10)) : (a.updatedAt || "").slice(0, 10);
      row.innerHTML = `
        <button type="button" class="asset-quick-update-btn" data-id="${a.id}" aria-label="อัปเดตมูลค่า">🔄</button>
        <button type="button" class="asset-send-btn" data-id="${a.id}" aria-label="ส่งเข้า Telegram">📨</button>
        <div class="asset-row-body">
          <div class="asset-row-title">${escapeHTML(a.name)}</div>
          <div class="asset-row-sub">${escapeHTML(a.type)} · ${a.quantity} หน่วย @ ${unitLabel}</div>
          <div class="asset-row-updated">อัปเดตล่าสุด ${updatedLabel}</div>
        </div>
        <div class="asset-row-value">
          <div class="asset-row-total">${Finance.formatMoney(value)}</div>
          <div class="asset-row-gain ${gain >= 0 ? "positive" : "negative"}">${gain >= 0 ? "+" : ""}${Finance.formatMoney(gain)} (${gainPct >= 0 ? "+" : ""}${gainPct.toFixed(1)}%)</div>
        </div>`;
      list.appendChild(row);
    });

    $("assetTotalValue").textContent = Finance.formatMoney(totalValue);
    const totalGain = totalValue - totalCost;
    $("assetTotalGain").textContent = (totalGain >= 0 ? "+" : "") + Finance.formatMoney(totalGain);

    const typeRows = Object.entries(typeTotals).sort((a, b) => b[1] - a[1]).map(([label, amount]) => ({ label, count: amount, displayText: Finance.formatMoney(amount) }));
    const chartEl = $("assetTypeChart");
    if (typeRows.length === 0) { chartEl.innerHTML = ""; }
    else {
      const max = Math.max(...typeRows.map((r) => r.count), 1);
      chartEl.innerHTML = typeRows.map((r) => `
        <div class="stat-bar-row">
          <span class="stat-bar-label">${escapeHTML(r.label)}</span>
          <span class="stat-bar-track"><span class="stat-bar-fill" style="width:${Math.round((r.count / max) * 100)}%"></span></span>
          <span class="stat-bar-count" style="width:auto;">${escapeHTML(r.displayText)}</span>
        </div>`).join("");
    }
  }

  function openQuickUpdate(id) {
    const a = allAssets.find((x) => x.id === id);
    if (!a) return;
    $("quickUpdateAssetId").value = a.id;
    $("quickUpdateAssetName").textContent = `${a.name} (${a.type})`;
    $("quickUpdateValueLabel").textContent = a.currency === "USD" ? "มูลค่าปัจจุบันต่อหน่วย (USD)" : "มูลค่าปัจจุบันต่อหน่วย (บาท)";
    $("quickUpdateValue").value = a.currentValuePerUnit;
    updatePriceCheckLink($("quickUpdatePriceCheckLink"), a.name, a.type);
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
    if (items.length === 0 && wallets.length === 0) { showToast("ยังไม่มีข้อมูลให้ส่ง"); return; }

    // This summary includes full account numbers for bank wallets (by
    // request — so the number is on hand when a bank employee asks for it
    // during a real transfer), so it needs an unlock every time, even
    // though the individual wallet-balance list elsewhere in the app does
    // not.
    const hasBankWallet = wallets.some((o) => o.key.indexOf("bank:") === 0);
    if (hasBankWallet) {
      if (!DiaryCrypto.hasPassword()) { showToast("กรุณาตั้งรหัสผ่านก่อน"); openSetPwModal("create"); return; }
      const ok = await ensureUnlocked("เพื่อส่งสรุปพร้อมเลขบัญชีเต็ม");
      if (!ok) return;
    }

    const now = new Date();
    const nowLabel = `${formatFullThaiDate(todayISO())} ${now.toTimeString().slice(0, 5)} น.`;
    const lines = [`📊 สรุปการเงินทั้งหมด — ${nowLabel}`, ""];

    let walletTotal = 0;
    if (wallets.length > 0) {
      lines.push("💰 กระเป๋าเงิน");
      for (const o of wallets) {
        const bal = Finance.computeWalletBalance(o.key);
        walletTotal += bal;
        lines.push(`${o.label}: ${Finance.formatMoney(bal)}`);
        // Deliberate exception to "encrypted data never leaves the
        // device" — only in this explicit full-summary send, and only
        // the account number + owner name (not branch/note).
        if (o.key.indexOf("bank:") === 0 && typeof Banking !== "undefined") {
          const details = await Banking.getFullDetails(o.key.slice(5));
          if (details && details.accountNumber) lines.push(`  เลขบัญชี: ${details.accountNumber}`);
          if (details && details.ownerName) lines.push(`  ชื่อบัญชี: ${details.ownerName}`);
        }
        lines.push(""); // blank line between each account — with 20+ accounts, no gap makes them run together
      }
      lines.push(`รวมกระเป๋าเงิน: ${Finance.formatMoney(walletTotal)}`);
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
      if (row) openEditAsset(row.dataset.id);
    });
    $("quickUpdateCancelBtn").addEventListener("click", closeQuickUpdate);
    $("quickUpdateSaveBtn").addEventListener("click", saveQuickUpdate);
  }

  async function init() {
    wireEvents();
    allAssets = await DiaryDB.getAllAssets();
  }

  return { init, render, closeAssetModalVisual, closeQuickUpdateVisual };
})();
