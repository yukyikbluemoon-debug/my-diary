/* banking.js — "Banking & Liabilities" module (bank accounts, debts, and
   other sensitive records like insurance/membership numbers).

   Debts and "other info" records are stored FULLY encrypted using the same
   mechanism as private diary entries (DiaryCrypto.encryptJSON/decryptJSON)
   — nothing about them is readable without unlocking first.

   Bank accounts are a deliberate exception: bankName, accountName,
   accountNumber, and ownerName are kept as PLAINTEXT fields on the record
   (by explicit request — visible to anyone with the device unlocked at the
   OS level, no in-app unlock needed). Only accountType, branch, and note
   stay encrypted. This is what lets the "การเงิน" transaction form offer a
   full "เงินสด / ธนาคาร X เลขบัญชี..." picker without requiring an app
   unlock every time someone logs an expense — see getBankAccountPickerRows(),
   which the transaction form's custom picker reads from directly. Every
   transaction stores a STABLE KEY ("cash" or "bank:<id>"), never a display
   label, so renaming a bank account or editing its account number can
   never desync it from transaction history — see finance.js for the key
   scheme. Google Drive sync only ever sees the same shape (plaintext
   fields + an encrypted blob for the rest), same as it does today for
   private diary entries. */

const Banking = (() => {
  let allBankAccountsFull = []; // ALL bank records including soft-deleted, for label resolution by id
  let allBankAccounts = []; // active only, for the accounts tab list + picker
  let allDebts = [];
  let allOtherInfo = [];
  let currentSubtab = "tx"; // "tx" | "accounts" | "debts" | "other"

  function maskTail(value, keep) {
    keep = keep || 4;
    value = value || "";
    if (value.length <= keep) return value;
    return "x".repeat(value.length - keep) + value.slice(-keep);
  }

  function bankLabel(a) {
    return a.accountLast4 ? `${a.bankName} (...${a.accountLast4})` : a.bankName;
  }

  function bankKey(id) { return "bank:" + id; }

  /** Options for the Finance module's money-source picker. Always
   *  available without an unlock (bankName/accountLast4 are plaintext) —
   *  only ACTIVE (non-deleted) accounts are offered here. */
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

  /* ---------------- generic encrypted-record helpers (debts / other) ---------------- */

  async function encryptRecord(kind, existing, payload) {
    const enc = await DiaryCrypto.encryptJSON(payload);
    return {
      id: existing ? existing.id : uid(),
      kind,
      deletedAt: null,
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      encIv: enc.iv,
      encData: enc.data,
    };
  }

  async function decryptAll(records) {
    const out = [];
    for (const rec of records) {
      if (rec.deletedAt) continue;
      try {
        const payload = await DiaryCrypto.decryptJSON({ iv: rec.encIv, data: rec.encData });
        out.push({ ...rec, ...payload });
      } catch (e) {
        console.error("Banking: failed to decrypt record", rec.id, e);
      }
    }
    return out;
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
    if (name === "debts" || name === "other") ensureUnlockedThenRenderLocked();
  }

  async function ensureUnlockedThenRenderLocked() {
    if (!DiaryCrypto.hasPassword()) {
      renderLockGate("ยังไม่ได้ตั้งรหัสผ่าน — ตั้งรหัสผ่านก่อนเพื่อเริ่มใช้งานหนี้สิน/ข้อมูลอื่น (ข้อมูลจะถูกเข้ารหัสด้วยรหัสผ่านนี้)");
      return;
    }
    if (!DiaryCrypto.isUnlocked()) {
      const ok = await ensureUnlocked("เพื่อดูหนี้สินและข้อมูลอื่น");
      if (!ok) { renderLockGate("ปลดล็อกไม่สำเร็จ — แตะเพื่อลองใหม่", true); return; }
    }
    await loadAndRenderLocked();
  }

  function renderLockGate(message, retry) {
    ["debtList", "otherList"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.innerHTML = `<div class="empty-state"><p class="empty-title">🔒 ${escapeHTML(message)}</p></div>`;
    });
    if (retry) {
      document.querySelectorAll(".empty-title").forEach((el) => {
        el.style.cursor = "pointer";
        el.addEventListener("click", ensureUnlockedThenRenderLocked, { once: true });
      });
    }
  }

  async function loadAndRenderLocked() {
    const [debtRaw, otherRaw] = await Promise.all([DiaryDB.getAllDebts(), DiaryDB.getAllOtherInfo()]);
    allDebts = await decryptAll(debtRaw);
    allOtherInfo = await decryptAll(otherRaw);
    renderDebtList();
    renderOtherList();
    renderSummaryCounts();
  }

  /** Bank accounts never need an unlock just to LIST them (name + computed
   *  balance are enough) — only editing reveals the encrypted fields. */
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
          <div class="asset-row-sub">แตะเพื่อดูรายละเอียด (ประเภทบัญชี/สาขา เข้ารหัสไว้)</div>
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

  async function openEditBank(id) {
    const a = allBankAccounts.find((x) => x.id === id);
    if (!a) return;
    if (!DiaryCrypto.hasPassword()) { showToast("กรุณาตั้งรหัสผ่านก่อน"); openSetPwModal("create"); return; }
    const ok = await ensureUnlocked("เพื่อดูรายละเอียดบัญชี");
    if (!ok) return;
    let details = {};
    try {
      details = await DiaryCrypto.decryptJSON({ iv: a.encIv, data: a.encData });
    } catch (e) {
      // Only accountType/branch/note live in this encrypted blob — losing
      // them shouldn't block editing the account entirely. This usually
      // means the record was encrypted under a different password/session
      // than the one currently unlocked (e.g. synced in from before a
      // password change) — those 3 fields can't be recovered, but saving
      // again here re-encrypts fresh ones under the current key.
      console.error("Banking: could not decrypt bank account details", a.id, e);
      showToast("ถอดรหัสรายละเอียดเดิมไม่สำเร็จ — กรอกประเภทบัญชี/สาขา/หมายเหตุใหม่ได้ (ชื่อ/เลขบัญชี/เจ้าของบัญชียังอยู่ครบ)");
    }

    $("bankId").value = a.id;
    $("bankName").value = a.bankName || "";
    $("bankAccountName").value = a.accountName || "";
    $("bankAccountType").value = details.accountType || "";
    $("bankAccountNumber").value = a.accountNumber || "";
    $("bankOwnerName").value = a.ownerName || "";
    $("bankBranch").value = details.branch || "";
    $("bankNote").value = details.note || "";
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
    if (!DiaryCrypto.hasPassword()) { showToast("กรุณาตั้งรหัสผ่านก่อน"); openSetPwModal("create"); return; }
    const ok = await ensureUnlocked("เพื่อบันทึกข้อมูลบัญชี");
    if (!ok) return;

    const id = $("bankId").value;
    const existing = id ? allBankAccounts.find((x) => x.id === id) : null;
    const accountName = $("bankAccountName").value.trim();
    const accountNumber = $("bankAccountNumber").value.trim();
    const ownerName = $("bankOwnerName").value.trim();
    // accountNumber and ownerName are kept as PLAINTEXT (by explicit
    // request) so the "แหล่งเงิน" picker in รายรับ-รายจ่าย can show them
    // without an unlock — anyone with the device open can see these two
    // fields. accountType/branch/note stay encrypted below.
    const accountLast4 = accountNumber.replace(/\D/g, "").slice(-4) || "";

    const details = {
      accountType: $("bankAccountType").value.trim(),
      branch: $("bankBranch").value.trim(),
      note: $("bankNote").value.trim(),
    };
    const enc = await DiaryCrypto.encryptJSON(details);
    const rec = {
      id: existing ? existing.id : uid(),
      kind: "bank",
      bankName,
      accountName,
      accountNumber,
      ownerName,
      accountLast4,
      deletedAt: null,
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      encIv: enc.iv,
      encData: enc.data,
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
    // Deliberately sends ONLY the bank/account name and computed balance —
    // never the account number, branch, owner name, or note. Those stay
    // encrypted and local; this is the one narrow, explicit exception to
    // "encrypted data never leaves the device", made because the user
    // wants a family member to know which accounts exist and roughly how
    // much is in them.
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

  /** Sync lookup by id (including soft-deleted), for places that just need
   *  the plaintext fields (accountNumber, ownerName, bankName) without a
   *  decrypt round-trip. */
  function findBankAccountById(id) {
    return allBankAccountsFull.find((x) => x.id === id) || null;
  }

  /** Rows for the custom 2-line "แหล่งเงิน" picker in the transaction form:
   *  line1 = bank + owner name, line2 = full account number. Both are
   *  plaintext fields, so this needs no unlock. */
  function getBankAccountPickerRows() {
    return allBankAccounts.map((a) => ({
      key: bankKey(a.id),
      line1: [a.bankName, a.ownerName].filter(Boolean).join("  "),
      line2: a.accountNumber || "",
    }));
  }

  /** Decrypts and returns one bank account's remaining sensitive fields by
   *  id (accountType/branch/note), merged with its plaintext accountNumber/
   *  ownerName — for the rare places that deliberately want the fuller
   *  picture (e.g. the "send full summary" Telegram button). Requires an
   *  unlock — returns null if that's not possible or decryption fails. */
  async function getFullDetails(id) {
    const a = allBankAccountsFull.find((x) => x.id === id);
    if (!a) return null;
    try {
      const encrypted = await DiaryCrypto.decryptJSON({ iv: a.encIv, data: a.encData });
      return { accountNumber: a.accountNumber, ownerName: a.ownerName, ...encrypted };
    } catch (e) { return null; }
  }

  /** Decrypted list of every active debt — used by the full portfolio
   *  summary send. Independent of whatever sub-tab the user has actually
   *  visited this session. */
  async function getDecryptedDebtsList() {
    const raw = await DiaryDB.getAllDebts();
    return decryptAll(raw);
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
      const paidPercent = original > 0 ? Math.max(0, Math.min(100, Math.round(((original - remaining) / original) * 100))) : null;
      const row = document.createElement("div");
      row.className = "asset-row debt-row";
      row.dataset.id = d.id;
      row.innerHTML = `
        <div class="asset-row-body">
          <div class="asset-row-title">💳 ${escapeHTML(d.debtName)}</div>
          <div class="asset-row-sub">คงเหลือ ${Finance.formatMoney(remaining)}${d.dueDay ? " · ชำระวันที่ " + escapeHTML(d.dueDay) : ""}</div>
          ${paidPercent !== null ? `
          <div class="debt-progress-track">
            <div class="debt-progress-fill" style="width:${paidPercent}%;"></div>
          </div>
          <div class="debt-progress-label">ผ่อนไปแล้ว ${paidPercent}%</div>` : ""}
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
    const payload = {
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
    };
    const rec = await encryptRecord("debt", existing, payload);
    await DiaryDB.putDebt(rec);
    closeDebtModalVisual();
    popNavState();
    await loadAndRenderLocked();
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
    await loadAndRenderLocked();
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
    const payload = {
      category, title,
      fieldsText: $("otherFieldsText").value,
      note: $("otherNote").value.trim(),
    };
    const rec = await encryptRecord("other", existing, payload);
    await DiaryDB.putOtherInfo(rec);
    closeOtherModalVisual();
    popNavState();
    await loadAndRenderLocked();
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
    await loadAndRenderLocked();
    showToast("ลบแล้ว");
  }

  /* ---------------- lifecycle ---------------- */

  async function render() {
    // Bank accounts refresh every time (cheap, no unlock needed — this is
    // also what keeps Finance's "แหล่งเงิน" dropdown current). Debts/other
    // only refresh if the user is already on that sub-tab and unlocked.
    await loadBankAccounts();
    if ((currentSubtab === "debts" || currentSubtab === "other")) {
      if (DiaryCrypto.isUnlocked()) await loadAndRenderLocked();
      else await ensureUnlockedThenRenderLocked();
    }
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
    await loadBankAccounts(); // available immediately, no unlock — Finance needs this list right away
  }

  return {
    init, render, showFinSubtab,
    getBankAccountOptions, resolveBankLabelById, findBankAccountById,
    getBankAccountPickerRows, getFullDetails, getDecryptedDebtsList,
    closeBankModalVisual, closeDebtModalVisual, closeOtherModalVisual,
  };
})();
