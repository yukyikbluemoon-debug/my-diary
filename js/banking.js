/* banking.js — "Banking & Liabilities" module (bank accounts, debts, and
   other sensitive records like insurance/membership numbers).

   Every record is stored fully encrypted using the SAME mechanism as
   private diary entries (DiaryCrypto.encryptJSON / decryptJSON): the
   record kept in IndexedDB only has {id, createdAt, updatedAt, deletedAt,
   encIv, encData} — the actual bank name, account number, balances etc.
   only ever exist in plaintext in memory, after the user unlocks with
   their passphrase (ensureUnlocked(), same one used for private entries).
   Google Drive sync only ever sees the encrypted blob, same as it does
   today for private diary entries.

   Because these records have no "public" variant (unlike diary entries,
   where privacy is opt-in per entry), the module gates its three lists
   behind ensureUnlocked() the first time they're viewed each session. */

const Banking = (() => {
  let allBankAccounts = [];
  let allDebts = [];
  let allOtherInfo = [];
  let currentSubtab = "tx"; // "tx" | "accounts" | "debts" | "other"

  function maskTail(value, keep) {
    keep = keep || 4;
    value = value || "";
    if (value.length <= keep) return value;
    return "x".repeat(value.length - keep) + value.slice(-keep);
  }

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
        // a record that fails to decrypt (corrupt / wrong key somehow)
        // shouldn't take the whole list down with it
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
    if (name !== "tx") ensureUnlockedThenRender();
  }

  async function ensureUnlockedThenRender() {
    if (!DiaryCrypto.hasPassword()) {
      renderLockGate("ยังไม่ได้ตั้งรหัสผ่าน — ตั้งรหัสผ่านก่อนเพื่อเริ่มใช้งานข้อมูลธนาคาร/หนี้สิน (ข้อมูลจะถูกเข้ารหัสด้วยรหัสผ่านนี้)");
      return;
    }
    if (!DiaryCrypto.isUnlocked()) {
      const ok = await ensureUnlocked("เพื่อดูข้อมูลธนาคารและหนี้สิน");
      if (!ok) { renderLockGate("ปลดล็อกไม่สำเร็จ — แตะเพื่อลองใหม่", true); return; }
    }
    await loadAndRenderAll();
  }

  function renderLockGate(message, retry) {
    ["bankList", "debtList", "otherList"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.innerHTML = `<div class="empty-state"><p class="empty-title">🔒 ${escapeHTML(message)}</p></div>`;
    });
    if (retry) {
      document.querySelectorAll(".empty-title").forEach((el) => {
        el.style.cursor = "pointer";
        el.addEventListener("click", ensureUnlockedThenRender, { once: true });
      });
    }
  }

  async function loadAndRenderAll() {
    const [bankRaw, debtRaw, otherRaw] = await Promise.all([
      DiaryDB.getAllBankAccounts(), DiaryDB.getAllDebts(), DiaryDB.getAllOtherInfo(),
    ]);
    allBankAccounts = await decryptAll(bankRaw);
    allDebts = await decryptAll(debtRaw);
    allOtherInfo = await decryptAll(otherRaw);
    renderBankList();
    renderDebtList();
    renderOtherList();
    renderSummaryCounts();
  }

  function renderSummaryCounts() {
    if ($("finBankCount")) $("finBankCount").textContent = allBankAccounts.length;
    if ($("finBankTotalBalance")) {
      const total = allBankAccounts.reduce((sum, a) => sum + (parseFloat(a.balance) || 0), 0);
      $("finBankTotalBalance").textContent = Finance.formatMoney(total);
    }
    if ($("finDebtCount")) $("finDebtCount").textContent = allDebts.length;
    if ($("finOtherCount")) $("finOtherCount").textContent = allOtherInfo.length;
  }

  /* ---------------- bank accounts ---------------- */

  function renderBankList() {
    const q = ($("bankSearchInput") && $("bankSearchInput").value || "").trim().toLowerCase();
    const items = q
      ? allBankAccounts.filter((a) => [a.bankName, a.accountName, a.accountNumber, a.ownerName, a.note].join(" ").toLowerCase().includes(q))
      : allBankAccounts;
    const list = $("bankList");
    if (!list) return;
    list.innerHTML = "";
    if ($("bankEmptyState")) $("bankEmptyState").hidden = items.length > 0 || !!q;
    items.slice().sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")).forEach((a) => {
      const row = document.createElement("div");
      row.className = "asset-row";
      row.dataset.id = a.id;
      row.innerHTML = `
        <button type="button" class="bank-send-btn" data-id="${a.id}" aria-label="ส่งเข้า Telegram">📨</button>
        <div class="asset-row-body">
          <div class="asset-row-title">🏦 ${escapeHTML(a.bankName)} · ${escapeHTML(a.accountName)}</div>
          <div class="asset-row-sub">${escapeHTML(maskTail(a.accountNumber))}${a.ownerName ? " · " + escapeHTML(a.ownerName) : ""}</div>
        </div>
        <div class="asset-row-value">
          <div class="asset-row-total">${Finance.formatMoney(parseFloat(a.balance) || 0)}</div>
        </div>`;
      list.appendChild(row);
    });
  }

  function openNewBank() {
    $("bankId").value = "";
    ["bankName", "bankAccountName", "bankAccountType", "bankAccountNumber", "bankOwnerName", "bankBranch", "bankBalance", "bankNote"].forEach((id) => $(id).value = "");
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
    $("bankBalance").value = a.balance || "";
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
    const payload = {
      bankName,
      accountName: $("bankAccountName").value.trim(),
      accountType: $("bankAccountType").value.trim(),
      accountNumber: $("bankAccountNumber").value.trim(),
      ownerName: $("bankOwnerName").value.trim(),
      branch: $("bankBranch").value.trim(),
      balance: parseFloat($("bankBalance").value) || 0,
      note: $("bankNote").value.trim(),
    };
    const rec = await encryptRecord("bank", existing, payload);
    await DiaryDB.putBankAccount(rec);
    closeBankModalVisual();
    popNavState();
    await loadAndRenderAll();
    showToast("บันทึกแล้ว");
  }

  async function deleteBank() {
    const id = $("bankId").value;
    if (!id) return;
    if (!confirm("ลบบัญชีธนาคารนี้หรือไม่?")) return;
    const raw = (await DiaryDB.getAllBankAccounts()).find((x) => x.id === id);
    if (!raw) return;
    raw.deletedAt = new Date().toISOString();
    raw.updatedAt = new Date().toISOString();
    await DiaryDB.putBankAccount(raw);
    closeBankModalVisual();
    popNavState();
    await loadAndRenderAll();
    showToast("ลบแล้ว");
  }

  async function sendBankToTelegram(id) {
    const a = allBankAccounts.find((x) => x.id === id);
    if (!a) return;
    if (typeof TelegramNotify === "undefined" || !TelegramNotify.isConfigured()) {
      showToast("ยังไม่ได้ตั้งค่า Telegram (ตั้งค่า → Telegram)");
      return;
    }
    // Deliberately sends ONLY the bank name and balance — never the account
    // number, branch, owner name, or note. Those stay encrypted and local;
    // this is the one narrow, explicit exception to "encrypted data never
    // leaves the device", made because the user wants a family member to
    // know which accounts exist and roughly how much is in them.
    const lines = [
      `🏦 ${a.bankName}${a.accountName ? " · " + a.accountName : ""}`,
      `ยอดคงเหลือ: ${Finance.formatMoney(parseFloat(a.balance) || 0)}`,
    ];
    try {
      await TelegramNotify.sendMessage(lines.join("\n"));
      showToast("ส่งเข้า Telegram แล้ว");
    } catch (err) {
      showToast("ส่งไม่สำเร็จ: " + (err && err.message ? err.message : ""));
    }
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
      const remaining = parseFloat(d.remainingAmount) || 0;
      const row = document.createElement("div");
      row.className = "asset-row";
      row.dataset.id = d.id;
      row.innerHTML = `
        <div class="asset-row-body">
          <div class="asset-row-title">💳 ${escapeHTML(d.debtName)}</div>
          <div class="asset-row-sub">คงเหลือ ${Finance.formatMoney(remaining)}${d.dueDay ? " · ชำระวันที่ " + escapeHTML(d.dueDay) : ""}</div>
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
    await loadAndRenderAll();
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
    await loadAndRenderAll();
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
      row.innerHTML = `
        <div class="asset-row-body">
          <div class="asset-row-title">📄 ${escapeHTML(o.category)} · ${escapeHTML(o.title)}</div>
          <div class="asset-row-sub">${o.note ? escapeHTML(o.note) : "แตะเพื่อดูรายละเอียด"}</div>
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
    await loadAndRenderAll();
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
    await loadAndRenderAll();
    showToast("ลบแล้ว");
  }

  /* ---------------- lifecycle ---------------- */

  async function render() {
    // Called whenever the "การเงิน" view is shown/refreshed. Only actually
    // decrypts and redraws the banking lists if the user has already
    // navigated into one of the locked sub-tabs this session — avoids an
    // unlock prompt firing every time someone just opens the finance tab
    // to check their income/expenses.
    if (currentSubtab === "tx") return;
    if (DiaryCrypto.isUnlocked()) await loadAndRenderAll();
    else await ensureUnlockedThenRender();
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
  }

  return {
    init, render, showFinSubtab,
    closeBankModalVisual, closeDebtModalVisual, closeOtherModalVisual,
  };
})();
