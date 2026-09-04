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

  /** One-time migration: records created before encryption was removed
   *  still have their real content locked inside encIv/encData, with
   *  nothing readable at the top level. Decrypts and re-saves them as
   *  plain records so they show up normally from here on — needs a single
   *  unlock if not already unlocked this session. Records that are
   *  already plain (no encIv) pass through untouched. */
  async function migrateIfEncrypted(rec, kind) {
    if (!rec.encIv || !rec.encData) return rec;
    try {
      const payload = await DiaryCrypto.decryptJSON({ iv: rec.encIv, data: rec.encData });
      const migrated = { ...rec, ...payload };
      delete migrated.encIv;
      delete migrated.encData;
      if (kind === "debt") await DiaryDB.putDebt(migrated);
      else if (kind === "other") await DiaryDB.putOtherInfo(migrated);
      else if (kind === "bank") await DiaryDB.putBankAccount(migrated);
      return migrated;
    } catch (e) {
      console.error("Banking: migration failed for", rec.id, e);
      return rec; // leave encrypted — will render blank rather than crash
    }
  }

  async function loadDebtsAndOther() {
    const [debtRaw, otherRaw] = await Promise.all([DiaryDB.getAllDebts(), DiaryDB.getAllOtherInfo()]);
    const needsMigration = [...debtRaw, ...otherRaw].some((r) => !r.deletedAt && r.encIv);
    if (needsMigration && !DiaryCrypto.isUnlocked()) {
      if (!DiaryCrypto.hasPassword()) {
        renderMigrationStuck();
        return;
      }
      const ok = await ensureUnlocked("เพื่อกู้คืนข้อมูลหนี้สิน/อื่นๆ ที่ยังเข้ารหัสแบบเก่าอยู่ (ทำครั้งเดียวเท่านั้น)");
      if (!ok) { renderMigrationStuck(true); return; }
    }

    const migratedDebts = [];
    for (const r of debtRaw) migratedDebts.push(r.deletedAt ? r : await migrateIfEncrypted(r, "debt"));
    const migratedOther = [];
    for (const r of otherRaw) migratedOther.push(r.deletedAt ? r : await migrateIfEncrypted(r, "other"));

    allDebts = migratedDebts.filter((d) => !d.deletedAt);
    allOtherInfo = migratedOther.filter((o) => !o.deletedAt);
    renderCleanupButtons();
    renderDebtList();
    renderOtherList();
    renderSummaryCounts();
  }

  /** Shows/hides the "ล้างรายการที่เสีย" buttons based on how many records
   *  still have encIv after a migration attempt — these failed to decrypt
   *  (usually because they predate the current password/session in some
   *  way) and are permanently unreadable junk. The normal per-row edit/
   *  delete flow doesn't reliably work on them (blank id-dependent fields),
   *  so this is a dedicated, guaranteed bulk-delete path instead. */
  function renderCleanupButtons() {
    const corruptedDebts = allDebts.filter((d) => d.encIv).length;
    const corruptedOther = allOtherInfo.filter((o) => o.encIv).length;
    const debtBtn = $("cleanupCorruptedDebtsBtn");
    if (debtBtn) {
      debtBtn.hidden = corruptedDebts === 0;
      debtBtn.textContent = `🗑️ ล้างรายการที่เสีย (${corruptedDebts})`;
    }
    const otherBtn = $("cleanupCorruptedOtherBtn");
    if (otherBtn) {
      otherBtn.hidden = corruptedOther === 0;
      otherBtn.textContent = `🗑️ ล้างรายการที่เสีย (${corruptedOther})`;
    }
  }

  async function cleanupCorruptedDebts() {
    const bad = allDebts.filter((d) => d.encIv);
    if (bad.length === 0) return;
    if (!confirm(`พบหนี้สิน ${bad.length} รายการที่ถอดรหัสไม่ได้ (ข้อมูลเสียมาตั้งแต่ก่อนหน้านี้ กู้คืนไม่ได้แล้ว) ต้องการลบทิ้งหรือไม่?`)) return;
    let failCount = 0;
    for (const d of bad) {
      try { await DiaryDB.removeDebt(d.id); }
      catch (e) { console.error("Banking: hard-delete failed for debt", d.id, e); failCount++; }
    }
    await loadDebtsAndOther();
    showToast(failCount > 0 ? `ลบได้ ${bad.length - failCount}/${bad.length} รายการ` : `ลบแล้ว ${bad.length} รายการ`);
  }

  async function cleanupCorruptedOther() {
    const bad = allOtherInfo.filter((o) => o.encIv);
    if (bad.length === 0) return;
    if (!confirm(`พบข้อมูลอื่น ${bad.length} รายการที่ถอดรหัสไม่ได้ (ข้อมูลเสียมาตั้งแต่ก่อนหน้านี้ กู้คืนไม่ได้แล้ว) ต้องการลบทิ้งหรือไม่?`)) return;
    let failCount = 0;
    for (const o of bad) {
      try { await DiaryDB.removeOtherInfo(o.id); }
      catch (e) { console.error("Banking: hard-delete failed for other-info", o.id, e); failCount++; }
    }
    await loadDebtsAndOther();
    showToast(failCount > 0 ? `ลบได้ ${bad.length - failCount}/${bad.length} รายการ` : `ลบแล้ว ${bad.length} รายการ`);
  }

  function renderMigrationStuck(retry) {
    const msg = retry
      ? "ปลดล็อกไม่สำเร็จ — แตะเพื่อลองใหม่"
      : "พบข้อมูลเก่าที่ยังเข้ารหัสอยู่ แต่ยังไม่เคยตั้งรหัสผ่านไว้บนเครื่องนี้ ลองเข้าจากเครื่อง/เบราว์เซอร์ที่เคยตั้งรหัสผ่านไว้แทน";
    ["debtList", "otherList"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.innerHTML = `<div class="empty-state"><p class="empty-title">🔒 ${escapeHTML(msg)}</p></div>`;
    });
    if (retry) {
      document.querySelectorAll(".empty-title").forEach((el) => {
        el.style.cursor = "pointer";
        el.addEventListener("click", loadDebtsAndOther, { once: true });
      });
    }
  }

  /** Bank accounts never need an unlock just to LIST them — this is also
   *  what keeps Finance's "แหล่งเงิน" dropdown current. */
  async function loadBankAccounts() {
    let raw = await DiaryDB.getAllBankAccounts();
    // Opportunistic migration only (no forced unlock prompt here — unlike
    // debts, only 3 minor fields (accountType/branch/note) are at stake
    // for pre-existing accounts, not the whole record): migrates silently
    // if already unlocked this session, otherwise those 3 fields just show
    // blank until the account is edited and re-saved.
    if (DiaryCrypto.isUnlocked() && raw.some((r) => !r.deletedAt && r.encIv)) {
      const migrated = [];
      for (const r of raw) migrated.push(r.deletedAt ? r : await migrateIfEncrypted(r, "bank"));
      raw = migrated;
    }
    allBankAccountsFull = raw;
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

  /** Days until this debt's next due day (day-of-month only, wraps to next
   *  month if already passed this month) — same logic as the dashboard's
   *  due-date reminder banner, reused here for a per-row warning. */
  function computeDaysUntilDue(dueDay) {
    const dueDayNum = parseInt(dueDay, 10);
    if (!dueDayNum || dueDayNum < 1 || dueDayNum > 31) return null;
    const today = new Date();
    const todayDay = today.getDate();
    const daysInThisMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    let daysUntil = dueDayNum - todayDay;
    if (daysUntil < 0) daysUntil += daysInThisMonth;
    return daysUntil;
  }

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
      const row = document.createElement("div");
      row.className = "asset-row debt-row";
      row.dataset.id = d.id;
      if (d.encIv) {
        // Failed to decrypt during migration — permanently unreadable.
        // Shown flagged rather than hidden; use "ล้างรายการที่เสีย" above
        // to remove these in bulk since per-row edit/delete is unreliable
        // on them.
        row.innerHTML = `
          <div class="asset-row-body">
            <div class="asset-row-title">⚠️ (ข้อมูลเสีย ถอดรหัสไม่ได้)</div>
            <div class="asset-row-sub">ใช้ปุ่ม "ล้างรายการที่เสีย" ด้านบนเพื่อลบ</div>
          </div>`;
        list.appendChild(row);
        return;
      }
      const original = parseFloat(d.originalAmount) || 0;
      const remaining = parseFloat(d.remainingAmount) || 0;
      const available = original - remaining;
      const paidPercent = original > 0 ? Math.max(0, Math.min(100, Math.round(((original - remaining) / original) * 100))) : null;
      const barTier = paidPercent === null ? "" : paidPercent >= 75 ? "high" : paidPercent >= 40 ? "mid" : "low";
      const daysUntilDue = computeDaysUntilDue(d.dueDay);
      const threshold = (typeof getDebtReminderDays === "function") ? getDebtReminderDays() : 5;
      const isDueSoon = daysUntilDue !== null && daysUntilDue <= threshold;
      const dueSoonText = daysUntilDue === 0 ? "ครบกำหนดชำระวันนี้!" : `ใกล้ครบกำหนดชำระ (อีก ${daysUntilDue} วัน)`;
      row.innerHTML = `
        <div class="asset-row-body">
          <div class="asset-row-title">💳 ${escapeHTML(d.debtName)}</div>
          <div class="asset-row-sub">คงเหลือ ${Finance.formatMoney(remaining)}${original > 0 ? " · วงเงินคงเหลือ " + Finance.formatMoney(available) : ""}${d.dueDay ? " · ชำระวันที่ " + escapeHTML(d.dueDay) : ""}</div>
          ${isDueSoon ? `<div class="debt-due-warning">⚠️ ${dueSoonText}</div>` : ""}
          ${paidPercent !== null ? `
          <div class="debt-progress-row">
            <div class="debt-progress-track">
              <div class="debt-progress-fill ${barTier}" style="width:${paidPercent}%;"></div>
            </div>
            <div class="debt-progress-percent ${barTier}">${paidPercent}%${paidPercent >= 100 ? " 🎉" : ""}</div>
          </div>${paidPercent >= 100 ? '<div class="debt-paid-off">🎉 ผ่อนหมดแล้ว!</div>' : ""}` : ""}
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
      const row = document.createElement("div");
      row.className = "asset-row";
      row.dataset.id = o.id;
      if (o.encIv) {
        row.innerHTML = `
          <div class="asset-row-body">
            <div class="asset-row-title">⚠️ (ข้อมูลเสีย ถอดรหัสไม่ได้)</div>
            <div class="asset-row-sub">ใช้ปุ่ม "ล้างรายการที่เสีย" ด้านบนเพื่อลบ</div>
          </div>`;
        list.appendChild(row);
        return;
      }
      const firstFieldLine = (o.fieldsText || "").split("\n").map((l) => l.trim()).find(Boolean);
      const subText = firstFieldLine || o.note || "แตะเพื่อดูรายละเอียด";
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
      if (!row) return;
      const d = allDebts.find((x) => x.id === row.dataset.id);
      if (d && d.encIv) { showToast('ข้อมูลเสีย ถอดรหัสไม่ได้ — ใช้ปุ่ม "ล้างรายการที่เสีย" แทน'); return; }
      openEditDebt(row.dataset.id);
    });
    $("debtSearchInput").addEventListener("input", renderDebtList);
    $("cleanupCorruptedDebtsBtn").addEventListener("click", cleanupCorruptedDebts);

    $("addOtherBtn").addEventListener("click", openNewOther);
    $("otherCancelBtn").addEventListener("click", closeOtherModal);
    $("otherSaveBtn").addEventListener("click", saveOther);
    $("otherDeleteBtn").addEventListener("click", deleteOther);
    $("otherList").addEventListener("click", (e) => {
      const row = e.target.closest(".asset-row");
      if (!row) return;
      const o = allOtherInfo.find((x) => x.id === row.dataset.id);
      if (o && o.encIv) { showToast('ข้อมูลเสีย ถอดรหัสไม่ได้ — ใช้ปุ่ม "ล้างรายการที่เสีย" แทน'); return; }
      openEditOther(row.dataset.id);
    });
    $("otherSearchInput").addEventListener("input", renderOtherList);
    $("cleanupCorruptedOtherBtn").addEventListener("click", cleanupCorruptedOther);
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
