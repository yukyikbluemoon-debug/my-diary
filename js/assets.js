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
    items.forEach((a) => {
      const value = assetValueTHB(a);
      const cost = assetCostTHB(a);
      totalValue += value;
      totalCost += cost;
      const gain = value - cost;
      const gainPct = cost > 0 ? (gain / cost) * 100 : 0;
      const row = document.createElement("div");
      row.className = "asset-row";
      row.dataset.id = a.id;
      const unitLabel = a.currency === "USD" ? `$${a.currentValuePerUnit}` : Finance.formatMoney(a.currentValuePerUnit);
      row.innerHTML = `
        <div class="asset-row-body">
          <div class="asset-row-title">${escapeHTML(a.name)}</div>
          <div class="asset-row-sub">${escapeHTML(a.type)} · ${a.quantity} หน่วย @ ${unitLabel}</div>
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
    $("assetList").addEventListener("click", (e) => {
      const row = e.target.closest(".asset-row");
      if (row) openEditAsset(row.dataset.id);
    });
  }

  async function init() {
    wireEvents();
    allAssets = await DiaryDB.getAllAssets();
  }

  return { init, render, closeAssetModalVisual };
})();
