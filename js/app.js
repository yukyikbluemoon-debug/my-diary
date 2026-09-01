/* app.js — main application logic */

const $ = (id) => document.getElementById(id);
const THAI_MONTHS = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const THAI_MONTHS_FULL = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const TRASH_RETENTION_DAYS = 30;
const VIDEO_MAX_SECONDS = 30;

const state = {
  entries: [],
  view: "home",
  editId: null,
  viewId: null,
  viewDecrypted: null,
  moodSelected: "",
  pendingAttachments: [],  // [{id, type, blob, url, existing:bool}]
  removedAttachmentIds: [],
  entryLocation: null,     // {lat, lng} | null
  unlockResolve: null,
  dayFilter: null,
  cal: { year: 0, month: 0 },
  calMode: "browse",
  recorder: null,          // active MediaRecorder
  recorderStream: null,
  recorderChunks: [],
  recorderType: null,      // "voice" | "video"
  recorderTimerId: null,
  recorderStartedAt: 0,
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
  return new Date().toISOString().slice(0, 10);
}
function nowHM() {
  return new Date().toTimeString().slice(0, 5);
}
function pad2(n) { return String(n).padStart(2, "0"); }

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
  showToast._h = setTimeout(() => { t.hidden = true; }, 2400);
}

function escapeHTML(str) {
  return (str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
function dataURLToBlob(dataURL) {
  const [header, b64] = dataURL.split(",");
  const mime = /data:(.*?);base64/.exec(header)[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

/* ---------------- view routing ---------------- */

function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === name));
  document.querySelectorAll(".nav-btn[data-nav]").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
  state.view = name;
  window.scrollTo(0, 0);
}

/* ---------------- lightbox ---------------- */

function openLightbox(src) {
  $("lightboxImg").src = src;
  $("lightbox").hidden = false;
}
$("lightboxCloseBtn").addEventListener("click", () => { $("lightbox").hidden = true; $("lightboxImg").src = ""; });
$("lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") { $("lightbox").hidden = true; $("lightboxImg").src = ""; } });
document.addEventListener("click", (e) => {
  const img = e.target.closest(".detail-images img, .attach-strip img");
  if (img) openLightbox(img.src);
});

/* ---------------- attachments: images ---------------- */

function compressImageToBlob(file, maxDim = 1280, quality = 0.7) {
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
        canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function addPendingAttachment(type, blob) {
  const url = URL.createObjectURL(blob);
  state.pendingAttachments.push({ id: uid(), type, blob, url, existing: false });
  renderAttachStrip();
}

$("entryImages").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    try { addPendingAttachment("image", await compressImageToBlob(f)); } catch (err) { /* skip bad file */ }
  }
  e.target.value = "";
});

function attachIcon(type) {
  return { image: "🖼️", audio: "🎙️", video: "🎥", sketch: "✏️" }[type] || "📎";
}

function renderAttachStrip() {
  const strip = $("attachStrip");
  strip.innerHTML = "";
  state.pendingAttachments.forEach((a) => {
    const chip = document.createElement("div");
    chip.className = "attach-chip";
    if (a.type === "image" || a.type === "sketch") {
      chip.innerHTML = `<img src="${a.url}" style="width:32px;height:32px;object-fit:cover;border-radius:4px;">`;
    } else {
      chip.innerHTML = `<span>${attachIcon(a.type)}</span>`;
    }
    const label = document.createElement("span");
    label.textContent = a.type === "image" ? "รูป" : a.type === "audio" ? "เสียง" : a.type === "video" ? "วิดีโอ" : "ภาพวาด";
    chip.appendChild(label);
    const rm = document.createElement("button");
    rm.type = "button"; rm.className = "remove-img"; rm.textContent = "×";
    rm.addEventListener("click", () => {
      if (a.existing) state.removedAttachmentIds.push(a.id);
      state.pendingAttachments = state.pendingAttachments.filter((x) => x.id !== a.id);
      renderAttachStrip();
    });
    chip.appendChild(rm);
    strip.appendChild(chip);
  });
}

/* ---------------- attachments: voice / video recording ---------------- */

function pickMimeType(candidates) {
  for (const c of candidates) if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
  return "";
}

async function startRecording(type) {
  if (!navigator.mediaDevices || !window.MediaRecorder) {
    showToast("อุปกรณ์นี้ไม่รองรับการอัดเสียง/วิดีโอ");
    return;
  }
  const constraints = type === "video" ? { audio: true, video: { facingMode: "user" } } : { audio: true };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    showToast("ขอสิทธิ์ไมค์/กล้องไม่สำเร็จ: " + (err && err.message ? err.message : ""));
    return;
  }
  const mimeType = type === "video"
    ? pickMimeType(["video/webm;codecs=vp9,opus", "video/webm", "video/mp4"])
    : pickMimeType(["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]);

  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  state.recorder = recorder;
  state.recorderStream = stream;
  state.recorderChunks = [];
  state.recorderType = type;
  state.recorderStartedAt = Date.now();

  recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) state.recorderChunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(state.recorderChunks, { type: recorder.mimeType || (type === "video" ? "video/webm" : "audio/webm") });
    addPendingAttachment(type === "video" ? "video" : "audio", blob);
    stream.getTracks().forEach((t) => t.stop());
    if (type === "video") { $("videoLivePreview").hidden = true; $("videoLivePreview").srcObject = null; }
  };

  if (type === "video") {
    const preview = $("videoLivePreview");
    preview.srcObject = stream;
    preview.hidden = false;
  }

  recorder.start();
  const btn = type === "video" ? $("videoRecordBtn") : $("voiceRecordBtn");
  btn.classList.add("recording");
  updateRecordButtonLabel();
  state.recorderTimerId = setInterval(() => {
    updateRecordButtonLabel();
    if (type === "video" && (Date.now() - state.recorderStartedAt) / 1000 >= VIDEO_MAX_SECONDS) {
      stopRecording();
    }
  }, 500);
}

function updateRecordButtonLabel() {
  const secs = Math.floor((Date.now() - state.recorderStartedAt) / 1000);
  if (state.recorderType === "video") {
    $("videoRecordBtn").textContent = `⏹️ หยุด (${secs}/${VIDEO_MAX_SECONDS} วิ)`;
  } else if (state.recorderType === "voice") {
    $("voiceRecordBtn").textContent = `⏹️ หยุดบันทึก (${secs} วิ)`;
  }
}

function stopRecording() {
  if (!state.recorder) return;
  clearInterval(state.recorderTimerId);
  state.recorderTimerId = null;
  const type = state.recorderType;
  state.recorder.stop();
  state.recorder = null;
  state.recorderType = null;
  const btn = type === "video" ? $("videoRecordBtn") : $("voiceRecordBtn");
  btn.classList.remove("recording");
  btn.textContent = type === "video" ? "🎥 วิดีโอสั้น" : "🎙️ บันทึกเสียง";
}

$("voiceRecordBtn").addEventListener("click", () => {
  if (state.recorder && state.recorderType === "voice") stopRecording();
  else if (!state.recorder) startRecording("voice");
});
$("videoRecordBtn").addEventListener("click", () => {
  if (state.recorder && state.recorderType === "video") stopRecording();
  else if (!state.recorder) startRecording("video");
});

/* ---------------- attachments: sketch pad ---------------- */

let sketchCtx = null;
let sketchDrawing = false;
let sketchColor = "#14181D";

function initSketchCanvas() {
  const canvas = $("sketchCanvas");
  sketchCtx = canvas.getContext("2d");
  sketchCtx.fillStyle = "#ffffff";
  sketchCtx.fillRect(0, 0, canvas.width, canvas.height);
  sketchCtx.lineWidth = 4;
  sketchCtx.lineCap = "round";
  sketchCtx.lineJoin = "round";
}

function sketchPos(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
  return { x: cx * (canvas.width / rect.width), y: cy * (canvas.height / rect.height) };
}

$("sketchOpenBtn").addEventListener("click", () => {
  $("sketchModal").hidden = false;
  initSketchCanvas();
});
$("sketchCancelBtn").addEventListener("click", () => { $("sketchModal").hidden = true; });
$("sketchClearBtn").addEventListener("click", () => {
  const canvas = $("sketchCanvas");
  sketchCtx.fillStyle = "#ffffff";
  sketchCtx.fillRect(0, 0, canvas.width, canvas.height);
});
$("sketchColors").addEventListener("click", (e) => {
  const btn = e.target.closest(".sketch-color");
  if (!btn) return;
  sketchColor = btn.dataset.color;
  document.querySelectorAll(".sketch-color").forEach((b) => b.classList.toggle("selected", b === btn));
});
$("sketchSaveBtn").addEventListener("click", () => {
  $("sketchCanvas").toBlob((blob) => {
    if (blob) addPendingAttachment("sketch", blob);
    $("sketchModal").hidden = true;
  }, "image/png");
});

(function wireSketchCanvasEvents() {
  const canvas = $("sketchCanvas");
  const start = (e) => { sketchDrawing = true; const p = sketchPos(e, canvas); sketchCtx.strokeStyle = sketchColor; sketchCtx.beginPath(); sketchCtx.moveTo(p.x, p.y); e.preventDefault(); };
  const move = (e) => { if (!sketchDrawing) return; const p = sketchPos(e, canvas); sketchCtx.lineTo(p.x, p.y); sketchCtx.stroke(); e.preventDefault(); };
  const end = () => { sketchDrawing = false; };
  canvas.addEventListener("pointerdown", start);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointerleave", end);
})();

/* ---------------- location ---------------- */

$("entryLocationToggle").addEventListener("change", (e) => {
  if (!e.target.checked) { state.entryLocation = null; $("locationSubText").textContent = "ไม่บังคับ — ใช้ตำแหน่งคร่าวๆ จาก GPS"; return; }
  if (!navigator.geolocation) {
    e.target.checked = false;
    showToast("อุปกรณ์นี้ไม่รองรับ GPS");
    return;
  }
  $("locationSubText").textContent = "กำลังขอตำแหน่ง...";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.entryLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      $("locationSubText").textContent = `ตำแหน่ง: ${state.entryLocation.lat.toFixed(4)}, ${state.entryLocation.lng.toFixed(4)}`;
    },
    (err) => {
      e.target.checked = false;
      state.entryLocation = null;
      $("locationSubText").textContent = "ไม่บังคับ — ใช้ตำแหน่งคร่าวๆ จาก GPS";
      showToast("ขอตำแหน่งไม่สำเร็จ: " + (err && err.message ? err.message : ""));
    },
    { enableHighAccuracy: false, timeout: 15000 }
  );
});

/* ---------------- markdown toolbar ---------------- */

$("mdBoldBtn").addEventListener("click", () => MarkdownLite.insertAround($("entryContent"), "**", "**", "ตัวหนา"));
$("mdItalicBtn").addEventListener("click", () => MarkdownLite.insertAround($("entryContent"), "*", "*", "ตัวเอียง"));
$("mdBulletBtn").addEventListener("click", () => MarkdownLite.insertLinePrefix($("entryContent"), "- "));
$("mdCheckBtn").addEventListener("click", () => MarkdownLite.insertLinePrefix($("entryContent"), "- [ ] "));

/* ---------------- unlock modal ---------------- */

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

/* ---------------- set / change / reset password modal ---------------- */

let setPwMode = "create";

function openSetPwModal(mode) {
  setPwMode = mode;
  $("setPwTitle").textContent = mode === "change" ? "เปลี่ยนรหัสผ่าน" : mode === "reset" ? "รีเซ็ตรหัสผ่าน" : "ตั้งรหัสผ่าน";
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
$("resetPasswordBtn").addEventListener("click", () => {
  const ok = confirm("ถ้ารีเซ็ตรหัสผ่าน บันทึกส่วนตัวที่เข้ารหัสไว้ด้วยรหัสเดิมทั้งหมดจะเปิดอ่านไม่ได้อีกตลอดกาล ต้องการดำเนินการต่อหรือไม่?");
  if (ok) openSetPwModal("reset");
});
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

  if (setPwMode === "reset") {
    await DiaryCrypto.setupPassword(newPass);
    closeSetPwModal();
    refreshSettingsView();
    showToast("รีเซ็ตรหัสผ่านแล้ว (บันทึกส่วนตัวเก่าเปิดไม่ได้อีก)");
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
  $("forgotPwRow").hidden = !has;
  $("entryCountText").textContent = state.entries.filter((e) => !e.deletedAt).length;
  $("trashCountText").textContent = state.entries.filter((e) => e.deletedAt).length;
  if (typeof DriveSync !== "undefined") {
    $("driveSyncStatus").textContent = DriveSync.lastSyncedText();
  }
  document.querySelectorAll(".theme-swatch").forEach((b) => b.classList.toggle("selected", b.dataset.theme === ThemeSettings.getTheme()));
  document.querySelectorAll(".fontsize-btn").forEach((b) => b.classList.toggle("selected", b.dataset.size === ThemeSettings.getFontSize()));
}

$("themeSwatchRow").addEventListener("click", (e) => {
  const btn = e.target.closest(".theme-swatch");
  if (!btn) return;
  ThemeSettings.setTheme(btn.dataset.theme);
  refreshSettingsView();
});
$("fontsizeRow").addEventListener("click", (e) => {
  const btn = e.target.closest(".fontsize-btn");
  if (!btn) return;
  ThemeSettings.setFontSize(btn.dataset.size);
  refreshSettingsView();
});

/* ---------------- home / list rendering ---------------- */

function activeEntries() {
  return state.entries.filter((e) => !e.deletedAt);
}

function getFilteredEntries() {
  const q = $("searchInput").value.trim().toLowerCase();
  const month = $("filterMonth").value;
  const tag = $("filterTag").value;

  return activeEntries().filter((e) => {
    if (state.dayFilter && e.date !== state.dayFilter) return false;
    if (month && !e.date.startsWith(month)) return false;
    if (e.private) {
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
  activeEntries().forEach((e) => { if (!e.private) (e.tags || []).forEach((t) => tags.add(t)); });
  sel.innerHTML = '<option value="">ทั้งหมด</option>' + [...tags].sort().map((t) => `<option value="${escapeHTML(t)}">${escapeHTML(t)}</option>`).join("");
  if ([...tags].includes(current)) sel.value = current;
  return [...tags].sort();
}

function populateMonthFilter() {
  const sel = $("filterMonth");
  const current = sel.value;
  const months = new Set();
  activeEntries().forEach((e) => months.add(e.date.slice(0, 7)));
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

function renderOnThisDay() {
  const today = new Date();
  const mmdd = `${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
  const todayYear = today.getFullYear();
  const matches = activeEntries()
    .filter((e) => e.date.slice(5) === mmdd && Number(e.date.slice(0, 4)) !== todayYear)
    .sort((a, b) => b.date.localeCompare(a.date));

  const box = $("onThisDay");
  if (matches.length === 0) { box.hidden = true; return; }
  box.hidden = false;
  $("onThisDayList").innerHTML = matches.map((e) => {
    const year = Number(e.date.slice(0, 4)) + 543;
    const label = e.private ? "🔒 บันทึกส่วนตัว" : escapeHTML(e.title || "(ไม่มีชื่อเรื่อง)");
    return `<div class="otd-item" data-id="${e.id}"><span class="otd-year">${year}</span>${label}</div>`;
  }).join("");
}
$("onThisDayList").addEventListener("click", (e) => {
  const item = e.target.closest(".otd-item");
  if (item) openEntry(item.dataset.id);
});

function renderHome() {
  const list = getFilteredEntries().slice().sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const container = $("entryList");
  container.innerHTML = "";
  $("emptyState").hidden = list.length > 0 || activeEntries().length > 0;

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
      const preview = (e.content || "").replace(/[#*_\[\]]/g, "").replace(/\s+/g, " ").trim();
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

  if (activeEntries().length === 0) $("emptyState").hidden = false;
  const tags = populateTagFilter();
  populateMonthFilter();
  renderTagChips(tags);
  updateDayFilterChip();
  renderOnThisDay();
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

function clearRecordingUI() {
  if (state.recorder) stopRecording();
  $("videoLivePreview").hidden = true;
}

function resetWriteForm() {
  $("entryId").value = "";
  setEntryDate(todayISO());
  $("entryTime").value = nowHM();
  $("entryTitle").value = "";
  $("entryContent").value = "";
  $("entryTags").value = "";
  $("entryPrivate").checked = false;
  $("entryLocationToggle").checked = false;
  state.entryLocation = null;
  $("locationSubText").textContent = "ไม่บังคับ — ใช้ตำแหน่งคร่าวๆ จาก GPS";
  state.moodSelected = "";
  state.pendingAttachments = [];
  state.removedAttachmentIds = [];
  clearRecordingUI();
  renderAttachStrip();
  document.querySelectorAll(".mood-btn").forEach((b) => b.classList.remove("selected"));
}

function openWriteForNew() {
  resetWriteForm();
  $("writeHeading").textContent = "เขียนบันทึก";
  state.editId = null;
  showView("write");
}

async function loadAttachmentsForEntry(rec) {
  // resolves blob (downloading from Drive on demand if only metadata is cached locally)
  const items = [];
  for (const ref of rec.attachmentRefs || []) {
    let att = await DiaryDB.getAttachment(ref.id);
    if (!att) continue;
    if (!att.blob && att.driveFileId && typeof DriveSync !== "undefined") {
      try {
        const blob = await DriveSync.downloadAttachmentBlob(att.driveFileId);
        att.blob = blob;
        await DiaryDB.putAttachment(att);
      } catch (err) {
        continue; // couldn't fetch yet (offline etc.) — skip, don't fail the whole entry
      }
    }
    if (att.blob) items.push({ id: att.id, type: att.type, blob: att.blob, url: URL.createObjectURL(att.blob) });
  }
  return items;
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

  const loc = rec.private ? data.location : rec.location;
  if (loc) {
    state.entryLocation = loc;
    $("entryLocationToggle").checked = true;
    $("locationSubText").textContent = `ตำแหน่ง: ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`;
  }

  if (rec.private) {
    state.pendingAttachments = (data.media || []).map((m) => ({
      id: uid(), type: m.type, blob: dataURLToBlob(m.dataURL), url: m.dataURL, existing: true,
    }));
  } else {
    const loaded = await loadAttachmentsForEntry(rec);
    state.pendingAttachments = loaded.map((a) => ({ ...a, existing: true }));
  }
  renderAttachStrip();

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
$("cancelWriteBtn").addEventListener("click", () => { clearRecordingUI(); showView(state.editId ? "entry" : "home"); });

$("entryForm").addEventListener("submit", (e) => e.preventDefault());

$("saveEntryBtn").addEventListener("click", async () => {
  try {
    const date = $("entryDate").value;
    const time = $("entryTime").value;
    if (!date || !time) { showToast("กรุณาใส่วันที่และเวลา"); return; }

    const tags = $("entryTags").value.split(",").map((t) => t.trim()).filter(Boolean);
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
      hasMedia: state.pendingAttachments.length > 0,
      deletedAt: null,
      createdAt: existing ? existing.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (isPrivate) {
      const media = [];
      for (const a of state.pendingAttachments) {
        const dataURL = a.url && a.url.startsWith("data:") ? a.url : await blobToDataURL(a.blob);
        media.push({ type: a.type, dataURL });
      }
      const payload = {
        title: $("entryTitle").value.trim(),
        content: $("entryContent").value,
        mood: state.moodSelected,
        tags,
        media,
        location: state.entryLocation,
      };
      const enc = await DiaryCrypto.encryptJSON(payload);
      rec.encIv = enc.iv;
      rec.encData = enc.data;
    } else {
      rec.title = $("entryTitle").value.trim();
      rec.content = $("entryContent").value;
      rec.mood = state.moodSelected;
      rec.tags = tags;
      rec.location = state.entryLocation;

      for (const removedId of state.removedAttachmentIds) {
        await DiaryDB.removeAttachment(removedId);
      }
      const refs = [];
      for (const a of state.pendingAttachments) {
        if (!a.existing) {
          await DiaryDB.putAttachment({ id: a.id, entryId: id, type: a.type, blob: a.blob, mimeType: a.blob.type, size: a.blob.size, createdAt: new Date().toISOString(), driveFileId: null });
        }
        refs.push({ id: a.id, type: a.type });
      }
      rec.attachmentRefs = refs;
    }

    await DiaryDB.put(rec);
    const idx = state.entries.findIndex((e) => e.id === id);
    if (idx >= 0) state.entries[idx] = rec; else state.entries.push(rec);

    clearRecordingUI();
    renderHome();
    showToast("บันทึกแล้ว");
    showView("home");
  } catch (err) {
    console.error("Save failed:", err);
    showToast("บันทึกไม่สำเร็จ: " + (err && err.message ? err.message : "ไม่ทราบสาเหตุ"));
  }
});

/* ---------------- date picker ---------------- */

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

  let mediaItems = [];
  if (rec.private) {
    mediaItems = (data.media || []).map((m) => ({ type: m.type, url: m.dataURL }));
  } else {
    const loaded = await loadAttachmentsForEntry(rec);
    mediaItems = loaded;
  }

  const images = mediaItems.filter((m) => m.type === "image" || m.type === "sketch");
  const audios = mediaItems.filter((m) => m.type === "audio");
  const videos = mediaItems.filter((m) => m.type === "video");
  const loc = rec.private ? data.location : rec.location;

  const detail = $("entryDetail");
  detail.innerHTML = `
    <div class="detail-datetime">${formatDateHeading(rec.date)} · ${rec.time} น.</div>
    ${data.title ? `<h2 class="detail-title">${escapeHTML(data.title)}</h2>` : ""}
    ${data.mood ? `<div class="detail-mood">${data.mood}</div>` : ""}
    <div class="detail-content">${MarkdownLite.render(data.content || "")}</div>
    ${images.length ? `<div class="detail-images">${images.map((m) => `<img src="${m.url}">`).join("")}</div>` : ""}
    ${(audios.length || videos.length) ? `<div class="detail-media">
        ${audios.map((m) => `<audio controls src="${m.url}"></audio>`).join("")}
        ${videos.map((m) => `<video controls src="${m.url}"></video>`).join("")}
      </div>` : ""}
    ${loc ? `<div class="detail-location"><a href="https://www.google.com/maps?q=${loc.lat},${loc.lng}" target="_blank" rel="noopener">📍 ดูตำแหน่งใน Google Maps</a></div>` : ""}
    ${(data.tags && data.tags.length) ? `<div class="detail-tags">${data.tags.map((t) => `<span class="entry-tag">${escapeHTML(t)}</span>`).join("")}</div>` : ""}
  `;
  showView("entry");
}

$("entryDetail").addEventListener("change", async (e) => {
  const cb = e.target.closest('input[type="checkbox"][data-line]');
  if (!cb) return;
  const rec = state.entries.find((x) => x.id === state.viewId);
  if (!rec || !state.viewDecrypted) return;
  const lineIndex = Number(cb.dataset.line);
  const newContent = MarkdownLite.toggleCheckboxLine(state.viewDecrypted.content || "", lineIndex);
  state.viewDecrypted.content = newContent;

  if (rec.private) {
    const enc = await DiaryCrypto.encryptJSON(state.viewDecrypted);
    rec.encIv = enc.iv;
    rec.encData = enc.data;
  } else {
    rec.content = newContent;
  }
  rec.updatedAt = new Date().toISOString();
  await DiaryDB.put(rec);
  const idx = state.entries.findIndex((x) => x.id === rec.id);
  if (idx >= 0) state.entries[idx] = rec;
  cb.closest(".md-check").classList.toggle("checked", cb.checked);
});

$("backFromEntryBtn").addEventListener("click", () => showView("home"));
$("editEntryBtn").addEventListener("click", () => openWriteForEdit(state.viewId));

$("deleteEntryBtn").addEventListener("click", async () => {
  if (!state.viewId) return;
  if (!confirm("ย้ายบันทึกนี้ไปถังขยะหรือไม่? (ลบถาวรอัตโนมัติใน 30 วัน)")) return;
  const rec = state.entries.find((e) => e.id === state.viewId);
  if (!rec) return;
  rec.deletedAt = new Date().toISOString();
  await DiaryDB.put(rec);
  renderHome();
  showToast("ย้ายไปถังขยะแล้ว");
  showView("home");
});

$("exportEntryBtn").addEventListener("click", () => {
  const rec = state.entries.find((e) => e.id === state.viewId);
  if (!rec) return;
  downloadJSON(rec, `diary-entry-${rec.date}-${rec.id}.json`);
});

/* ---------------- trash ---------------- */

function renderTrash() {
  const trashed = state.entries.filter((e) => e.deletedAt).sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  const list = $("trashList");
  list.innerHTML = "";
  $("trashEmptyState").hidden = trashed.length > 0;
  trashed.forEach((e) => {
    const item = document.createElement("div");
    item.className = "trash-item";
    const label = e.private ? "🔒 บันทึกส่วนตัว" : escapeHTML(e.title || "(ไม่มีชื่อเรื่อง)");
    const daysLeft = TRASH_RETENTION_DAYS - Math.floor((Date.now() - new Date(e.deletedAt).getTime()) / 86400000);
    item.innerHTML = `
      <div class="trash-item-info">
        <div>${label}</div>
        <div class="trash-item-sub">${formatDateHeading(e.date)} · ลบถาวรใน ${Math.max(daysLeft, 0)} วัน</div>
      </div>
      <div class="trash-actions">
        <button class="text-btn" data-action="restore" data-id="${e.id}">กู้คืน</button>
        <button class="text-btn danger" data-action="purge" data-id="${e.id}">ลบถาวร</button>
      </div>`;
    list.appendChild(item);
  });
}

$("trashList").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.action === "restore") {
    const rec = state.entries.find((x) => x.id === id);
    if (!rec) return;
    rec.deletedAt = null;
    await DiaryDB.put(rec);
    renderTrash();
    renderHome();
    showToast("กู้คืนแล้ว");
  } else if (btn.dataset.action === "purge") {
    if (!confirm("ลบถาวรจริงหรือไม่? กู้คืนไม่ได้อีก")) return;
    await DiaryDB.remove(id);
    state.entries = state.entries.filter((x) => x.id !== id);
    renderTrash();
    renderHome();
    showToast("ลบถาวรแล้ว");
  }
});

$("openTrashBtn").addEventListener("click", () => { renderTrash(); showView("trash"); });
$("backFromTrashBtn").addEventListener("click", () => showView("settings"));

async function purgeOldTrash() {
  const cutoff = Date.now() - TRASH_RETENTION_DAYS * 86400000;
  const toPurge = state.entries.filter((e) => e.deletedAt && new Date(e.deletedAt).getTime() < cutoff);
  for (const e of toPurge) await DiaryDB.remove(e.id);
  if (toPurge.length) state.entries = state.entries.filter((e) => !toPurge.includes(e));
}

/* ---------------- backup / restore ---------------- */

function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

$("backupBtn").addEventListener("click", async () => {
  showToast("กำลังเตรียมไฟล์สำรอง...");
  const hasPw = DiaryCrypto.hasPassword();
  const entries = [];
  for (const e of state.entries) {
    const copy = { ...e };
    if (!e.private && e.attachmentRefs && e.attachmentRefs.length) {
      const atts = [];
      for (const ref of e.attachmentRefs) {
        const att = await DiaryDB.getAttachment(ref.id);
        if (att && att.blob) atts.push({ id: att.id, type: att.type, mimeType: att.mimeType, dataURL: await blobToDataURL(att.blob) });
      }
      copy.attachmentBlobs = atts;
    }
    entries.push(copy);
  }
  const backup = {
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: hasPw ? {
      salt: localStorage.getItem("diary_pw_salt"),
      verifierIv: localStorage.getItem("diary_pw_verifier_iv"),
      verifier: localStorage.getItem("diary_pw_verifier"),
    } : null,
    entries,
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

    for (const e of backup.entries) {
      const rec = { ...e };
      if (Array.isArray(rec.attachmentBlobs)) {
        const refs = [];
        for (const a of rec.attachmentBlobs) {
          const blob = dataURLToBlob(a.dataURL);
          await DiaryDB.putAttachment({ id: a.id, entryId: rec.id, type: a.type, blob, mimeType: a.mimeType, size: blob.size, createdAt: rec.createdAt, driveFileId: null });
          refs.push({ id: a.id, type: a.type });
        }
        rec.attachmentRefs = refs;
        delete rec.attachmentBlobs;
      }
      await DiaryDB.put(rec);
    }
    state.entries = await DiaryDB.getAll();
    renderHome();
    showToast(`กู้คืนข้อมูลแล้ว (${backup.entries.length} รายการ)`);
  } catch (err) {
    console.error(err);
    showToast("ไฟล์ไม่ถูกต้อง กู้คืนไม่สำเร็จ");
  }
  e.target.value = "";
});

/* ---------------- calendar picker ---------------- */

function renderCalendar() {
  const { year, month } = state.cal;
  $("calTitle").textContent = `${THAI_MONTHS[month]} ${year + 543}`;

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = todayISO();

  const dayInfo = {};
  activeEntries().forEach((e) => {
    if (!dayInfo[e.date]) dayInfo[e.date] = { hasEntry: false, hasMedia: false };
    dayInfo[e.date].hasEntry = true;
    if (e.hasMedia) dayInfo[e.date].hasMedia = true;
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
    if (info && info.hasMedia) classes.push("has-image");
    const mark = info && info.hasEntry ? '<span class="cal-mark"></span>' : "";
    grid.insertAdjacentHTML("beforeend", `<button type="button" class="${classes.join(" ")}" data-date="${dateStr}">${d}${mark}</button>`);
  }
}

function openCalendar() { $("calendarModal").hidden = false; renderCalendar(); }
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
    openWriteForNew();
    setEntryDate(dateStr);
  }
});

/* ---------------- nav ---------------- */

document.querySelectorAll(".nav-btn[data-nav]").forEach((btn) => {
  btn.addEventListener("click", () => showView(btn.dataset.nav));
});

/* ---------------- share target (Web Share Target API) ---------------- */

function handleShareTarget() {
  const params = new URLSearchParams(window.location.search);
  const title = params.get("title") || "";
  const text = params.get("text") || "";
  const url = params.get("url") || "";
  if (!title && !text && !url) return;

  openWriteForNew();
  $("entryTitle").value = title;
  $("entryContent").value = [text, url].filter(Boolean).join("\n");
  history.replaceState(null, "", window.location.pathname);
  showToast("นำเข้าจากการแชร์แล้ว — ตรวจสอบก่อนบันทึก");
}

/* ---------------- init ---------------- */

async function init() {
  try {
    ThemeSettings.apply();

    const today = new Date();
    $("todayPill").textContent = `${today.getDate()} ${THAI_MONTHS[today.getMonth()]} ${today.getFullYear() + 543}`;
    state.cal.year = today.getFullYear();
    state.cal.month = today.getMonth();

    await DiaryDB.migrateIfNeeded();
    state.entries = await DiaryDB.getAll();
    await purgeOldTrash();

    renderHome();
    refreshSettingsView();
    showView("home");
    handleShareTarget();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
  } catch (err) {
    console.error("Init failed:", err);
    showToast("โหลดข้อมูลไม่สำเร็จ: " + (err && err.message ? err.message : "ไม่ทราบสาเหตุ"));
  }
}

init();
