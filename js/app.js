/* app.js — main application logic */

const $ = (id) => document.getElementById(id);
const THAI_MONTHS = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const THAI_MONTHS_FULL = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];

const state = {
  entries: [],        // all records as stored (private ones still encrypted)
  view: "home",
  editId: null,
  viewId: null,
  viewDecrypted: null, // decrypted payload of the entry currently open, if private
  moodSelected: "",
  pendingImages: [],   // dataURLs for the entry currently being written
  unlockResolve: null,
  dayFilter: null,     // "YYYY-MM-DD" or null
  selectedTag: "",
  cal: { year: 0, month: 0 }, // calendar picker's visible month (0-indexed month)
  calMode: "browse", // "browse" (opened from header) or "pick" (opened from the write form's date field)
};

window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled error:", e.reason);
  showToast("เกิดข้อผิดพลาด: " + (e.reason && e.reason.message ? e.reason.message : "ไม่ทราบสาเหตุ"));
});

/* ---------------- utils ---------------- */

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function todayISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function nowHM() {
  const d = new Date();
  return d.toTimeString().slice(0, 5);
}

function formatDateHeading(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(date, today)) return "วันนี้";
  if (sameDay(date, yest)) return "เมื่อวาน";
  return `${d} ${THAI_MONTHS[m - 1]} ${y + 543}`;
}

// "วัน เดือน ปี" (พ.ศ.) with the full Thai month name — used wherever we want
// the date spelled out unambiguously, e.g. next to the date picker.
function formatFullThaiDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${d} ${THAI_MONTHS_FULL[m - 1]} ${y + 543}`;
}

function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => { t.hidden = true; }, 2200);
}

function escapeHTML(str) {
  return (str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------------- view routing ---------------- */

function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === name));
  document.querySelectorAll(".nav-btn[data-nav]").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
  state.view = name;
  window.scrollTo(0, 0);
}

/* ---------------- image compression ---------------- */

function compressImage(file, maxDim = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
          else { width = Math.round(width * (maxDim / height)); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function renderImageStrip() {
  const strip = $("imageStrip");
  strip.innerHTML = "";
  state.pendingImages.forEach((src, i) => {
    const div = document.createElement("div");
    div.className = "image-thumb";
    div.innerHTML = `<img src="${src}"><button type="button" class="remove-img" data-i="${i}">×</button>`;
    strip.appendChild(div);
  });
}

$("entryImages").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    try { state.pendingImages.push(await compressImage(f)); } catch (err) { /* skip bad file */ }
  }
  renderImageStrip();
  e.target.value = "";
});

$("imageStrip").addEventListener("click", (e) => {
  const btn = e.target.closest(".remove-img");
  if (!btn) return;
  state.pendingImages.splice(Number(btn.dataset.i), 1);
  renderImageStrip();
});

/* ---------------- unlock modal (returns Promise<boolean>) ---------------- */

function openUnlockModal(sub) {
  return new Promise((resolve) => {
    state.unlockResolve = resolve;
    $("unlockSub").textContent = sub || "เพื่อดูบันทึกส่วนตัว";
    $("unlockPassInput").value = "";
    $("unlockError").hidden = true;
    $("unlockModal").hidden = false;
    setTimeout(() => $("unlockPassInput").focus(), 50);
  });
}

function closeUnlockModal(result) {
  $("unlockModal").hidden = true;
  if (state.unlockResolve) { state.unlockResolve(result); state.unlockResolve = null; }
}

$("unlockCancelBtn").addEventListener("click", () => closeUnlockModal(false));
$("unlockConfirmBtn").addEventListener("click", async () => {
  const ok = await DiaryCrypto.tryUnlock($("unlockPassInput").value);
  if (ok) closeUnlockModal(true);
  else $("unlockError").hidden = false;
});
$("unlockPassInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("unlockConfirmBtn").click(); });

async function ensureUnlocked(sub) {
  if (DiaryCrypto.isUnlocked()) return true;
  return openUnlockModal(sub);
}

/* ---------------- set / change password modal ---------------- */

let setPwMode = "create";

function openSetPwModal(mode) {
  setPwMode = mode;
  $("setPwTitle").textContent = mode === "change" ? "เปลี่ยนรหัสผ่าน" : "ตั้งรหัสผ่าน";
  $("setPwOldInput").hidden = mode !== "change";
  $("setPwOldInput").value = "";
  $("setPwInput").value = "";
  $("setPwConfirmInput").value = "";
  $("setPwError").hidden = true;
  $("setPwModal").hidden = false;
}
function closeSetPwModal() { $("setPwModal").hidden = true; }

$("setPasswordBtn").addEventListener("click", () => openSetPwModal("create"));
$("changePasswordBtn").addEventListener("click", () => openSetPwModal("change"));
$("setPwCancelBtn").addEventListener("click", closeSetPwModal);

$("setPwConfirmBtn").addEventListener("click", async () => {
  const errEl = $("setPwError");
  errEl.hidden = true;
  const newPass = $("setPwInput").value;
  const confirmPass = $("setPwConfirmInput").value;
  if (newPass.length < 4) { errEl.textContent = "รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร"; errEl.hidden = false; return; }
  if (newPass !== confirmPass) { errEl.textContent = "รหัสผ่านไม่ตรงกัน"; errEl.hidden = false; return; }

  if (setPwMode === "create") {
    await DiaryCrypto.setupPassword(newPass);
    closeSetPwModal();
    refreshSettingsView();
    showToast("ตั้งรหัสผ่านแล้ว");
    return;
  }

  // change mode: decrypt all private entries with old key, setup new key, re-encrypt
  const oldPass = $("setPwOldInput").value;
  const ok = await DiaryCrypto.tryUnlock(oldPass);
  if (!ok) { errEl.textContent = "รหัสผ่านเดิมไม่ถูกต้อง"; errEl.hidden = false; return; }

  const privateEntries = state.entries.filter((e) => e.private);
  const decrypted = [];
  try {
    for (const e of privateEntries) {
      const payload = await DiaryCrypto.decryptJSON({ iv: e.encIv, data: e.encData });
      decrypted.push({ id: e.id, payload });
    }
  } catch (e) {
    errEl.textContent = "ถอดรหัสข้อมูลเดิมไม่สำเร็จ";
    errEl.hidden = false;
    return;
  }

  await DiaryCrypto.setupPassword(newPass);

  for (const item of decrypted) {
    const enc = await DiaryCrypto.encryptJSON(item.payload);
    const rec = state.entries.find((e) => e.id === item.id);
    rec.encIv = enc.iv;
    rec.encData = enc.data;
    rec.updatedAt = new Date().toISOString();
    await DiaryDB.put(rec);
  }

  closeSetPwModal();
  refreshSettingsView();
  showToast("เปลี่ยนรหัสผ่านแล้ว");
});

$("lockNowBtn").addEventListener("click", () => {
  DiaryCrypto.lock();
  showToast("ล็อกเซสชันแล้ว");
});

$("driveSyncBtn").addEventListener("click", async () => {
  if (typeof DriveSync === "undefined") { showToast("โหลดฟีเจอร์ซิงค์ไม่สำเร็จ"); return; }
  $("driveSyncBtn").disabled = true;
  $("driveSyncStatus").textContent = "กำลังซิงค์...";
  try {
    const count = await DriveSync.sync();
    state.entries = await DiaryDB.getAll();
    renderHome();
    $("driveSyncStatus").textContent = `ซิงค์แล้ว (${count} รายการ) — ${DriveSync.lastSyncedText()}`;
    showToast("ซิงค์กับ Google Drive สำเร็จ");
  } catch (err) {
    console.error("Drive sync failed:", err);
    $("driveSyncStatus").textContent = "ซิงค์ไม่สำเร็จ";
    showToast("ซิงค์ไม่สำเร็จ: " + (err && err.message ? err.message : "ไม่ทราบสาเหตุ"));
  } finally {
    $("driveSyncBtn").disabled = false;
  }
});

function refreshSettingsView() {
  const has = DiaryCrypto.hasPassword();
  $("pwStatusText").textContent = has ? "ตั้งรหัสผ่านแล้ว" : "ยังไม่ได้ตั้งรหัสผ่าน";
  $("setPasswordBtn").hidden = has;
  $("changePwRow").hidden = !has;
  $("entryCountText").textContent = state.entries.length;
  if (typeof DriveSync !== "undefined") {
    $("driveSyncStatus").textContent = DriveSync.lastSyncedText();
  }
}

/* ---------------- home / list rendering ---------------- */

function getFilteredEntries() {
  const q = $("searchInput").value.trim().toLowerCase();
  const month = $("filterMonth").value; // YYYY-MM
  const tag = $("filterTag").value;

  return state.entries.filter((e) => {
    if (state.dayFilter && e.date !== state.dayFilter) return false;
    if (month && !e.date.startsWith(month)) return false;
    if (e.private) {
      // private entries are never matched by search/tag filter; only date/month applies
      if (q || tag) return false;
      return true;
    }
    if (tag && !(e.tags || []).includes(tag)) return false;
    if (q) {
      const hay = `${e.title || ""} ${e.content || ""} ${(e.tags || []).join(" ")}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function populateTagFilter() {
  const sel = $("filterTag");
  const current = sel.value;
  const tags = new Set();
  state.entries.forEach((e) => { if (!e.private) (e.tags || []).forEach((t) => tags.add(t)); });
  sel.innerHTML = '<option value="">ทั้งหมด</option>' + [...tags].sort().map((t) => `<option value="${escapeHTML(t)}">${escapeHTML(t)}</option>`).join("");
  if ([...tags].includes(current)) sel.value = current;
  return [...tags].sort();
}

function populateMonthFilter() {
  const sel = $("filterMonth");
  const current = sel.value;
  const months = new Set();
  state.entries.forEach((e) => months.add(e.date.slice(0, 7)));
  const sorted = [...months].sort().reverse();
  sel.innerHTML = '<option value="">ทั้งหมด</option>' + sorted.map((m) => {
    const [y, mo] = m.split("-").map(Number);
    return `<option value="${m}">${THAI_MONTHS[mo - 1]} ${y + 543}</option>`;
  }).join("");
  if (sorted.includes(current)) sel.value = current;
}

function renderTagChips(tags) {
  const row = $("tagChipRow");
  if (tags.length === 0) { row.innerHTML = ""; return; }
  const selected = $("filterTag").value;
  const allChip = `<button type="button" class="tag-chip${selected ? "" : " selected"}" data-tag="">ทั้งหมด</button>`;
  row.innerHTML = allChip + tags.map((t) => `<button type="button" class="tag-chip${t === selected ? " selected" : ""}" data-tag="${escapeHTML(t)}">${escapeHTML(t)}</button>`).join("");
}

$("tagChipRow").addEventListener("click", (e) => {
  const chip = e.target.closest(".tag-chip");
  if (!chip) return;
  const tag = chip.dataset.tag;
  $("filterTag").value = (!tag || $("filterTag").value === tag) ? "" : tag;
  renderHome();
});

function updateDayFilterChip() {
  const chip = $("dayFilterChip");
  if (state.dayFilter) {
    chip.hidden = false;
    $("dayFilterLabel").textContent = `กำลังดู: ${formatDateHeading(state.dayFilter)}`;
  } else {
    chip.hidden = true;
  }
}

$("clearDayFilterBtn").addEventListener("click", () => {
  state.dayFilter = null;
  updateDayFilterChip();
  renderHome();
});

function renderHome() {
  const list = getFilteredEntries().slice().sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const container = $("entryList");
  container.innerHTML = "";
  $("emptyState").hidden = list.length > 0 || state.entries.length > 0;

  let currentDate = null;
  let groupDiv = null;
  list.forEach((e) => {
    if (e.date !== currentDate) {
      currentDate = e.date;
      groupDiv = document.createElement("div");
      groupDiv.className = "date-group";
      groupDiv.innerHTML = `<div class="date-heading">${formatDateHeading(e.date)}</div>`;
      container.appendChild(groupDiv);
    }
    const card = document.createElement("div");
    card.className = "entry-card";
    card.dataset.id = e.id;

    if (e.private) {
      card.innerHTML = `
        <div class="entry-time">${e.time}</div>
        <div class="entry-body">
          <div class="entry-title-row"><span class="entry-lock-icon">🔒</span><p class="entry-title">บันทึกส่วนตัว</p></div>
        </div>`;
    } else {
      const preview = (e.content || "").replace(/\s+/g, " ").trim();
      card.innerHTML = `
        <div class="entry-time">${e.time}</div>
        <div class="entry-body">
          <div class="entry-title-row">
            <p class="entry-title">${escapeHTML(e.title || "(ไม่มีชื่อเรื่อง)")}</p>
            <span class="entry-mood">${e.mood || ""}</span>
          </div>
          <p class="entry-preview">${escapeHTML(preview)}</p>
          ${(e.tags && e.tags.length) ? `<div class="entry-tags">${e.tags.map((t) => `<span class="entry-tag">${escapeHTML(t)}</span>`).join("")}</div>` : ""}
        </div>`;
    }
    groupDiv.appendChild(card);
  });

  if (state.entries.length === 0) $("emptyState").hidden = false;
  const tags = populateTagFilter();
  populateMonthFilter();
  renderTagChips(tags);
  updateDayFilterChip();
  refreshSettingsView();
}

$("entryList").addEventListener("click", (e) => {
  const card = e.target.closest(".entry-card");
  if (card) openEntry(card.dataset.id);
});

$("searchInput").addEventListener("input", renderHome);
$("filterMonth").addEventListener("change", renderHome);
$("filterTag").addEventListener("change", renderHome);
$("clearFilterBtn").addEventListener("click", () => {
  $("filterMonth").value = "";
  $("filterTag").value = "";
  $("searchInput").value = "";
  renderHome();
});
$("filterToggleBtn").addEventListener("click", () => {
  const panel = $("filterPanel");
  panel.hidden = !panel.hidden;
  $("filterToggleBtn").setAttribute("aria-expanded", String(!panel.hidden));
});

/* ---------------- write / edit ---------------- */

$("entryDatePicker").addEventListener("click", () => {
  state.calMode = "pick";
  const [y, m] = ($("entryDate").value || todayISO()).split("-").map(Number);
  state.cal.year = y;
  state.cal.month = m - 1;
  openCalendar();
});

function setEntryDate(dateStr) {
  $("entryDate").value = dateStr;
  $("entryDatePicker").textContent = formatFullThaiDate(dateStr);
}

function resetWriteForm() {
  $("entryId").value = "";
  setEntryDate(todayISO());
  $("entryTime").value = nowHM();
  $("entryTitle").value = "";
  $("entryContent").value = "";
  $("entryTags").value = "";
  $("entryPrivate").checked = false;
  state.moodSelected = "";
  state.pendingImages = [];
  renderImageStrip();
  document.querySelectorAll(".mood-btn").forEach((b) => b.classList.remove("selected"));
}

function openWriteForNew() {
  resetWriteForm();
  $("writeHeading").textContent = "เขียนบันทึก";
  state.editId = null;
  showView("write");
}

async function openWriteForEdit(id) {
  const rec = state.entries.find((e) => e.id === id);
  if (!rec) return;
  let data;
  if (rec.private) {
    const ok = await ensureUnlocked("เพื่อแก้ไขบันทึกส่วนตัว");
    if (!ok) return;
    try { data = await DiaryCrypto.decryptJSON({ iv: rec.encIv, data: rec.encData }); }
    catch (e) { showToast("ถอดรหัสไม่สำเร็จ"); return; }
  } else {
    data = rec;
  }
  resetWriteForm();
  $("entryId").value = rec.id;
  setEntryDate(rec.date);
  $("entryTime").value = rec.time;
  $("entryTitle").value = data.title || "";
  $("entryContent").value = data.content || "";
  $("entryTags").value = (data.tags || []).join(", ");
  $("entryPrivate").checked = !!rec.private;
  state.moodSelected = data.mood || "";
  state.pendingImages = (data.images || []).slice();
  renderImageStrip();
  document.querySelectorAll(".mood-btn").forEach((b) => b.classList.toggle("selected", b.dataset.mood === state.moodSelected));
  $("writeHeading").textContent = "แก้ไขบันทึก";
  state.editId = rec.id;
  showView("write");
}

$("moodPicker").addEventListener("click", (e) => {
  const btn = e.target.closest(".mood-btn");
  if (!btn) return;
  const m = btn.dataset.mood;
  state.moodSelected = state.moodSelected === m ? "" : m;
  document.querySelectorAll(".mood-btn").forEach((b) => b.classList.toggle("selected", b.dataset.mood === state.moodSelected));
});

$("entryPrivate").addEventListener("change", async (e) => {
  if (e.target.checked && !DiaryCrypto.hasPassword()) {
    e.target.checked = false;
    showToast("ตั้งรหัสผ่านก่อนใช้โหมดส่วนตัว");
    openSetPwModal("create");
  }
});

$("newEntryBtn").addEventListener("click", openWriteForNew);
$("cancelWriteBtn").addEventListener("click", () => showView(state.editId ? "entry" : "home"));

$("entryForm").addEventListener("submit", (e) => e.preventDefault());

$("saveEntryBtn").addEventListener("click", async () => {
  try {
    const date = $("entryDate").value;
    const time = $("entryTime").value;
    if (!date || !time) { showToast("กรุณาใส่วันที่และเวลา"); return; }

    const tags = $("entryTags").value.split(",").map((t) => t.trim()).filter(Boolean);
    const payload = {
      title: $("entryTitle").value.trim(),
      content: $("entryContent").value,
      mood: state.moodSelected,
      tags,
      images: state.pendingImages.slice(),
    };
    const isPrivate = $("entryPrivate").checked;

    if (isPrivate) {
      if (!DiaryCrypto.hasPassword()) { showToast("กรุณาตั้งรหัสผ่านก่อน"); openSetPwModal("create"); return; }
      const ok = await ensureUnlocked("เพื่อบันทึกเนื้อหาส่วนตัว");
      if (!ok) return;
    }

    const id = $("entryId").value || uid();
    const existing = state.entries.find((e) => e.id === id);
    const rec = {
      id, date, time, private: isPrivate,
      // hasImages is kept unencrypted (even for private entries) on purpose,
      // only so the calendar can mark that day — no title/content ever leaks this way.
      hasImages: state.pendingImages.length > 0,
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (isPrivate) {
      const enc = await DiaryCrypto.encryptJSON(payload);
      rec.encIv = enc.iv;
      rec.encData = enc.data;
    } else {
      Object.assign(rec, payload);
    }

    await DiaryDB.put(rec);
    const idx = state.entries.findIndex((e) => e.id === id);
    if (idx >= 0) state.entries[idx] = rec; else state.entries.push(rec);

    renderHome();
    showToast("บันทึกแล้ว");
    showView("home");
  } catch (err) {
    console.error("Save failed:", err);
    showToast("บันทึกไม่สำเร็จ: " + (err && err.message ? err.message : "ไม่ทราบสาเหตุ"));
  }
});

/* ---------------- entry detail ---------------- */

async function openEntry(id) {
  const rec = state.entries.find((e) => e.id === id);
  if (!rec) return;
  state.viewId = id;
  let data;
  if (rec.private) {
    const ok = await ensureUnlocked("เพื่อดูบันทึกส่วนตัว");
    if (!ok) return;
    try { data = await DiaryCrypto.decryptJSON({ iv: rec.encIv, data: rec.encData }); }
    catch (e) { showToast("ถอดรหัสไม่สำเร็จ"); return; }
  } else {
    data = rec;
  }
  state.viewDecrypted = data;
  $("entryPrivateBadge").hidden = !rec.private;

  const detail = $("entryDetail");
  detail.innerHTML = `
    <div class="detail-datetime">${formatDateHeading(rec.date)} · ${rec.time} น.</div>
    ${data.title ? `<h2 class="detail-title">${escapeHTML(data.title)}</h2>` : ""}
    ${data.mood ? `<div class="detail-mood">${data.mood}</div>` : ""}
    <div class="detail-content">${escapeHTML(data.content || "")}</div>
    ${(data.images && data.images.length) ? `<div class="detail-images">${data.images.map((src) => `<img src="${src}">`).join("")}</div>` : ""}
    ${(data.tags && data.tags.length) ? `<div class="detail-tags">${data.tags.map((t) => `<span class="entry-tag">${escapeHTML(t)}</span>`).join("")}</div>` : ""}
  `;
  showView("entry");
}

$("backFromEntryBtn").addEventListener("click", () => showView("home"));
$("editEntryBtn").addEventListener("click", () => openWriteForEdit(state.viewId));

$("deleteEntryBtn").addEventListener("click", async () => {
  if (!state.viewId) return;
  if (!confirm("ลบบันทึกนี้ถาวรหรือไม่?")) return;
  await DiaryDB.remove(state.viewId);
  state.entries = state.entries.filter((e) => e.id !== state.viewId);
  renderHome();
  showToast("ลบแล้ว");
  showView("home");
});

$("exportEntryBtn").addEventListener("click", () => {
  const rec = state.entries.find((e) => e.id === state.viewId);
  if (!rec) return;
  downloadJSON(rec, `diary-entry-${rec.date}-${rec.id}.json`);
});

/* ---------------- backup / restore ---------------- */

function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

$("backupBtn").addEventListener("click", () => {
  const hasPw = DiaryCrypto.hasPassword();
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: hasPw ? {
      salt: localStorage.getItem("diary_pw_salt"),
      verifierIv: localStorage.getItem("diary_pw_verifier_iv"),
      verifier: localStorage.getItem("diary_pw_verifier"),
    } : null,
    entries: state.entries,
  };
  const stamp = todayISO().replace(/-/g, "");
  downloadJSON(backup, `diary-backup-${stamp}.json`);
  showToast("ดาวน์โหลดไฟล์สำรองแล้ว");
});

$("restoreFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const backup = JSON.parse(text);
    if (!Array.isArray(backup.entries)) throw new Error("bad format");

    if (backup.settings && !DiaryCrypto.hasPassword()) {
      localStorage.setItem("diary_pw_salt", backup.settings.salt);
      localStorage.setItem("diary_pw_verifier_iv", backup.settings.verifierIv);
      localStorage.setItem("diary_pw_verifier", backup.settings.verifier);
    }

    await DiaryDB.bulkPut(backup.entries);
    const all = await DiaryDB.getAll();
    state.entries = all;
    renderHome();
    showToast(`กู้คืนข้อมูลแล้ว (${backup.entries.length} รายการ)`);
  } catch (err) {
    showToast("ไฟล์ไม่ถูกต้อง กู้คืนไม่สำเร็จ");
  }
  e.target.value = "";
});

/* ---------------- calendar picker ---------------- */

function pad2(n) { return String(n).padStart(2, "0"); }

function renderCalendar() {
  const { year, month } = state.cal; // month is 0-indexed
  $("calTitle").textContent = `${THAI_MONTHS[month]} ${year + 543}`;

  const firstWeekday = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = todayISO();

  // build a lookup of date -> {hasEntry, hasImage}
  const dayInfo = {};
  state.entries.forEach((e) => {
    if (!dayInfo[e.date]) dayInfo[e.date] = { hasEntry: false, hasImage: false };
    dayInfo[e.date].hasEntry = true;
    if (e.hasImages) dayInfo[e.date].hasImage = true;
  });

  const grid = $("calGrid");
  grid.innerHTML = "";
  for (let i = 0; i < firstWeekday; i++) {
    grid.insertAdjacentHTML("beforeend", '<span class="cal-cell empty"></span>');
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${pad2(month + 1)}-${pad2(d)}`;
    const info = dayInfo[dateStr];
    const classes = ["cal-cell"];
    if (dateStr === todayStr) classes.push("today");
    if (info && info.hasEntry) classes.push("has-entry");
    if (info && info.hasImage) classes.push("has-image");
    const mark = info && info.hasEntry ? '<span class="cal-mark"></span>' : "";
    grid.insertAdjacentHTML("beforeend", `<button type="button" class="${classes.join(" ")}" data-date="${dateStr}">${d}${mark}</button>`);
  }
}

function openCalendar() {
  $("calendarModal").hidden = false;
  renderCalendar();
}
function closeCalendar() { $("calendarModal").hidden = true; }

$("todayPill").addEventListener("click", () => { state.calMode = "browse"; openCalendar(); });
$("calCloseBtn").addEventListener("click", closeCalendar);
$("calPrevBtn").addEventListener("click", () => {
  state.cal.month -= 1;
  if (state.cal.month < 0) { state.cal.month = 11; state.cal.year -= 1; }
  renderCalendar();
});
$("calNextBtn").addEventListener("click", () => {
  state.cal.month += 1;
  if (state.cal.month > 11) { state.cal.month = 0; state.cal.year += 1; }
  renderCalendar();
});

$("calGrid").addEventListener("click", (e) => {
  const cell = e.target.closest(".cal-cell:not(.empty)");
  if (!cell) return;
  const dateStr = cell.dataset.date;

  if (state.calMode === "pick") {
    setEntryDate(dateStr);
    closeCalendar();
    return;
  }

  closeCalendar();
  if (cell.classList.contains("has-entry")) {
    state.dayFilter = dateStr;
    showView("home");
    renderHome();
  } else {
    // empty day: jump straight into writing a new entry for that date
    openWriteForNew();
    setEntryDate(dateStr);
  }
});

/* ---------------- nav ---------------- */

document.querySelectorAll(".nav-btn[data-nav]").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.nav));
});

/* ---------------- init ---------------- */

async function init() {
  try {
    const today = new Date();
    $("todayPill").textContent = `${today.getDate()} ${THAI_MONTHS[today.getMonth()]} ${today.getFullYear() + 543}`;
    state.cal.year = today.getFullYear();
    state.cal.month = today.getMonth();

    state.entries = await DiaryDB.getAll();
    renderHome();
    refreshSettingsView();
    showView("home");

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  } catch (err) {
    console.error("Init failed:", err);
    showToast("โหลดข้อมูลไม่สำเร็จ: " + (err && err.message ? err.message : "ไม่ทราบสาเหตุ"));
  }
}

init();
