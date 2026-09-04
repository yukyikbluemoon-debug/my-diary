/* banking.js — "Banking & Liabilities" module (bank accounts, debts, and
   other sensitive records like insurance/membership numbers).

   By explicit request, NONE of this data is encrypted anymore — bank
   accounts, debts, and other-info records are all plain, unlock-free data,
   same as transactions. (Diary entries marked ส่วนตัว/private are a
   separate system and are NOT affected by this — those still encrypt as
   before.) This was a deliberate trade-off: it removes the "ถอดรหัสไม่
   สำเร็จ" failures and unlock friction throughout this module, at the
   cost of this data being readable by anyone who has the device unlocked
   at the OS level.

   Every transaction stores a STABLE KEY ("cash" or "bank:<id>"), never a
   display label, so renaming a bank account or editing its account number
   can never desync it from transaction history — see finance.js for the
   key scheme. */

const Banking = (() => {
  let allBankAccountsFull = []; // ALL bank records including soft-deleted, for label resolution by id
  let allBankAccounts = []; // active only, for the accounts tab list + picker
  let allDebts = [];
  let allOtherInfo = [];
  let currentSubtab = "tx"; // "tx" | "accounts" | "debts" | "other"

  function bankLabel(a) {
    return a.accountLast4 ? `${a.bankName} (...${a.accountLast4})` : a.bankName;
  }

  function bankKey(id) { return "bank:" + id; }

  /** Options for the Finance module's money-source picker. */
  function getBankAccountOptions() {
    return allBankAccounts.map((a) => ({ key: bankKey(a.id), label: bankLabel(a) }));
  }

  /** Resolves a bank account's display label from its id alone, checking
   *  soft-deleted records too — so old transactions that reference a since-
   *  deleted account still show something meaningful instead of breaking. */
  function resolveBankLabelById(id) {
    const a = allBankAccountsFull.find((x) => x.id === id);
    if (!a) return "(ไม่พบบัญชี)";
    return a.deletedAt ? `${bankLabel(a)} (ลบแล้ว)` : bankLabel(a);
  }

  /* ---------------- sub-tab switching ---------------- */

  function showFinSubtab(name) {
    currentSubtab = name;
    document.querySelectorAll(".fin-subtab-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.subtab === name);
    });
    document.querySelectorAll(".fin-panel").forEach((p) => {
      p.hidden = p.dataset.panel !== name;
    });
    if (name === "debts" || name === "other") loadDebtsAndOther();
  }

  async function loadDebtsAndOther() {
    const [debtRaw, otherRaw] = await Promise.all([DiaryDB.getAllDebts(), DiaryDB.getAllOtherInfo()]);
    allDebts = debtRaw.filter((d) => !d.deletedAt);
    allOtherInfo = otherRaw.filter((o) => !o.deletedAt);
    renderDebtList();
    renderOtherList();
    renderSummaryCounts();
  }

  /** Bank accounts never need an unlock just to LIST them — this is also
   *  what keeps Finance's "แหล่งเงิน" dropdown current. */
  async function loadBankAccounts() {
    allBankAccountsFull = await DiaryDB.getAllBankAccounts();
    allBankAccounts = allBankAccountsFull.filter((a) => !a.deletedAt);
    renderBankList();
    renderSummaryCounts();
  }

  function renderSummaryCounts() {
    if ($("finBankCount")) $("finBankCount").textContent = allBankAccounts.length;
    if ($("finBankTotalBalance") && typeof Finance !== "undefined") {
      const total = getBankAccountOptions().reduce((sum, o) => sum + Finance.computeWalletBalance(o.key), 0);
      $("finBankTotalBalance").textContent = Finance.formatMoney(total);
    }
    if ($("finDebtCount")) $("finDebtCount").textContent = allDebts.length;
    if ($("finDebtTotalRemaining") && typeof Finance !== "undefined") {
      const totalRemaining = allDebts.reduce((sum, d) => sum + (parseFloat(d.remainingAmount) || 0), 0);
      $("finDebtTotalRemaining").textContent = Finance.formatMoney(totalRemaining);
    }
    if ($("finDebtTotalInstallment") && typeof Finance !== "undefined") {
      const totalInstallment = allDebts.reduce((sum, d) => sum + (parseFloat(d.installmentAmount) || 0), 0);
      $("finDebtTotalInstallment").textContent = Finance.formatMoney(totalInstallment);
    }
    if ($("finOtherCount")) $("finOtherCount").textContent = allOtherInfo.length;
  }

  /* ---------------- bank accounts ---------------- */

  function renderBankList() {
    const q = ($("bankSearchInput") && $("bankSearchInput").value || "").trim().toLowerCase();
    const items = q
      ? allBankAccounts.filter((a) => [a.bankName, a.accountName, a.accountNumber, a.ownerName].join(" ").toLowerCase().includes(q))
      : allBankAccounts;
    const list = $("bankList");
    if (!list) return;
    list.innerHTML = "";
    if ($("bankEmptyState")) $("bankEmptyState").hidden = items.length > 0 || !!q;
    items.slice().sort((a, b) => {
      const pinDiff = (b.isPinned ? 1 : 0) - (a.isPinned ? 1 : 0);
      if (pinDiff !== 0) return pinDiff;
      return (b.updatedAt || "").localeCompare(a.updatedAt || "");
    }).forEach((a) => {
      const label = bankLabel(a);
      const bal = (typeof Finance !== "undefined") ? Finance.computeWalletBalance(bankKey(a.id)) : 0;
      const row = document.createElement("div");
      row.className = "asset-row" + (a.isPinned ? " bank-row-pinned" : "");
      row.dataset.id = a.id;
      row.innerHTML = `
        <button type="button" class="bank-pin-btn${a.isPinned ? " pinned" : ""}" data-id="${a.id}" aria-label="${a.isPinned ? "เลิกปักหมุด" : "ปักหมุด"}">📌</button>
        <button type="button" class="bank-send-btn" data-id="${a.id}" aria-label="ส่งเข้า Telegram">📨</button>
        <div class="asset-row-body">
          <div class="asset-row-title">🏦 ${escapeHTML(label)}</div>
          <div class="asset-row-sub">แตะเพื่อดูรายละเอียด</div>
        </div>
        <div class="asset-row-value">
          <div class="asset-row-total">${Finance.formatMoney(bal)}</div>
        </div>`;
      list.appendChild(row);
    });
  }

  async function togglePinBank(id) {
    const raw = allBankAccountsFull.find((x) => x.id === id);
    if (!raw) return;
    raw.isPinned = !raw.isPinned;
    raw.updatedAt = new Date().toISOString();
    await DiaryDB.putBankAccount(raw);
    await loadBankAccounts();
  }

  function openNewBank() {
    $("bankId").value = "";
    ["bankName", "bankAccountName", "bankAccountType", "bankAccountNumber", "bankOwnerName", "bankBranch", "bankNote"].forEach((id) => $(id).value = "");
    $("bankModalTitle").textContent = "เพิ่มบัญชีธนาคาร";
    $("bankDeleteBtn").hidden = true;
    $("bankModal").hidden = false;
    pushNavState("bank");
  }

  function openEditBank(id) {
    const a = allBankAccounts.find((x) => x.id === id);
    if (!a) return;
    $("bankId").value = a.id;
    $("bankName").value = a.bankName || "";
    $("bankAccountName").value = a.accountName || "";
    $("bankAccountType").value = a.accountType || "";
    $("bankAccountNumber").value = a.accountNumber || "";
    $("bankOwnerName").value = a.ownerName || "";
    $("bankBranch").value = a.branch || "";
    $("bankNote").value = a.note || "";
    $("bankModalTitle").textContent = "แก้ไขบัญชีธนาคาร";
    $("bankDeleteBtn").hidden = false;
    $("bankModal").hidden = false;
    pushNavState("bank");
  }
  function closeBankModalVisual() { $("bankModal").hidden = true; }
  function closeBankModal() { closeBankModalVisual(); popNavState(); }

  async function saveBank() {
    const bankName = $("bankName").value.trim();
    if (!bankName) { showToast("กรุณาใส่ชื่อธนาคาร"); return; }

    const id = $("bankId").value;
    const existing = id ? allBankAccounts.find((x) => x.id === id) : null;
    const accountName = $("bankAccountName").value.trim();
    const accountNumber = $("bankAccountNumber").value.trim();
    const accountLast4 = accountNumber.replace(/\D/g, "").slice(-4) || "";

    const rec = {
      id: existing ? existing.id : uid(),
      kind: "bank",
      bankName,
      accountName,
      accountNumber,
      ownerName: $("bankOwnerName").value.trim(),
      accountType: $("bankAccountType").value.trim(),
      branch: $("bankBranch").value.trim(),
      note: $("bankNote").value.trim(),
      accountLast4,
      isPinned: existing ? !!existing.isPinned : false,
      deletedAt: null,
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await DiaryDB.putBankAccount(rec);

    closeBankModalVisual();
    popNavState();
    await loadBankAccounts();
    if (typeof Finance !== "undefined") Finance.render();
    showToast("บันทึกแล้ว");
  }

  async function deleteBank() {
    const id = $("bankId").value;
    if (!id) return;
    const bal = (typeof Finance !== "undefined") ? Finance.computeWalletBalance(bankKey(id)) : 0;
    const balWarning = bal !== 0
      ? `\n\n⚠️ บัญชีนี้ยังมียอดคงเหลือ ${Finance.formatMoney(bal)} อยู่ — แน่ใจนะ?`
      : "";
    if (!confirm(`ลบบัญชีธนาคารนี้หรือไม่? (ประวัติธุรกรรมเดิมที่ผูกกับบัญชีนี้จะยังอยู่ แต่จะไม่มีให้เลือกอีกในธุรกรรมใหม่)${balWarning}`)) return;
    const raw = (await DiaryDB.getAllBankAccounts()).find((x) => x.id === id);
    if (!raw) return;
    raw.deletedAt = new Date().toISOString();
    raw.updatedAt = new Date().toISOString();
    await DiaryDB.putBankAccount(raw);
    closeBankModalVisual();
    popNavState();
    await loadBankAccounts();
    if (typeof Finance !== "undefined") Finance.render();
    showToast("ลบแล้ว");
  }

  async function sendBankToTelegram(id) {
    const a = allBankAccounts.find((x) => x.id === id);
    if (!a) return;
    if (typeof TelegramNotify === "undefined" || !TelegramNotify.isConfigured()) {
      showToast("ยังไม่ได้ตั้งค่า Telegram (ตั้งค่า → Telegram)");
      return;
    }
    // Still deliberately sends only name + balance, not the account
    // number/branch/note, even though none of it is encrypted anymore —
    // no reason to widen what leaves the device just because it's no
    // longer protected locally.
    const label = bankLabel(a);
    const bal = (typeof Finance !== "undefined") ? Finance.computeWalletBalance(bankKey(a.id)) : 0;
    const lines = [`🏦 ${label}`, `ยอดคงเหลือ: ${Finance.formatMoney(bal)}`];
    try {
      await TelegramNotify.sendMessage(lines.join("\n"));
      showToast("ส่งเข้า Telegram แล้ว");
    } catch (err) {
      showToast("ส่งไม่สำเร็จ: " + (err && err.message ? err.message : ""));
    }
  }

  function findBankAccountById(id) {
    return allBankAccountsFull.find((x) => x.id === id) || null;
  }

  /** Rows for the custom 2-line "แหล่งเงิน" picker in the transaction form:
   *  line1 = bank + owner name, line2 = full account number. */
  function getBankAccountPickerRows() {
    return allBankAccounts.map((a) => ({
      key: bankKey(a.id),
      line1: [a.bankName, a.ownerName].filter(Boolean).join("  "),
      line2: a.accountNumber || "",
    }));
  }

  /** Full record by id — kept for callers written back when this data was
   *  encrypted (e.g. the full portfolio summary send); now just a plain
   *  lookup, no decrypt involved. */
  function getFullDetails(id) {
    return findBankAccountById(id);
  }

  /** Every active debt — used by the full portfolio summary send and the
   *  home-screen due-date reminder. */
  async function getDebtsList() {
    const raw = await DiaryDB.getAllDebts();
    return raw.filter((d) => !d.deletedAt);
  }

  /* ---------------- debts ---------------- */

  function renderDebtList() {
    const q = ($("debtSearchInput") && $("debtSearchInput").value || "").trim().toLowerCase();
    const items = q
      ? allDebts.filter((d) => [d.debtName, d.creditor, d.contractNumber, d.note].join(" ").toLowerCase().includes(q))
      : allDebts;
    const list = $("debtList");
    if (!list) return;
    list.innerHTML = "";
    if ($("debtEmptyState")) $("debtEmptyState").hidden = items.length > 0 || !!q;
    items.slice().sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")).forEach((d) => {
      const original = parseFloat(d.originalAmount) || 0;
      const remaining = parseFloat(d.remainingAmount) || 0;
      const available = original - remaining;
      const paidPercent = original > 0 ? Math.max(0, Math.min(100, Math.round(((original - remaining) / original) * 100))) : null;
      const barTier = paidPercent === null ? "" : paidPercent >= 75 ? "high" : paidPercent >= 40 ? "mid" : "low";
      const row = document.createElement("div");
      row.className = "asset-row debt-row";
      row.dataset.id = d.id;
      row.innerHTML = `
        <div class="asset-row-body">
          <div class="asset-row-title">💳 ${escapeHTML(d.debtName)}</div>
          <div class="asset-row-sub">คงเหลือ ${Finance.formatMoney(remaining)}${original > 0 ? " · วงเงินคงเหลือ " + Finance.formatMoney(available) : ""}${d.dueDay ? " · ชำระวันที่ " + escapeHTML(d.dueDay) : ""}</div>
          ${paidPercent !== null ? `
          <div class="debt-progress-row">
            <div class="debt-progress-track">
              <div class="debt-progress-fill ${barTier}" style="width:${paidPercent}%;"></div>
            </div>
            <div class="debt-progress-percent ${barTier}">${paidPercent}%${paidPercent >= 100 ? " 🎉" : ""}</div>
          </div>
          <div class="debt-progress-label">ผ่อนไปแล้ว${paidPercent >= 100 ? " — หมดแล้ว!" : ""}</div>` : ""}
        </div>`;
      list.appendChild(row);
    });
  }

  function openNewDebt() {
    $("debtId").value = "";
    ["debtName", "debtCreditor", "debtContractNumber", "debtOriginalAmount", "debtRemainingAmount", "debtInstallmentAmount", "debtDueDay", "debtStartDate", "debtEndDate", "debtNote"].forEach((id) => $(id).value = "");
    $("debtModalTitle").textContent = "เพิ่มหนี้สิน";
    $("debtDeleteBtn").hidden = true;
    $("debtModal").hidden = false;
    pushNavState("debt");
  }
  function openEditDebt(id) {
    const d = allDebts.find((x) => x.id === id);
    if (!d) return;
    $("debtId").value = d.id;
    $("debtName").value = d.debtName || "";
    $("debtCreditor").value = d.creditor || "";
    $("debtContractNumber").value = d.contractNumber || "";
    $("debtOriginalAmount").value = d.originalAmount || "";
    $("debtRemainingAmount").value = d.remainingAmount || "";
    $("debtInstallmentAmount").value = d.installmentAmount || "";
    $("debtDueDay").value = d.dueDay || "";
    $("debtStartDate").value = d.startDate || "";
    $("debtEndDate").value = d.endDate || "";
    $("debtNote").value = d.note || "";
    $("debtModalTitle").textContent = "แก้ไขหนี้สิน";
    $("debtDeleteBtn").hidden = false;
    $("debtModal").hidden = false;
    pushNavState("debt");
  }
  function closeDebtModalVisual() { $("debtModal").hidden = true; }
  function closeDebtModal() { closeDebtModalVisual(); popNavState(); }

  async function saveDebt() {
    const debtName = $("debtName").value.trim();
    if (!debtName) { showToast("กรุณาใส่ชื่อหนี้"); return; }
    const id = $("debtId").value;
    const existing = id ? allDebts.find((x) => x.id === id) : null;
    const rec = {
      id: existing ? existing.id : uid(),
      kind: "debt",
      debtName,
      creditor: $("debtCreditor").value.trim(),
      contractNumber: $("debtContractNumber").value.trim(),
      originalAmount: parseFloat($("debtOriginalAmount").value) || 0,
      remainingAmount: parseFloat($("debtRemainingAmount").value) || 0,
      installmentAmount: parseFloat($("debtInstallmentAmount").value) || 0,
      dueDay: $("debtDueDay").value.trim(),
      startDate: $("debtStartDate").value,
      endDate: $("debtEndDate").value,
      note: $("debtNote").value.trim(),
      deletedAt: null,
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await DiaryDB.putDebt(rec);
    closeDebtModalVisual();
    popNavState();
    await loadDebtsAndOther();
    showToast("บันทึกแล้ว");
  }

  async function deleteDebt() {
    const id = $("debtId").value;
    if (!id) return;
    if (!confirm("ลบรายการหนี้สินนี้หรือไม่?")) return;
    const raw = (await DiaryDB.getAllDebts()).find((x) => x.id === id);
    if (!raw) return;
    raw.deletedAt = new Date().toISOString();
    raw.updatedAt = new Date().toISOString();
    await DiaryDB.putDebt(raw);
    closeDebtModalVisual();
    popNavState();
    await loadDebtsAndOther();
    showToast("ลบแล้ว");
  }

  /* ---------------- other info (flexible key/value records) ---------------- */

  function renderOtherList() {
    const q = ($("otherSearchInput") && $("otherSearchInput").value || "").trim().toLowerCase();
    const items = q
      ? allOtherInfo.filter((o) => [o.category, o.title, o.note].join(" ").toLowerCase().includes(q))
      : allOtherInfo;
    const list = $("otherList");
    if (!list) return;
    list.innerHTML = "";
    if ($("otherEmptyState")) $("otherEmptyState").hidden = items.length > 0 || !!q;
    items.slice().sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")).forEach((o) => {
      const firstFieldLine = (o.fieldsText || "").split("\n").map((l) => l.trim()).find(Boolean);
      const subText = firstFieldLine || o.note || "แตะเพื่อดูรายละเอียด";
      const row = document.createElement("div");
      row.className = "asset-row";
      row.dataset.id = o.id;
      row.innerHTML = `
        <div class="asset-row-body">
          <div class="asset-row-title">📄 ${escapeHTML(o.category)} · ${escapeHTML(o.title)}</div>
          <div class="asset-row-sub">${escapeHTML(subText)}</div>
        </div>`;
      list.appendChild(row);
    });
  }

  function openNewOther() {
    $("otherId").value = "";
    ["otherCategory", "otherTitle", "otherFieldsText", "otherNote"].forEach((id) => $(id).value = "");
    $("otherModalTitle").textContent = "เพิ่มข้อมูลอื่น";
    $("otherDeleteBtn").hidden = true;
    $("otherModal").hidden = false;
    pushNavState("other");
  }
  function openEditOther(id) {
    const o = allOtherInfo.find((x) => x.id === id);
    if (!o) return;
    $("otherId").value = o.id;
    $("otherCategory").value = o.category || "";
    $("otherTitle").value = o.title || "";
    $("otherFieldsText").value = o.fieldsText || "";
    $("otherNote").value = o.note || "";
    $("otherModalTitle").textContent = "แก้ไขข้อมูล";
    $("otherDeleteBtn").hidden = false;
    $("otherModal").hidden = false;
    pushNavState("other");
  }
  function closeOtherModalVisual() { $("otherModal").hidden = true; }
  function closeOtherModal() { closeOtherModalVisual(); popNavState(); }

  async function saveOther() {
    const category = $("otherCategory").value.trim();
    const title = $("otherTitle").value.trim();
    if (!category || !title) { showToast("กรุณาใส่หมวดหมู่และหัวข้อ"); return; }
    const id = $("otherId").value;
    const existing = id ? allOtherInfo.find((x) => x.id === id) : null;
    const rec = {
      id: existing ? existing.id : uid(),
      kind: "other",
      category, title,
      fieldsText: $("otherFieldsText").value,
      note: $("otherNote").value.trim(),
      deletedAt: null,
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await DiaryDB.putOtherInfo(rec);
    closeOtherModalVisual();
    popNavState();
    await loadDebtsAndOther();
    showToast("บันทึกแล้ว");
  }

  async function deleteOther() {
    const id = $("otherId").value;
    if (!id) return;
    if (!confirm("ลบรายการนี้หรือไม่?")) return;
    const raw = (await DiaryDB.getAllOtherInfo()).find((x) => x.id === id);
    if (!raw) return;
    raw.deletedAt = new Date().toISOString();
    raw.updatedAt = new Date().toISOString();
    await DiaryDB.putOtherInfo(raw);
    closeOtherModalVisual();
    popNavState();
    await loadDebtsAndOther();
    showToast("ลบแล้ว");
  }

  /* ---------------- lifecycle ---------------- */

  async function render() {
    await loadBankAccounts();
    if (currentSubtab === "debts" || currentSubtab === "other") await loadDebtsAndOther();
  }

  function wireEvents() {
    document.querySelectorAll(".fin-subtab-btn").forEach((b) => {
      b.addEventListener("click", () => showFinSubtab(b.dataset.subtab));
    });

    $("addBankBtn").addEventListener("click", openNewBank);
    $("bankCancelBtn").addEventListener("click", closeBankModal);
    $("bankSaveBtn").addEventListener("click", saveBank);
    $("bankDeleteBtn").addEventListener("click", deleteBank);
    $("bankList").addEventListener("click", (e) => {
      const pinBtn = e.target.closest(".bank-pin-btn");
      if (pinBtn) { togglePinBank(pinBtn.dataset.id); return; }
      const sendBtn = e.target.closest(".bank-send-btn");
      if (sendBtn) { sendBankToTelegram(sendBtn.dataset.id); return; }
      const row = e.target.closest(".asset-row");
      if (row) openEditBank(row.dataset.id);
    });
    $("bankSearchInput").addEventListener("input", renderBankList);

    $("addDebtBtn").addEventListener("click", openNewDebt);
    $("debtCancelBtn").addEventListener("click", closeDebtModal);
    $("debtSaveBtn").addEventListener("click", saveDebt);
    $("debtDeleteBtn").addEventListener("click", deleteDebt);
    $("debtList").addEventListener("click", (e) => {
      const row = e.target.closest(".asset-row");
      if (row) openEditDebt(row.dataset.id);
    });
    $("debtSearchInput").addEventListener("input", renderDebtList);

    $("addOtherBtn").addEventListener("click", openNewOther);
    $("otherCancelBtn").addEventListener("click", closeOtherModal);
    $("otherSaveBtn").addEventListener("click", saveOther);
    $("otherDeleteBtn").addEventListener("click", deleteOther);
    $("otherList").addEventListener("click", (e) => {
      const row = e.target.closest(".asset-row");
      if (row) openEditOther(row.dataset.id);
    });
    $("otherSearchInput").addEventListener("input", renderOtherList);
  }

  async function init() {
    wireEvents();
    await loadBankAccounts();
  }

  return {
    init, render, showFinSubtab,
    getBankAccountOptions, resolveBankLabelById, findBankAccountById,
    getBankAccountPickerRows, getFullDetails, getDebtsList,
    closeBankModalVisual, closeDebtModalVisual, closeOtherModalVisual,
  };
})();
