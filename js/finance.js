/* finance.js — income/expense/transfer tracking, separate from the diary
   but sharing the same IndexedDB (via DiaryDB) and the same app shell
   (calendar date-picker, toasts, nav helpers) from app.js.

   Categories and wallets are just short config lists, so they live in
   localStorage (like theme settings) rather than as IndexedDB records. */

const Finance = (() => {
  const CAT_KEY = "diary_fin_categories";
  const DEFAULT_CATEGORIES = ["เงินเดือน", "อาหาร", "เดินทาง", "บ้าน", "โทรศัพท์", "ของใช้", "ลงทุน", "หนี้", "สุขภาพ", "บันเทิง", "อื่นๆ"];
  const CASH_KEY = "cash";
  const CASH_LABEL = "เงินสด";

  let allTx = []; // cached in-memory copy of ALL transactions (including soft-deleted), kept in sync with DiaryDB

  function activeTx() {
    return allTx.filter((t) => !t.deletedAt);
  }

  /* ---------- categories config ---------- */

  function getCategories() {
    try { return JSON.parse(localStorage.getItem(CAT_KEY)) || DEFAULT_CATEGORIES.slice(); }
    catch (e) { return DEFAULT_CATEGORIES.slice(); }
  }
  function saveCategories(list) { localStorage.setItem(CAT_KEY, JSON.stringify(list)); }

  function addCategory(name) {
    const list = getCategories();
    if (!name || list.includes(name)) return;
    list.push(name);
    saveCategories(list);
  }
  function removeCategory(name) {
    saveCategories(getCategories().filter((c) => c !== name));
  }

  /* ---------- money sources ("wallets") ----------
     A transaction's `wallet`/`toWallet` field stores a STABLE KEY, never a
     display label:
       - "cash"        → เงินสด
       - "bank:<id>"    → a specific record in the Banking module's
                          bank_accounts store, id = that record's id
     Because the key is an id, renaming a bank account or changing its
     last-4 digits never breaks the link to existing transaction history —
     the display label is always resolved fresh, at render time, from
     whatever the bank account currently looks like. This is the fix for
     the "all balances went to 0" bug: the old design matched transactions
     against bank accounts by comparing display TEXT, which silently broke
     the moment that text changed for any reason. */

  function getWalletOptions() {
    const bankOptions = (typeof Banking !== "undefined") ? Banking.getBankAccountOptions() : [];
    return [{ key: CASH_KEY, label: CASH_LABEL }, ...bankOptions];
  }

  function walletLabel(key) {
    if (!key || key === CASH_KEY) return CASH_LABEL;
    if (key.indexOf("bank:") === 0) {
      const id = key.slice(5);
      return (typeof Banking !== "undefined") ? Banking.resolveBankLabelById(id) : "บัญชีธนาคาร";
    }
    return key; // legacy value from before this key scheme existed — show as-is rather than crash
  }

  /* ---------- formatting / calculation ---------- */

  function formatMoney(n) {
    const sign = n < 0 ? "-" : "";
    return sign + "฿" + Math.abs(n).toLocaleString("th-TH", { maximumFractionDigits: 2 });
  }

  function signedAmount(tx) {
    if (tx.type === "income") return tx.amount;
    if (tx.type === "expense") return -tx.amount;
    return 0; // transfers net to zero across the whole ledger (money just moves wallets)
  }

  function computeMonthSummary(txs, yyyymm) {
    let income = 0, expense = 0;
    txs.forEach((t) => {
      if (t.date.slice(0, 7) !== yyyymm) return;
      if (t.type === "income") income += t.amount;
      else if (t.type === "expense") expense += t.amount;
    });
    return { income, expense, net: income - expense };
  }

  function computeCategoryBreakdown(txs, yyyymm) {
    const totals = {};
    txs.forEach((t) => {
      if (t.type !== "expense" || t.date.slice(0, 7) !== yyyymm) return;
      totals[t.category || "อื่นๆ"] = (totals[t.category || "อื่นๆ"] || 0) + t.amount;
    });
    return Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([label, amount]) => ({ label, amount }));
  }

  function computeMonthlyRollup(txs, monthsBack) {
    const now = new Date();
    const rows = [];
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const s = computeMonthSummary(txs, key);
      rows.push({ label: `${THAI_MONTHS[d.getMonth()]} ${(d.getFullYear() + 543).toString().slice(2)}`, ...s });
    }
    return rows;
  }

  function computeWalletBalance(walletKey) {
    let balance = 0;
    activeTx().forEach((t) => {
      if (t.type === "income" && t.wallet === walletKey) balance += t.amount;
      else if (t.type === "expense" && t.wallet === walletKey) balance -= t.amount;
      else if (t.type === "transfer") {
        if (t.wallet === walletKey) balance -= t.amount;
        if (t.toWallet === walletKey) balance += t.amount;
      }
    });
    return balance;
  }

  function renderWalletBalances() {
    const options = getWalletOptions();
    const container = $("walletBalanceList");
    container.innerHTML = options.map((o) => {
      const bal = computeWalletBalance(o.key);
      return `<div class="wallet-balance-row"><span>${escapeHTML(o.label)}</span><span class="wallet-balance-amount${bal < 0 ? " negative" : ""}">${formatMoney(bal)}</span></div>`;
    }).join("");
  }

  /* ---------- search / filter ---------- */

  function populateFilterSelects() {
    const catSel = $("txFilterCategory");
    const currentCat = catSel.value;
    catSel.innerHTML = '<option value="">ทั้งหมด</option>' + getCategories().map((c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");
    catSel.value = currentCat;

    const walletSel = $("txFilterWallet");
    const currentWallet = walletSel.value;
    walletSel.innerHTML = '<option value="">ทั้งหมด</option>' + getWalletOptions().map((o) => `<option value="${escapeHTML(o.key)}">${escapeHTML(o.label)}</option>`).join("");
    walletSel.value = currentWallet;
  }

  function getFilteredTx() {
    const q = $("txSearchInput").value.trim().toLowerCase();
    const type = $("txFilterType").value;
    const category = $("txFilterCategory").value;
    const wallet = $("txFilterWallet").value;
    return activeTx().filter((t) => {
      if (type && t.type !== type) return false;
      if (category && t.category !== category) return false;
      if (wallet && t.wallet !== wallet && t.toWallet !== wallet) return false;
      if (q) {
        const hay = `${t.title || ""} ${t.note || ""} ${t.category || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  /* ---------- transaction form ---------- */

  let txType = "expense";
  let walletPickerTarget = null; // "txWallet" | "txToWallet" — which field the open picker is filling in

  function getWalletPickerRows() {
    const bankRows = (typeof Banking !== "undefined") ? Banking.getBankAccountPickerRows() : [];
    return [{ key: CASH_KEY, line1: CASH_LABEL, line2: "" }, ...bankRows];
  }

  function setWalletFieldValue(fieldId, key) {
    $(fieldId).value = key;
    const btn = $(fieldId + "Btn");
    const row = getWalletPickerRows().find((r) => r.key === key);
    if (!btn) return;
    if (!row) { btn.innerHTML = "<span>เลือกแหล่งเงิน</span>"; return; }
    btn.innerHTML = row.line2
      ? `<span>${escapeHTML(row.line1)}</span><span class="wpb-line2">${escapeHTML(row.line2)}</span>`
      : `<span>${escapeHTML(row.line1)}</span>`;
  }

  function renderWalletPickerList(query) {
    const q = (query || "").trim().toLowerCase();
    const rows = getWalletPickerRows().filter((r) => !q || (r.line1 + " " + r.line2).toLowerCase().includes(q));
    const currentKey = walletPickerTarget ? $(walletPickerTarget).value : "";
    const list = $("walletPickerList");
    if (rows.length === 0) { list.innerHTML = '<div class="wallet-picker-empty">ไม่พบรายการที่ตรงกับการค้นหา</div>'; return; }
    list.innerHTML = rows.map((r) => `
      <div class="wallet-picker-row${r.key === currentKey ? " selected" : ""}" data-key="${escapeHTML(r.key)}">
        <div class="wallet-picker-row-body">
          <div class="wallet-picker-row-line1">${escapeHTML(r.line1)}</div>
          ${r.line2 ? `<div class="wallet-picker-row-line2">${escapeHTML(r.line2)}</div>` : ""}
        </div>
        <span class="wallet-picker-row-check">✓</span>
      </div>`).join("");
  }

  function openWalletPicker(fieldId) {
    walletPickerTarget = fieldId;
    $("walletPickerSearch").value = "";
    renderWalletPickerList("");
    $("walletPickerModal").hidden = false;
    pushNavState("walletpicker");
  }
  function closeWalletPickerModalVisual() { $("walletPickerModal").hidden = true; }
  function closeWalletPickerModal() { closeWalletPickerModalVisual(); popNavState(); }

  function populateSelects() {
    const catSel = $("txCategory");
    const cats = getCategories();
    catSel.innerHTML = cats.map((c) => `<option value="${escapeHTML(c)}">${escapeHTML(c)}</option>`).join("");
    setWalletFieldValue("txWallet", CASH_KEY);
    setWalletFieldValue("txToWallet", CASH_KEY);
  }

  function setTxType(type) {
    txType = type;
    document.querySelectorAll(".tx-type-btn").forEach((b) => b.classList.toggle("selected", b.dataset.type === type));
    $("txCategoryField").hidden = type === "transfer";
    $("txToWalletField").hidden = type !== "transfer";
    $("txWalletLabel").textContent = type === "transfer" ? "จาก" : "แหล่งเงิน";
  }

  function setTxDate(dateStr) {
    $("txDate").value = dateStr;
    $("txDatePicker").textContent = formatFullThaiDate(dateStr);
  }

  let txCreatedCallback = null;

  function setTxCurrency(currency) {
    $("txCurrency").value = currency;
    const isUSD = currency === "USD";
    $("txExchangeRateField").hidden = !isUSD;
    $("txAmountLabel").textContent = isUSD ? "จำนวนเงิน (USD)" : "จำนวนเงิน (บาท)";
    if (isUSD && !$("txExchangeRate").value) {
      const lastRate = localStorage.getItem("diary_last_exchange_rate");
      if (lastRate) $("txExchangeRate").value = lastRate;
    }
    if (isUSD && typeof ExchangeRate !== "undefined") {
      const rate = ExchangeRate.getRate();
      $("txRateInfo").textContent = rate ? `อัตราในระบบ: ${rate.toFixed(2)} บาท (ปรับแก้ได้)` : "";
    }
    updateTxAmountPreview();
  }

  function updateTxAmountPreview() {
    const isUSD = $("txCurrency").value === "USD";
    const hint = $("txAmountConverted");
    if (!isUSD) { hint.textContent = ""; return; }
    const amount = parseFloat($("txAmount").value);
    const rate = parseFloat($("txExchangeRate").value);
    hint.textContent = (amount > 0 && rate > 0) ? `≈ ${formatMoney(amount * rate)}` : "";
  }

  function openNewTx(prefill, onCreated) {
    populateSelects();
    $("txId").value = "";
    setTxType((prefill && prefill.type) || "expense");
    setTxDate((prefill && prefill.date) || todayISO());
    $("txTitle").value = (prefill && prefill.title) || "";
    setTxCurrency("THB");
    $("txExchangeRate").value = "";
    $("txAmount").value = "";
    $("txNote").value = "";
    $("txModalTitle").textContent = "เพิ่มรายการเงิน";
    $("txDeleteBtn").hidden = true;
    txCreatedCallback = onCreated || null;
    $("txModal").hidden = false;
    pushNavState("tx");
  }

  function openEditTx(id) {
    const tx = allTx.find((t) => t.id === id);
    if (!tx) return;
    populateSelects();
    $("txId").value = tx.id;
    setTxType(tx.type);
    setTxDate(tx.date);
    $("txTitle").value = tx.title || "";
    $("txCategory").value = tx.category || "";
    setWalletFieldValue("txWallet", tx.wallet || CASH_KEY);
    if (tx.type === "transfer") setWalletFieldValue("txToWallet", tx.toWallet || CASH_KEY);
    if (tx.currency === "USD") {
      $("txExchangeRate").value = tx.exchangeRate || "";
      $("txAmount").value = tx.originalAmount != null ? tx.originalAmount : tx.amount;
      setTxCurrency("USD");
    } else {
      $("txAmount").value = tx.amount;
      setTxCurrency("THB");
    }
    $("txNote").value = tx.note || "";
    $("txModalTitle").textContent = "แก้ไขรายการเงิน";
    $("txDeleteBtn").hidden = false;
    $("txModal").hidden = false;
    pushNavState("tx");
  }

  function closeTxModalVisual() { $("txModal").hidden = true; }
  function closeTxModal() { txCreatedCallback = null; closeTxModalVisual(); popNavState(); }

  async function saveTx() {
    const date = $("txDate").value;
    const title = $("txTitle").value.trim();
    const enteredAmount = parseFloat($("txAmount").value);
    if (!date) { showToast("กรุณาเลือกวันที่"); return; }
    if (!title) { showToast("กรุณาใส่ชื่อรายการ"); return; }
    if (!enteredAmount || enteredAmount <= 0) { showToast("กรุณาใส่จำนวนเงินที่ถูกต้อง"); return; }
    const wallet = $("txWallet").value;
    if (txType === "transfer" && wallet === $("txToWallet").value) {
      showToast("กระเป๋าต้นทางและปลายทางต้องไม่ใช่อันเดียวกัน");
      return;
    }

    const currency = $("txCurrency").value;
    let amount = enteredAmount; // canonical amount is always stored in THB
    let exchangeRate = null;
    if (currency === "USD") {
      exchangeRate = parseFloat($("txExchangeRate").value);
      if (!exchangeRate || exchangeRate <= 0) { showToast("กรุณาใส่อัตราแลกเปลี่ยน"); return; }
      amount = enteredAmount * exchangeRate;
      localStorage.setItem("diary_last_exchange_rate", exchangeRate);
    }

    const id = $("txId").value || uid();
    const existing = allTx.find((t) => t.id === id);
    const tx = {
      id, date, type: txType, title,
      wallet,
      toWallet: txType === "transfer" ? $("txToWallet").value : null,
      category: txType === "transfer" ? null : $("txCategory").value,
      amount, // always THB — every existing summary/chart/rollup keeps working unchanged
      currency,
      originalAmount: currency === "USD" ? enteredAmount : null,
      exchangeRate,
      note: $("txNote").value.trim(),
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await DiaryDB.putTransaction(tx);
    const idx = allTx.findIndex((t) => t.id === id);
    if (idx >= 0) allTx[idx] = tx; else allTx.push(tx);

    if (!existing && typeof TelegramNotify !== "undefined") {
      TelegramNotify.sendTransaction(tx); // fire-and-forget, only on create (not edits)
    }

    closeTxModalVisual();
    popNavState();
    render();
    showToast("บันทึกแล้ว");
    if (txCreatedCallback) {
      const cb = txCreatedCallback;
      txCreatedCallback = null;
      cb(tx.id);
    }
  }

  async function deleteTx() {
    const id = $("txId").value;
    if (!id) return;
    if (!confirm("ลบรายการนี้หรือไม่?")) return;
    const tx = allTx.find((t) => t.id === id);
    if (!tx) return;
    // Soft-delete (not a hard remove): if we removed the record outright,
    // a later sync would just pull the still-existing remote copy back —
    // same bug that used to affect diary entries. A deletedAt flag with a
    // fresh updatedAt always wins the merge instead. Deleted transactions
    // are tiny and harmless to keep around forever, so there's no separate
    // trash/purge UI for these like the diary has.
    tx.deletedAt = new Date().toISOString();
    tx.updatedAt = new Date().toISOString();
    await DiaryDB.putTransaction(tx);
    closeTxModalVisual();
    popNavState();
    render();
    showToast("ลบแล้ว");
  }

  /* ---------- category manager modal ---------- */

  function renderMetaModal() {
    const catList = $("categoryMetaList");
    catList.innerHTML = getCategories().map((c) => `<span class="fin-meta-chip">${escapeHTML(c)}<button type="button" data-kind="cat" data-name="${escapeHTML(c)}">×</button></span>`).join("");
  }

  function openMetaModal() {
    renderMetaModal();
    $("finMetaModal").hidden = false;
    pushNavState("finmeta");
  }
  function closeFinMetaModalVisual() { $("finMetaModal").hidden = true; }
  function closeFinMetaModal() { closeFinMetaModalVisual(); popNavState(); }

  /* ---------- transaction list + summary rendering ---------- */

  function txIcon(tx) {
    if (tx.type === "income") return "💰";
    if (tx.type === "transfer") return "🔁";
    return "💸";
  }

  function renderTxList() {
    const active = getFilteredTx().sort((a, b) => (b.date + (b.createdAt || "")).localeCompare(a.date + (a.createdAt || "")));
    const list = $("txList");
    list.innerHTML = "";
    $("txEmptyState").hidden = active.length > 0;

    // Grouped by date (same pattern as the diary entry list) instead of one
    // long flat list — on busy days with many transactions, everything
    // used to blend together with no visual break between days.
    let currentDate = null;
    let groupDiv = null;
    active.forEach((tx) => {
      if (tx.date !== currentDate) {
        currentDate = tx.date;
        groupDiv = document.createElement("div");
        groupDiv.className = "date-group";
        groupDiv.innerHTML = `<div class="date-heading">${formatDateHeading(tx.date)}</div>`;
        list.appendChild(groupDiv);
      }

      const row = document.createElement("div");
      row.className = "tx-item";
      row.dataset.id = tx.id;
      const amountClass = tx.type;
      const sign = tx.type === "income" ? "+" : tx.type === "expense" ? "-" : "";
      const amountText = tx.currency === "USD"
        ? `${sign}$${tx.originalAmount.toLocaleString("en-US", { maximumFractionDigits: 2 })} (≈${formatMoney(tx.amount)})`
        : sign + formatMoney(tx.amount);
      const subParts = [];
      if (tx.type === "transfer") subParts.push(`${walletLabel(tx.wallet)} → ${walletLabel(tx.toWallet)}`);
      else subParts.push(tx.category || "", walletLabel(tx.wallet));
      if (tx.note) subParts.push(tx.note);
      row.innerHTML = `
        <span class="tx-item-icon">${txIcon(tx)}</span>
        <div class="tx-item-body">
          <div class="tx-item-title">${escapeHTML(tx.title)}</div>
          <div class="tx-item-sub">${subParts.filter(Boolean).map(escapeHTML).join(" · ")}</div>
        </div>
        <span class="tx-item-amount ${amountClass}">${amountText}</span>`;
      groupDiv.appendChild(row);
    });
  }

  function renderSummaryCards() {
    const thisMonth = todayISO().slice(0, 7);
    const s = computeMonthSummary(activeTx(), thisMonth);
    $("finIncomeThisMonth").textContent = formatMoney(s.income);
    $("finExpenseThisMonth").textContent = formatMoney(s.expense);
    $("finNetThisMonth").textContent = formatMoney(s.net);
  }

  function renderMonthlyChart() {
    const rows = computeMonthlyRollup(activeTx(), 6).map((r) => ({ label: r.label, count: r.income - r.expense, displayText: formatMoney(r.income - r.expense) }));
    renderBarChartMoney($("finMonthlyChart"), rows);
  }

  function renderCategoryChart() {
    const thisMonth = todayISO().slice(0, 7);
    const rows = computeCategoryBreakdown(activeTx(), thisMonth).slice(0, 8).map((r) => ({ label: r.label, count: r.amount, displayText: formatMoney(r.amount) }));
    renderBarChartMoney($("finCategoryChart"), rows);
  }

  function renderBarChartMoney(container, rows) {
    if (rows.length === 0) { container.innerHTML = '<p class="settings-note">ยังไม่มีข้อมูล</p>'; return; }
    const max = Math.max(...rows.map((r) => Math.abs(r.count)), 1);
    container.innerHTML = rows.map((r) => `
      <div class="stat-bar-row">
        <span class="stat-bar-label">${escapeHTML(r.label)}</span>
        <span class="stat-bar-track"><span class="stat-bar-fill" style="width:${Math.round((Math.abs(r.count) / max) * 100)}%"></span></span>
        <span class="stat-bar-count" style="width:auto;">${escapeHTML(r.displayText)}</span>
      </div>`).join("");
  }

  function renderRollupTable() {
    const rows = computeMonthlyRollup(activeTx(), 6);
    const head = `<div class="fin-rollup-row head"><span>เดือน</span><span>รายรับ</span><span>รายจ่าย</span><span>เงินเหลือ</span></div>`;
    const body = rows.map((r) => `<div class="fin-rollup-row"><span>${escapeHTML(r.label)}</span><span>${formatMoney(r.income)}</span><span>${formatMoney(r.expense)}</span><span>${formatMoney(r.net)}</span></div>`).join("");
    $("finRollupTable").innerHTML = head + body;
  }

  async function render() {
    allTx = await DiaryDB.getAllTransactions();
    renderSummaryCards();
    renderWalletBalances();
    renderMonthlyChart();
    renderCategoryChart();
    renderRollupTable();
    populateFilterSelects();
    renderTxList();
    if (typeof renderTodaySummary === "function") renderTodaySummary();
    if (typeof state !== "undefined" && state.view === "calendarPage" && typeof renderCalendarPage === "function") renderCalendarPage();
  }

  /* ---------- wiring ---------- */

  function wireEvents() {
    $("txSearchInput").addEventListener("input", renderTxList);
    $("txFilterType").addEventListener("change", renderTxList);
    $("txFilterCategory").addEventListener("change", renderTxList);
    $("txFilterWallet").addEventListener("change", renderTxList);
    $("txClearFilterBtn").addEventListener("click", () => {
      $("txSearchInput").value = "";
      $("txFilterType").value = "";
      $("txFilterCategory").value = "";
      $("txFilterWallet").value = "";
      renderTxList();
    });
    $("txFilterToggleBtn").addEventListener("click", () => {
      const panel = $("txFilterPanel");
      panel.hidden = !panel.hidden;
      $("txFilterToggleBtn").setAttribute("aria-expanded", String(!panel.hidden));
    });

    $("txTypePicker").addEventListener("click", (e) => {
      const btn = e.target.closest(".tx-type-btn");
      if (!btn) return;
      setTxType(btn.dataset.type);
    });
    $("txCurrency").addEventListener("change", (e) => setTxCurrency(e.target.value));
    $("txAmount").addEventListener("input", updateTxAmountPreview);
    $("txExchangeRate").addEventListener("input", updateTxAmountPreview);
    $("txDatePicker").addEventListener("click", () => {
      openCalendarForPick($("txDate").value, (dateStr) => setTxDate(dateStr));
    });
    $("txCancelBtn").addEventListener("click", closeTxModal);
    $("txSaveBtn").addEventListener("click", saveTx);
    $("txDeleteBtn").addEventListener("click", deleteTx);
    $("txList").addEventListener("click", (e) => {
      const row = e.target.closest(".tx-item");
      if (row) openEditTx(row.dataset.id);
    });

    $("txWalletBtn").addEventListener("click", () => openWalletPicker("txWallet"));
    $("txToWalletBtn").addEventListener("click", () => openWalletPicker("txToWallet"));
    $("walletPickerCancelBtn").addEventListener("click", closeWalletPickerModal);
    $("walletPickerSearch").addEventListener("input", (e) => renderWalletPickerList(e.target.value));
    $("walletPickerList").addEventListener("click", (e) => {
      const row = e.target.closest(".wallet-picker-row");
      if (!row || !walletPickerTarget) return;
      setWalletFieldValue(walletPickerTarget, row.dataset.key);
      closeWalletPickerModalVisual();
      popNavState();
    });

    $("manageFinanceMetaBtn").addEventListener("click", openMetaModal);
    $("finMetaCloseBtn").addEventListener("click", closeFinMetaModal);
    $("addCategoryBtn").addEventListener("click", () => {
      const input = $("newCategoryInput");
      addCategory(input.value.trim());
      input.value = "";
      renderMetaModal();
    });
    $("categoryMetaList").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-kind='cat']");
      if (!btn) return;
      removeCategory(btn.dataset.name);
      renderMetaModal();
    });
  }

  function getTodaySummary() {
    const today = todayISO();
    let income = 0, expense = 0;
    activeTx().forEach((t) => {
      if (t.date !== today) return;
      if (t.type === "income") income += t.amount;
      else if (t.type === "expense") expense += t.amount;
    });
    return { income, expense };
  }

  function getTransactionDateSet() {
    return new Set(activeTx().map((t) => t.date));
  }

  function getTransactionsForDate(date) {
    return activeTx().filter((t) => t.date === date);
  }

  function getTransactionById(id) {
    return allTx.find((t) => t.id === id) || null;
  }

  /** All active transactions with date in [fromDate, toDate] (inclusive,
   *  ISO yyyy-mm-dd strings), sorted chronologically ascending — for the
   *  statement export, which reads oldest-to-newest like a real bank
   *  statement rather than the newest-first order the on-screen list uses. */
  function getTransactionsInRange(fromDate, toDate) {
    return activeTx()
      .filter((t) => t.date >= fromDate && t.date <= toDate)
      .sort((a, b) => (a.date + (a.createdAt || "")).localeCompare(b.date + (b.createdAt || "")));
  }

  async function init() {
    wireEvents();
    allTx = await DiaryDB.getAllTransactions();
  }

  return {
    init, render, openNewTx, closeTxModalVisual, closeFinMetaModalVisual, closeWalletPickerModalVisual, getTodaySummary,
    getTransactionDateSet, getTransactionsForDate, getTransactionsInRange, getTransactionById, formatMoney,
    getWalletOptions, walletLabel, computeWalletBalance,
  };
})();
