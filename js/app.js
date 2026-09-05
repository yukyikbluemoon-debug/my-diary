/* app.js — main application logic */

const $ = (id) => document.getElementById(id);
const THAI_MONTHS = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const THAI_MONTHS_FULL = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
function getTrashRetentionDays() {
  return parseInt(localStorage.getItem("diary_trash_retention_days"), 10) || 30;
}
function getDebtReminderDays() {
  const v = parseInt(localStorage.getItem("diary_debt_reminder_days"), 10);
  return Number.isFinite(v) && v >= 0 ? v : 5;
}
const VIDEO_MAX_SECONDS = 30;
const VIDEO_SIZE_WARN_BYTES = 20 * 1024 * 1024; // 20 MB — just a heads-up, recording still allowed past this
const EVENT_CATEGORY_ICONS = {
  "ซื้อของ": "🛍️", "ไปทำงาน": "💼", "เดินทาง": "✈️", "ซื้อหุ้น": "📈",
  "ได้เงิน": "💵", "จ่ายบิล": "🧾", "ซ่อมของ": "🔧", "ซื้อของมือสอง": "♻️", "อื่นๆ": "📌",
};
const APP_VERSION = "3.20.1";
const APP_BUILD_DATE = "2026-09-05";

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
  entryColor: "none",
  entryType: "diary",      // "diary" | "event"
  filterEntryType: "",     // "" | "diary" | "event" — Diary tab list filter
  unlockResolve: null,
  dayFilter: null,
  cal: { year: 0, month: 0 },
  calPage: { year: 0, month: 0 },
  calPickCallback: null,
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
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function nowHM() {
  return new Date().toTimeString().slice(0, 5);
}
function pad2(n) { return String(n).padStart(2, "0"); }
function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Shrinks every .stats-num currently in the DOM to whatever font-size
 *  actually fits its card, instead of letting a long formatted amount
 *  (e.g. ฿108,327.58) wrap mid-number or get cut off with "...". Called
 *  after every render that touches these cards (Finance/Assets/Banking)
 *  and on resize/orientation change, since what fits depends on the
 *  viewport width and how many cards are in the row. */
function fitStatsNums() {
  document.querySelectorAll(".stats-num").forEach((el) => {
    let size = 18;
    el.style.fontSize = size + "px";
    while (el.scrollWidth > el.clientWidth && size > 10) {
      size -= 1;
      el.style.fontSize = size + "px";
    }
  });
}
let fitStatsNumsTimer = null;
function scheduleFitStatsNums() {
  clearTimeout(fitStatsNumsTimer);
  fitStatsNumsTimer = setTimeout(fitStatsNums, 30);
}
window.addEventListener("resize", scheduleFitStatsNums);
// Finance/Assets/Banking.render() are async and called from several places
// without always being awaited — rather than chase every call site, just
// watch for the .stats-num text actually changing and re-fit right after,
// regardless of what triggered the update or its timing.
new MutationObserver(scheduleFitStatsNums).observe(document.body, { childList: true, subtree: true, characterData: true });

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

let suppressPopstateCount = 0;

function pushNavState(label) {
  history.pushState({ navLabel: label }, "");
}
function popNavState() {
  // Called after a button/action already performed the visual "close"
  // itself. We still owe the browser one history.back() to consume the
  // matching pushState — but that will fire another popstate event, and
  // we must NOT let that re-trigger closeCurrentLayer() (it would close
  // a second, unrelated layer on top of the one we just closed). Suppress
  // exactly that one resulting popstate. A counter (not a flag) because
  // some actions call this twice in a row (e.g. saving an entry that was
  // opened for editing consumes both the "write" and "entry" states).
  suppressPopstateCount++;
  history.back();
}

function closeCurrentLayer() {
  if (!$("lightbox").hidden) { closeLightboxVisual(); return; }
  if (!$("sketchModal").hidden) { closeSketchModalVisual(); return; }
  if (!$("calendarModal").hidden) { closeCalendarVisual(); return; }
  if (!$("setPwModal").hidden) { closeSetPwModalVisual(); return; }
  if (!$("unlockModal").hidden) { closeUnlockModalVisual(false); return; }
  if (!$("txModal").hidden && typeof Finance !== "undefined") { Finance.closeTxModalVisual(); return; }
  if (!$("walletPickerModal").hidden && typeof Finance !== "undefined") { Finance.closeWalletPickerModalVisual(); return; }
  if (!$("statementModal").hidden && typeof Statement !== "undefined") { Statement.closeStatementModalVisual(); return; }
  if (!$("netTrendModal").hidden && typeof NetTrend !== "undefined") { NetTrend.closeModalVisual(); return; }
  if (!$("finMetaModal").hidden && typeof Finance !== "undefined") { Finance.closeFinMetaModalVisual(); return; }
  if (!$("eventCatMetaModal").hidden) { closeEventCatMetaModalVisual(); return; }
  if (!$("assetModal").hidden && typeof Assets !== "undefined") { Assets.closeAssetModalVisual(); return; }
  if (!$("assetQuickUpdateModal").hidden && typeof Assets !== "undefined") { Assets.closeQuickUpdateVisual(); return; }
  if (!$("bankModal").hidden && typeof Banking !== "undefined") { Banking.closeBankModalVisual(); return; }
  if (!$("debtModal").hidden && typeof Banking !== "undefined") { Banking.closeDebtModalVisual(); return; }
  if (!$("otherModal").hidden && typeof Banking !== "undefined") { Banking.closeOtherModalVisual(); return; }
  if (state.view === "trash") { showView("settings"); return; }
  if (state.view === "timeline") { showView("home"); return; }
  if (state.view === "stats") { showView(state.statsReturnView || "dashboard"); return; }
  if (state.view === "write") { clearRecordingUI(); showView(state.editId ? "entry" : "home"); return; }
  if (state.view === "entry") { showView("home"); return; }
}

window.addEventListener("popstate", () => {
  if (suppressPopstateCount > 0) { suppressPopstateCount--; return; }
  closeCurrentLayer();
});

/* ---------------- view routing ---------------- */

function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === name));
  document.querySelectorAll(".nav-btn[data-nav]").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
  $("newEntryBtn").hidden = name !== "home";
  $("newTxBtn").hidden = name !== "finance";
  state.view = name;
  window.scrollTo(0, 0);
}

/* ---------------- lightbox ---------------- */

function openLightbox(src) {
  $("lightboxImg").src = src;
  $("lightbox").hidden = false;
  pushNavState("lightbox");
}
function closeLightboxVisual() {
  $("lightbox").hidden = true;
  $("lightboxImg").src = "";
}
function closeLightbox() { closeLightboxVisual(); popNavState(); }
$("lightboxCloseBtn").addEventListener("click", closeLightbox);
$("lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox") closeLightbox(); });
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
    const typeLabel = a.type === "image" ? "รูป" : a.type === "audio" ? "เสียง" : a.type === "video" ? "วิดีโอ" : "ภาพวาด";
    const sizeLabel = a.blob ? formatBytes(a.blob.size) : "";
    label.textContent = sizeLabel ? `${typeLabel} · ${sizeLabel}` : typeLabel;
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
    if (type === "video" && blob.size > VIDEO_SIZE_WARN_BYTES) {
      showToast(`⚠️ วิดีโอนี้ขนาด ${formatBytes(blob.size)} — ใหญ่พอสมควร อาจกินพื้นที่และเวลาซิงค์นาน`);
    }
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
let sketchEraserMode = false;
let sketchUndoStack = [];
const SKETCH_UNDO_MAX = 20;
const SKETCH_PEN_WIDTH = 4;
const SKETCH_ERASER_WIDTH = 18;

function initSketchCanvas() {
  const canvas = $("sketchCanvas");
  sketchCtx = canvas.getContext("2d");
  sketchCtx.fillStyle = "#ffffff";
  sketchCtx.fillRect(0, 0, canvas.width, canvas.height);
  sketchCtx.lineWidth = SKETCH_PEN_WIDTH;
  sketchCtx.lineCap = "round";
  sketchCtx.lineJoin = "round";
  sketchEraserMode = false;
  sketchUndoStack = [];
  $("sketchEraserBtn").classList.remove("active-tool");
}

function sketchPos(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
  const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
  return { x: cx * (canvas.width / rect.width), y: cy * (canvas.height / rect.height) };
}

function pushSketchUndo() {
  const canvas = $("sketchCanvas");
  sketchUndoStack.push(canvas.toDataURL());
  if (sketchUndoStack.length > SKETCH_UNDO_MAX) sketchUndoStack.shift();
}

$("sketchOpenBtn").addEventListener("click", () => {
  $("sketchModal").hidden = false;
  pushNavState("sketch");
  initSketchCanvas();
});
function closeSketchModalVisual() { $("sketchModal").hidden = true; }
function closeSketchModal() { closeSketchModalVisual(); popNavState(); }
$("sketchCancelBtn").addEventListener("click", closeSketchModal);
$("sketchClearBtn").addEventListener("click", () => {
  pushSketchUndo();
  const canvas = $("sketchCanvas");
  sketchCtx.fillStyle = "#ffffff";
  sketchCtx.fillRect(0, 0, canvas.width, canvas.height);
});
$("sketchUndoBtn").addEventListener("click", () => {
  if (sketchUndoStack.length === 0) { showToast("ย้อนกลับไม่ได้แล้ว"); return; }
  const canvas = $("sketchCanvas");
  const dataUrl = sketchUndoStack.pop();
  const img = new Image();
  img.onload = () => {
    sketchCtx.clearRect(0, 0, canvas.width, canvas.height);
    sketchCtx.drawImage(img, 0, 0);
  };
  img.src = dataUrl;
});
$("sketchEraserBtn").addEventListener("click", () => {
  sketchEraserMode = !sketchEraserMode;
  $("sketchEraserBtn").classList.toggle("active-tool", sketchEraserMode);
});
$("sketchColors").addEventListener("click", (e) => {
  const btn = e.target.closest(".sketch-color");
  if (!btn) return;
  sketchColor = btn.dataset.color;
  sketchEraserMode = false;
  $("sketchEraserBtn").classList.remove("active-tool");
  document.querySelectorAll(".sketch-color").forEach((b) => b.classList.toggle("selected", b === btn));
});
$("sketchSaveBtn").addEventListener("click", () => {
  $("sketchCanvas").toBlob((blob) => {
    if (blob) addPendingAttachment("sketch", blob);
    closeSketchModal();
  }, "image/png");
});

(function wireSketchCanvasEvents() {
  const canvas = $("sketchCanvas");
  const start = (e) => {
    sketchDrawing = true;
    pushSketchUndo();
    const p = sketchPos(e, canvas);
    sketchCtx.strokeStyle = sketchEraserMode ? "#ffffff" : sketchColor;
    sketchCtx.lineWidth = sketchEraserMode ? SKETCH_ERASER_WIDTH : SKETCH_PEN_WIDTH;
    sketchCtx.beginPath();
    sketchCtx.moveTo(p.x, p.y);
    e.preventDefault();
  };
  const move = (e) => { if (!sketchDrawing) return; const p = sketchPos(e, canvas); sketchCtx.lineTo(p.x, p.y); sketchCtx.stroke(); e.preventDefault(); };
  const end = () => { sketchDrawing = false; };
  canvas.addEventListener("pointerdown", start);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointerleave", end);
})();

/* ---------------- entry type (diary / event) ---------------- */

function populateEventLinkTxSelect(dateStr, selectedTxId) {
  const sel = $("eventLinkTx");
  const txs = (typeof Finance !== "undefined") ? Finance.getTransactionsForDate(dateStr) : [];
  sel.innerHTML = '<option value="">ไม่ผูกกับรายการเงิน</option><option value="__new__">➕ สร้างรายการเงินใหม่...</option>' +
    txs.map((t) => `<option value="${t.id}">${escapeHTML(t.title)} (${Finance.formatMoney(t.type === "expense" ? -t.amount : t.amount)})</option>`).join("");
  sel.value = selectedTxId && txs.some((t) => t.id === selectedTxId) ? selectedTxId : "";
  const baseHint = "การผูกเป็นแค่การอ้างอิงเฉยๆ ไม่ได้หักหรือเปลี่ยนยอดเงินในกระเป๋าใดๆ ทั้งสิ้น";
  $("eventLinkTxHint").textContent = txs.length === 0 ? `ยังไม่มีรายการเงินในวันที่นี้ — เลือก "สร้างรายการเงินใหม่" ได้เลย · ${baseHint}` : baseHint;
}

$("eventLinkTx").addEventListener("change", () => {
  if ($("eventLinkTx").value !== "__new__") return;
  $("eventLinkTx").value = ""; // reset optimistically; set to the real id once creation succeeds
  if (typeof Finance === "undefined") return;
  Finance.openNewTx(
    { date: $("entryDate").value || todayISO(), title: $("entryTitle").value || $("eventCategory").value, type: "expense" },
    (newTxId) => populateEventLinkTxSelect($("entryDate").value, newTxId)
  );
});

function setEntryType(type) {
  state.entryType = type;
  document.querySelectorAll(".entry-type-btn").forEach((b) => b.classList.toggle("selected", b.dataset.type === type));
  $("eventCategoryField").hidden = type !== "event";
  $("eventLinkTxField").hidden = type !== "event";
  if (type === "event") populateEventLinkTxSelect($("entryDate").value || todayISO(), "");
}
$("entryTypePicker").addEventListener("click", (e) => {
  const btn = e.target.closest(".entry-type-btn");
  if (!btn) return;
  setEntryType(btn.dataset.type);
});

$("entryTypeFilter").addEventListener("click", (e) => {
  const btn = e.target.closest(".entry-type-filter-btn");
  if (!btn) return;
  state.filterEntryType = btn.dataset.filtertype;
  document.querySelectorAll(".entry-type-filter-btn").forEach((b) => b.classList.toggle("selected", b === btn));
  renderHome();
});

/* ---------------- event categories (customizable) ---------------- */

const DEFAULT_EVENT_CATEGORIES = Object.keys(EVENT_CATEGORY_ICONS);

function getEventCategories() {
  try { return JSON.parse(localStorage.getItem("diary_event_categories")) || DEFAULT_EVENT_CATEGORIES.slice(); }
  catch (e) { return DEFAULT_EVENT_CATEGORIES.slice(); }
}
function saveEventCategories(list) { localStorage.setItem("diary_event_categories", JSON.stringify(list)); }
function addEventCategory(name) {
  const list = getEventCategories();
  if (!name || list.includes(name)) return;
  list.push(name);
  saveEventCategories(list);
}
function removeEventCategory(name) {
  saveEventCategories(getEventCategories().filter((c) => c !== name));
}

function populateEventCategorySelect(selected) {
  const sel = $("eventCategory");
  const cats = getEventCategories();
  sel.innerHTML = cats.map((c) => `<option value="${escapeHTML(c)}">${EVENT_CATEGORY_ICONS[c] || "📌"} ${escapeHTML(c)}</option>`).join("");
  if (selected && cats.includes(selected)) sel.value = selected;
}

function renderEventCatMetaList() {
  $("eventCatMetaList").innerHTML = getEventCategories().map((c) =>
    `<span class="fin-meta-chip">${EVENT_CATEGORY_ICONS[c] || "📌"} ${escapeHTML(c)}<button type="button" data-name="${escapeHTML(c)}">×</button></span>`
  ).join("");
}
function closeEventCatMetaModalVisual() { $("eventCatMetaModal").hidden = true; }
function closeEventCatMetaModal() {
  closeEventCatMetaModalVisual();
  popNavState();
  populateEventCategorySelect($("eventCategory").value);
}
$("manageEventCatBtn").addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  renderEventCatMetaList();
  $("eventCatMetaModal").hidden = false;
  pushNavState("eventcatmeta");
});
$("eventCatMetaCloseBtn").addEventListener("click", closeEventCatMetaModal);
$("addEventCatBtn").addEventListener("click", () => {
  const input = $("newEventCatInput");
  addEventCategory(input.value.trim());
  input.value = "";
  renderEventCatMetaList();
});
$("eventCatMetaList").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-name]");
  if (!btn) return;
  removeEventCategory(btn.dataset.name);
  renderEventCatMetaList();
});

/* ---------------- color picker ---------------- */

$("colorPicker").addEventListener("click", (e) => {
  const btn = e.target.closest(".color-swatch");
  if (!btn) return;
  state.entryColor = btn.dataset.color;
  document.querySelectorAll(".color-swatch").forEach((b) => b.classList.toggle("selected", b === btn));
  saveDraftNow();
});

/* ---------------- location ---------------- */

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
    if (!res.ok) return null;
    const data = await res.json();
    const a = data.address || {};
    // At zoom=18 (building level), prefer a named venue (shop/amenity/building
    // tag in OpenStreetMap) or house number + road when available — falls
    // back to the coarser suburb/district chain when the exact building
    // isn't individually tagged, which is common for small Thai businesses.
    const venue = a.shop || a.amenity || a.tourism || a.office || a.building || null;
    const streetAddress = a.house_number && a.road ? `${a.house_number} ${a.road}` : (a.road || null);
    const place = venue || streetAddress || a.suburb || a.neighbourhood || a.village || a.town || a.city_district || a.city || a.county || null;
    const region = a.city || a.state || a.province || null;
    const parts = [place, region && region !== place ? region : null].filter(Boolean);
    return parts.length ? parts.join(", ") : (data.display_name || null);
  } catch (e) {
    return null; // best-effort only — coordinates still work fine without a name
  }
}

/* ---------------- weather (Open-Meteo, no API key needed) ---------------- */

const WEATHER_CODE_MAP = {
  0: "☀️ ท้องฟ้าแจ่มใส", 1: "🌤️ แจ่มใสเป็นส่วนใหญ่", 2: "⛅ มีเมฆบางส่วน", 3: "☁️ มีเมฆมาก",
  45: "🌫️ หมอก", 48: "🌫️ หมอกน้ำแข็ง",
  51: "🌦️ ฝนตกปรอยเบา", 53: "🌦️ ฝนตกปรอย", 55: "🌧️ ฝนตกปรอยหนัก",
  56: "🌧️ ฝนตกปรอยเย็นจัด", 57: "🌧️ ฝนตกปรอยเย็นจัดหนัก",
  61: "🌦️ ฝนตกเบา", 63: "🌧️ ฝนตก", 65: "🌧️ ฝนตกหนัก",
  66: "🌧️ ฝนเย็นจัดเบา", 67: "🌧️ ฝนเย็นจัดหนัก",
  71: "🌨️ หิมะตกเบา", 73: "🌨️ หิมะตก", 75: "❄️ หิมะตกหนัก", 77: "❄️ เกล็ดหิมะ",
  80: "🌦️ ฝนตกเป็นช่วง ๆ เบา", 81: "🌧️ ฝนตกเป็นช่วง ๆ", 82: "⛈️ ฝนตกเป็นช่วง ๆ หนัก",
  85: "🌨️ หิมะตกเป็นช่วง ๆ เบา", 86: "🌨️ หิมะตกเป็นช่วง ๆ หนัก",
  95: "⛈️ พายุฝนฟ้าคะนอง", 96: "⛈️ พายุฝนฟ้าคะนองมีลูกเห็บเบา", 99: "⛈️ พายุฝนฟ้าคะนองมีลูกเห็บหนัก",
};

async function fetchWeather(lat, lng) {
  try {
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,relative_humidity_2m,weather_code&timezone=auto`);
    if (!res.ok) return null;
    const data = await res.json();
    const c = data.current;
    if (!c || typeof c.temperature_2m !== "number") return null;
    return {
      temp: Math.round(c.temperature_2m),
      humidity: typeof c.relative_humidity_2m === "number" ? Math.round(c.relative_humidity_2m) : null,
      code: c.weather_code,
      description: WEATHER_CODE_MAP[c.weather_code] || "",
    };
  } catch (e) {
    return null; // best-effort only — entry still saves fine without weather
  }
}

function formatWeatherText(w) {
  if (!w) return "";
  const parts = [`${w.temp}°C`];
  if (w.description) parts.push(w.description.replace(/^\S+\s/, "")); // drop the leading emoji for inline text, keep it in the icon-only spot
  if (w.humidity !== null) parts.push(`ความชื้น ${w.humidity}%`);
  return parts.join(" · ");
}

$("entryLocationToggle").addEventListener("change", (e) => {
  if (!e.target.checked) { state.entryLocation = null; $("locationSubText").textContent = "ไม่บังคับ — ใช้ตำแหน่งคร่าวๆ จาก GPS"; return; }
  if (!navigator.geolocation) {
    e.target.checked = false;
    showToast("อุปกรณ์นี้ไม่รองรับ GPS");
    return;
  }
  $("locationSubText").textContent = "กำลังขอตำแหน่ง...";
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const lat = pos.coords.latitude, lng = pos.coords.longitude;
      state.entryLocation = { lat, lng, placeName: null, weather: null };
      $("locationSubText").textContent = "กำลังค้นหาชื่อสถานที่และสภาพอากาศ...";
      const [placeName, weather] = await Promise.all([reverseGeocode(lat, lng), fetchWeather(lat, lng)]);
      if (state.entryLocation) { // still toggled on
        state.entryLocation.placeName = placeName;
        state.entryLocation.weather = weather;
        const placeText = placeName || `ตำแหน่ง: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        $("locationSubText").innerHTML = `📍 ${escapeHTML(placeText)}` + (weather ? `<br>${escapeHTML(formatWeatherText(weather))}` : "");
      }
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
$("mdQuoteBtn").addEventListener("click", () => MarkdownLite.insertLinePrefix($("entryContent"), "> "));
$("mdCodeBtn").addEventListener("click", () => MarkdownLite.insertCodeFence($("entryContent")));

/* ---------------- emoji picker ---------------- */

const EMOJI_LIST = [
  "😀","😄","😁","😆","😊","🙂","😉","😍","🥰","😘","😋","😎","🤩","🥳","😇",
  "🙃","😅","😂","🤣","😐","😑","😶","🙄","😏","😴","🥱","😪","😢","😭","😤",
  "😠","😡","🤯","😱","😨","😰","😥","😓","🤔","🤨","😬","🥺","😷","🤒","🤕",
  "🥵","🥶","😵","🤗","🤝","👍","👎","👏","🙏","💪","✌️","🤞","👋","🫶","❤️",
  "🧡","💛","💚","💙","💜","🖤","🤍","💔","✨","🔥","🎉","🎊","🎁","🌟","⭐",
  "☀️","🌤️","☁️","🌧️","⛈️","❄️","🌈","🌙","🌸","🌺","🍀","🌳","☕","🍵","🍕",
  "🍔","🍜","🍰","🍺","🍷","⚽","🏃","🎵","📚","✍️","💻","📱","🚗","✈️","🏠",
  "💰","😴","🛌","💊","🏥","🎂","🎈","💯","✅","❌","⚠️","💡","📌","🕐","📍",
];

function toggleEmojiPanel() {
  const panel = $("emojiPanel");
  if (!panel.hidden) { panel.hidden = true; return; }
  panel.innerHTML = EMOJI_LIST.map((em) => `<button type="button">${em}</button>`).join("");
  panel.hidden = false;
}
$("mdEmojiBtn").addEventListener("click", toggleEmojiPanel);
$("emojiPanel").addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  MarkdownLite.insertAround($("entryContent"), btn.textContent, "", "");
});

/* ---------------- unlock modal ---------------- */

function openUnlockModal(sub) {
  return new Promise((resolve) => {
    state.unlockResolve = resolve;
    $("unlockSub").textContent = sub || "เพื่อดูบันทึกส่วนตัว";
    $("unlockPassInput").value = "";
    $("unlockError").hidden = true;
    const hint = localStorage.getItem("diary_pw_hint");
    if (hint) { $("unlockHintText").textContent = `💡 คำใบ้: ${hint}`; $("unlockHintText").hidden = false; }
    else { $("unlockHintText").hidden = true; }
    $("unlockModal").hidden = false;
    pushNavState("unlock");
    setTimeout(() => $("unlockPassInput").focus(), 50);
  });
}
function closeUnlockModalVisual(result) {
  $("unlockModal").hidden = true;
  if (state.unlockResolve) { state.unlockResolve(result); state.unlockResolve = null; }
}
function closeUnlockModal(result) { closeUnlockModalVisual(result); popNavState(); }
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
  $("setPwHintInput").value = localStorage.getItem("diary_pw_hint") || "";
  $("setPwError").hidden = true;
  $("setPwModal").hidden = false;
  pushNavState("setpw");
}
function closeSetPwModalVisual() { $("setPwModal").hidden = true; }
function closeSetPwModal() { closeSetPwModalVisual(); popNavState(); }

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

  function saveHint() {
    const hint = $("setPwHintInput").value.trim();
    if (hint) localStorage.setItem("diary_pw_hint", hint);
    else localStorage.removeItem("diary_pw_hint");
  }

  if (setPwMode === "create") {
    await DiaryCrypto.setupPassword(newPass);
    saveHint();
    closeSetPwModal();
    refreshSettingsView();
    showToast("ตั้งรหัสผ่านแล้ว");
    return;
  }

  if (setPwMode === "reset") {
    await DiaryCrypto.setupPassword(newPass);
    saveHint();
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
  saveHint();
  refreshSettingsView();
  showToast("เปลี่ยนรหัสผ่านแล้ว");
});

$("lockNowBtn").addEventListener("click", () => {
  DiaryCrypto.lock();
  showToast("ล็อกเซสชันแล้ว");
});

/* ---------------- auto-lock on inactivity ---------------- */

let autoLockTimer = null;
function getAutoLockMinutes() {
  return parseInt(localStorage.getItem("diary_autolock_minutes"), 10) || 0;
}
function resetAutoLockTimer() {
  clearTimeout(autoLockTimer);
  const minutes = getAutoLockMinutes();
  if (minutes <= 0) return;
  autoLockTimer = setTimeout(() => {
    if (DiaryCrypto.isUnlocked()) {
      DiaryCrypto.lock();
      showToast("ล็อกเซสชันอัตโนมัติแล้ว (ไม่ได้ใช้งานเกินเวลาที่ตั้งไว้)");
    }
  }, minutes * 60000);
}
["click", "touchstart", "keydown", "input"].forEach((evt) => {
  document.addEventListener(evt, resetAutoLockTimer, { passive: true });
});
$("autoLockSelect").addEventListener("change", (e) => {
  localStorage.setItem("diary_autolock_minutes", e.target.value);
  resetAutoLockTimer();
});

$("driveSyncBtn").addEventListener("click", async () => {
  if (typeof DriveSync === "undefined") { showToast("โหลดฟีเจอร์ซิงค์ไม่สำเร็จ"); return; }
  $("driveSyncBtn").disabled = true;
  $("driveSyncStatus").textContent = "กำลังซิงค์...";
  try {
    const count = await DriveSync.sync();
    state.entries = await DiaryDB.getAll();
    renderHome();
    if (typeof Banking !== "undefined") Banking.render();
    if (typeof Finance !== "undefined") Finance.render();
    if (typeof Assets !== "undefined") Assets.render();
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

/* ---------------- Telegram settings ---------------- */

function refreshExchangeRateDisplay() {
  if (typeof ExchangeRate === "undefined") return;
  const rate = ExchangeRate.getRate();
  $("exchangeRateText").textContent = rate ? `1 USD = ${rate.toFixed(2)} บาท` : "ยังไม่มีข้อมูล";
  const updated = ExchangeRate.getUpdatedAt();
  $("exchangeRateUpdatedText").textContent = updated ? new Date(updated).toLocaleString("th-TH") : "-";
}
$("refreshExchangeRateBtn").addEventListener("click", async () => {
  $("refreshExchangeRateBtn").disabled = true;
  try {
    await ExchangeRate.fetchLatest();
    refreshExchangeRateDisplay();
    showToast("อัปเดตอัตราแลกเปลี่ยนแล้ว");
  } catch (err) {
    showToast("ดึงอัตราแลกเปลี่ยนไม่สำเร็จ: " + (err && err.message ? err.message : ""));
  } finally {
    $("refreshExchangeRateBtn").disabled = false;
  }
});

async function refreshStorageInfo() {
  if (!navigator.storage || !navigator.storage.estimate) {
    $("storageUsageText").textContent = "เบราว์เซอร์นี้ไม่รองรับ";
    $("storagePersistText").textContent = "-";
    return;
  }
  try {
    const est = await navigator.storage.estimate();
    const usage = est.usage || 0;
    const quota = est.quota || 0;
    $("storageUsageText").textContent = quota ? `${formatBytes(usage)} จาก ${formatBytes(quota)}` : formatBytes(usage);
  } catch (e) {
    $("storageUsageText").textContent = "ไม่สามารถคำนวณได้";
  }
  if (navigator.storage.persisted) {
    try {
      const persisted = await navigator.storage.persisted();
      $("storagePersistText").textContent = persisted ? "เปิดใช้งานแล้ว ✅" : "ยังไม่เปิด";
    } catch (e) {
      $("storagePersistText").textContent = "-";
    }
  } else {
    $("storagePersistText").textContent = "เบราว์เซอร์นี้ไม่รองรับ";
  }
}

function checkSyncReminder() {
  if (activeEntries().length === 0) return; // nothing to lose yet, don't nag
  const warnedDate = localStorage.getItem("diary_sync_warned_date");
  if (warnedDate === todayISO()) return;
  const lastSynced = localStorage.getItem("diary_last_synced");
  const daysSince = lastSynced ? (Date.now() - new Date(lastSynced).getTime()) / 86400000 : Infinity;
  if (daysSince < 7) return;
  localStorage.setItem("diary_sync_warned_date", todayISO());
  showToast("⚠️ ไม่ได้ซิงค์ Google Drive มาเกิน 7 วันแล้ว ลองกดซิงค์เพื่อสำรองข้อมูลล่าสุด");
}

function refreshTelegramStatus() {
  if (typeof TelegramNotify === "undefined") return;
  const cfg = TelegramNotify.getConfig();
  $("telegramTokenInput").value = cfg.token;
  $("telegramChatIdInput").value = cfg.chatId;
  $("telegramStatusText").textContent = TelegramNotify.isConfigured() ? "ตั้งค่าแล้ว" : "ยังไม่ได้ตั้งค่า";
  $("telegramSendFinanceToggle").checked = TelegramNotify.isFinanceForwardingEnabled();
}
$("telegramSendFinanceToggle").addEventListener("change", (e) => {
  TelegramNotify.setFinanceForwardingEnabled(e.target.checked);
});
$("telegramSaveBtn").addEventListener("click", () => {
  const token = $("telegramTokenInput").value.trim();
  const chatId = $("telegramChatIdInput").value.trim();
  if (!token || !chatId) { showToast("กรุณาใส่ทั้ง Bot Token และ Chat ID"); return; }
  TelegramNotify.setConfig(token, chatId);
  refreshTelegramStatus();
  showToast("บันทึกการตั้งค่า Telegram แล้ว");
});
$("telegramTestBtn").addEventListener("click", async () => {
  if (!TelegramNotify.isConfigured()) { showToast("กรุณาบันทึกการตั้งค่าก่อน"); return; }
  $("telegramTestBtn").disabled = true;
  try {
    await TelegramNotify.sendTestMessage();
    showToast("ส่งข้อความทดสอบสำเร็จ — เช็คที่กลุ่ม Telegram");
  } catch (err) {
    showToast("ส่งไม่สำเร็จ: " + (err && err.message ? err.message : "ไม่ทราบสาเหตุ"));
  } finally {
    $("telegramTestBtn").disabled = false;
  }
});

$("telegramResendAllBtn").addEventListener("click", async () => {
  if (typeof TelegramNotify === "undefined" || !TelegramNotify.isConfigured()) {
    showToast("กรุณาตั้งค่า Telegram ก่อน");
    return;
  }
  const entries = activeEntries().filter((e) => !e.private).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const includeFinance = TelegramNotify.isFinanceForwardingEnabled();
  const txs = includeFinance
    ? (await DiaryDB.getAllTransactions()).filter((t) => !t.deletedAt).sort((a, b) => a.date.localeCompare(b.date))
    : [];
  const total = entries.length + txs.length;
  if (total === 0) { showToast("ไม่มีรายการให้ส่ง"); return; }
  if (!confirm(`จะส่งบันทึก ${entries.length} รายการ${includeFinance ? ` และรายการเงิน ${txs.length} รายการ` : ""} (รวม ${total} ข้อความ) เข้า Telegram ย้อนหลังทั้งหมด อาจใช้เวลาสักครู่ ต้องการดำเนินการต่อหรือไม่?`)) return;

  $("telegramResendAllBtn").disabled = true;
  let sent = 0;
  try {
    for (const e of entries) {
      showToast(`กำลังส่ง ${sent + 1}/${total}...`);
      const attachments = await loadLocalAttachmentBlobsForEntry(e);
      await TelegramNotify.sendEntry(e, e, attachments);
      sent++;
      await new Promise((r) => setTimeout(r, 700)); // stay well under Telegram's rate limit
    }
    for (const t of txs) {
      showToast(`กำลังส่ง ${sent + 1}/${total}...`);
      await TelegramNotify.sendTransaction(t);
      sent++;
      await new Promise((r) => setTimeout(r, 700));
    }
    showToast(`ส่งย้อนหลังเสร็จแล้ว (${sent} รายการ)`);
  } finally {
    $("telegramResendAllBtn").disabled = false;
  }
});

function refreshSettingsView() {
  const has = DiaryCrypto.hasPassword();
  $("trashRetentionSelect").value = String(getTrashRetentionDays());
  $("autoLockSelect").value = String(getAutoLockMinutes());
  $("debtReminderDaysInput").value = String(getDebtReminderDays());
  refreshTelegramStatus();
  refreshExchangeRateDisplay();
  refreshStorageInfo();
  $("pwStatusText").textContent = has ? "ตั้งรหัสผ่านแล้ว" : "ยังไม่ได้ตั้งรหัสผ่าน";
  $("setPasswordBtn").hidden = has;
  $("changePwRow").hidden = !has;
  $("forgotPwRow").hidden = !has;
  $("entryCountText").textContent = state.entries.filter((e) => !e.deletedAt).length;
  $("trashCountText").textContent = state.entries.filter((e) => e.deletedAt && !e.purged).length;
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
    if (state.filterEntryType && (e.entryType || "diary") !== state.filterEntryType) return false;
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
  if (tags.length === 0) { row.innerHTML = ""; row.classList.remove("has-overflow"); return; }
  const selected = $("filterTag").value;
  const allChip = `<button type="button" class="tag-chip${selected ? "" : " selected"}" data-tag="">ทั้งหมด</button>`;
  row.innerHTML = allChip + tags.map((t) => `<button type="button" class="tag-chip${t === selected ? " selected" : ""}" data-tag="${escapeHTML(t)}">${escapeHTML(t)}</button>`).join("");
  row.classList.toggle("has-overflow", row.scrollWidth > row.clientWidth + 4);
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

function updateReminderBanner() {
  const today = todayISO();
  const hasToday = activeEntries().some((e) => e.date === today);
  const dismissedFor = localStorage.getItem("diary_reminder_dismissed");
  $("reminderBanner").hidden = hasToday || dismissedFor === today;
}
$("reminderWriteBtn").addEventListener("click", openWriteForNew);
$("reminderDismissBtn").addEventListener("click", () => {
  localStorage.setItem("diary_reminder_dismissed", todayISO());
  $("reminderBanner").hidden = true;
});

async function updateDebtReminderBanner() {
  const banner = $("debtReminderBanner");
  if (!banner || typeof Banking === "undefined") return;
  const debts = await Banking.getDebtsList();
  const today = new Date();
  const todayDay = today.getDate();
  const daysInThisMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();

  const thresholdDays = getDebtReminderDays();
  const dueSoon = [];
  debts.forEach((d) => {
    const dueDayNum = parseInt(d.dueDay, 10);
    if (!dueDayNum || dueDayNum < 1 || dueDayNum > 31) return;
    let daysUntil = dueDayNum - todayDay;
    if (daysUntil < 0) daysUntil += daysInThisMonth; // due date already passed this month — wraps to next month
    if (daysUntil <= thresholdDays) dueSoon.push({ name: d.debtName || "(ไม่มีชื่อ)", daysUntil });
  });

  if (dueSoon.length === 0) { banner.hidden = true; return; }
  const dismissedFor = localStorage.getItem("diary_debt_reminder_dismissed");
  if (dismissedFor === todayISO()) { banner.hidden = true; return; }

  dueSoon.sort((a, b) => a.daysUntil - b.daysUntil);
  const soonest = dueSoon[0];
  const whenText = soonest.daysUntil === 0 ? "วันนี้" : `อีก ${soonest.daysUntil} วัน`;
  $("debtReminderText").textContent = dueSoon.length === 1
    ? `💳 ${soonest.name} ใกล้ครบกำหนดชำระ (${whenText})`
    : `💳 มีหนี้ ${dueSoon.length} รายการใกล้ครบกำหนดชำระ — เร็วสุด ${whenText}`;
  banner.hidden = false;
}
$("debtReminderViewBtn").addEventListener("click", () => {
  showView("finance");
  if (typeof Banking !== "undefined") Banking.showFinSubtab("debts");
});
$("debtReminderDismissBtn").addEventListener("click", () => {
  localStorage.setItem("diary_debt_reminder_dismissed", todayISO());
  $("debtReminderBanner").hidden = true;
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

function renderTimeline() {
  const track = $("timelineTrack");
  track.innerHTML = "";
  const entries = activeEntries().slice().sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  $("timelineEmptyState").hidden = entries.length > 0;

  let currentMonth = null;
  entries.forEach((e) => {
    const monthKey = e.date.slice(0, 7);
    if (monthKey !== currentMonth) {
      currentMonth = monthKey;
      const [y, m] = monthKey.split("-").map(Number);
      const monthLabel = document.createElement("div");
      monthLabel.className = "timeline-month-heading";
      monthLabel.textContent = `${THAI_MONTHS_FULL[m - 1]} ${y + 543}`;
      track.appendChild(monthLabel);
    }

    const node = document.createElement("div");
    node.className = "timeline-node" + (e.pinned ? " milestone" : "");
    node.dataset.id = e.id;
    const titleText = e.private ? "🔒 บันทึกส่วนตัว" : escapeHTML(e.title || "(ไม่มีชื่อเรื่อง)");
    const mood = e.private ? "" : (e.mood || "");
    const preview = e.private ? "" : escapeHTML((e.content || "").replace(/[#*_\[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 80));
    node.innerHTML = `
      <div class="timeline-dot">${e.pinned ? "⭐" : ""}</div>
      <div class="timeline-content">
        <div class="timeline-date">${formatFullThaiDate(e.date)} · ${e.time}</div>
        <div class="timeline-title">${titleText}${mood ? ` ${mood}` : ""}</div>
        ${preview ? `<div class="timeline-preview">${preview}</div>` : ""}
      </div>`;
    track.appendChild(node);
  });
}

$("timelineTrack").addEventListener("click", (e) => {
  const node = e.target.closest(".timeline-node");
  if (node) openEntry(node.dataset.id);
});
$("openTimelineBtn").addEventListener("click", () => {
  renderTimeline();
  showView("timeline");
  pushNavState("timeline");
});
$("backFromTimelineBtn").addEventListener("click", () => {
  showView("home");
  popNavState();
});

function buildEntryCard(e) {
  const card = document.createElement("div");
  card.className = "entry-card" + (e.color ? ` color-${e.color}` : "");
  card.dataset.id = e.id;
  const pinIcon = e.pinned ? '<span class="entry-pin-icon">📌</span>' : "";
  const eventBadge = e.entryType === "event" ? `<span class="entry-badge-event">${EVENT_CATEGORY_ICONS[e.eventCategory] || "📌"} ${escapeHTML(e.eventCategory || "เหตุการณ์")}</span>` : "";
  const quickDelete = `<button type="button" class="card-quick-delete" data-id="${e.id}" aria-label="ลบ">🗑️</button>`;

  if (e.private) {
    card.innerHTML = `
      <div class="entry-time">${e.time}</div>
      <div class="entry-body">
        <div class="entry-title-row">${pinIcon}<span class="entry-lock-icon">🔒</span><p class="entry-title">บันทึกส่วนตัว</p>${eventBadge}</div>
      </div>
      ${quickDelete}`;
  } else {
    const preview = (e.content || "").replace(/[#*_\[\]]/g, "").replace(/\s+/g, " ").trim();
    card.innerHTML = `
      <div class="entry-time">${e.time}</div>
      <div class="entry-body">
        <div class="entry-title-row">
          ${pinIcon}<p class="entry-title">${escapeHTML(e.title || "(ไม่มีชื่อเรื่อง)")}</p>
          <span class="entry-mood">${e.mood || ""}</span>
        </div>
        ${eventBadge ? `<div style="margin-top:4px;">${eventBadge}</div>` : ""}
        <p class="entry-preview">${escapeHTML(preview)}</p>
        ${(e.tags && e.tags.length) ? `<div class="entry-tags">${e.tags.map((t) => `<span class="entry-tag">${escapeHTML(t)}</span>`).join("")}</div>` : ""}
      </div>
      <div class="entry-thumb-slot"></div>
      ${quickDelete}`;

    if (e.attachmentRefs && e.attachmentRefs.length) {
      const imgRef = e.attachmentRefs.find((r) => r.type === "image" || r.type === "sketch");
      if (imgRef) {
        // local-only lookup — never triggers a Drive download just to render the list
        DiaryDB.getAttachment(imgRef.id).then((att) => {
          if (att && att.blob) {
            const slot = card.querySelector(".entry-thumb-slot");
            if (slot) slot.innerHTML = `<img src="${URL.createObjectURL(att.blob)}" class="entry-thumb">`;
          }
        });
      }
    }
  }
  return card;
}

function renderHome() {
  const list = getFilteredEntries().slice().sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  const container = $("entryList");
  container.innerHTML = "";
  $("emptyState").hidden = list.length > 0 || activeEntries().length > 0;

  const pinned = list.filter((e) => e.pinned);
  const rest = list.filter((e) => !e.pinned);

  const pinnedBox = $("pinnedSection");
  if (pinned.length === 0 || state.dayFilter) {
    // hide the pinned shelf while looking at a single day — it would just duplicate the day's own list
    pinnedBox.hidden = true;
  } else {
    pinnedBox.hidden = false;
    const pinnedList = $("pinnedList");
    pinnedList.innerHTML = "";
    pinned.forEach((e) => pinnedList.appendChild(buildEntryCard(e)));
  }

  let currentDate = null;
  let groupDiv = null;
  rest.forEach((e) => {
    if (e.date !== currentDate) {
      currentDate = e.date;
      groupDiv = document.createElement("div");
      groupDiv.className = "date-group";
      groupDiv.innerHTML = `<div class="date-heading">${formatDateHeading(e.date)}</div>`;
      container.appendChild(groupDiv);
    }
    groupDiv.appendChild(buildEntryCard(e));
  });

  if (activeEntries().length === 0) $("emptyState").hidden = false;
  const tags = populateTagFilter();
  populateMonthFilter();
  renderTagChips(tags);
  updateDayFilterChip();
  renderOnThisDay();
  updateReminderBanner();
  if (typeof Banking !== "undefined") updateDebtReminderBanner();
  renderTodaySummary();
  refreshSettingsView();
}

function renderTodaySummary() {
  const today = todayISO();
  const diaryCount = activeEntries().filter((e) => e.date === today).length;
  $("todayDiaryCount").textContent = `${diaryCount} รายการ`;
  if (typeof Finance !== "undefined") {
    const s = Finance.getTodaySummary();
    $("todayIncomeText").textContent = Finance.formatMoney(s.income);
    $("todayExpenseText").textContent = Finance.formatMoney(s.expense);
  }
}
$("todaySummary").addEventListener("click", () => {
  showView("finance");
  if (typeof Banking !== "undefined") Banking.render();
  if (typeof Finance !== "undefined") Finance.render();
  if (typeof Assets !== "undefined") Assets.render();
});

$("entryList").addEventListener("click", (e) => {
  const del = e.target.closest(".card-quick-delete");
  if (del) { quickTrashEntry(del.dataset.id); return; }
  const card = e.target.closest(".entry-card");
  if (card) openEntry(card.dataset.id);
});
$("pinnedList").addEventListener("click", (e) => {
  const del = e.target.closest(".card-quick-delete");
  if (del) { quickTrashEntry(del.dataset.id); return; }
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

/* ---------------- draft auto-save ---------------- */

const DRAFT_KEY = "diary_draft_v1";
let draftSaveTimer = null;

function saveDraftNow() {
  if ($("entryPrivate").checked) {
    // Never park private plaintext in localStorage — skip drafting entirely
    // while private mode is on, and drop any earlier draft for this session.
    localStorage.removeItem(DRAFT_KEY);
    return;
  }
  const title = $("entryTitle").value;
  const content = $("entryContent").value;
  const tags = $("entryTags").value;
  if (!title.trim() && !content.trim()) { localStorage.removeItem(DRAFT_KEY); return; }
  const draft = {
    entryId: $("entryId").value, // "" means "new entry"
    date: $("entryDate").value,
    time: $("entryTime").value,
    title, content, tags,
    mood: state.moodSelected,
    color: state.entryColor,
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

function scheduleDraftSave() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(saveDraftNow, 800);
}

["entryTitle", "entryContent", "entryTags"].forEach((id) => {
  $(id).addEventListener("input", scheduleDraftSave);
});

function clearDraft() {
  clearTimeout(draftSaveTimer);
  localStorage.removeItem(DRAFT_KEY);
}

function offerDraftRestore(targetEntryId) {
  let draft;
  try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch (e) { draft = null; }
  if (!draft || draft.entryId !== targetEntryId) return;
  if (!confirm("พบร่างที่ยังไม่ได้บันทึกไว้ (จากตอนที่แอปปิดกลางคัน) ต้องการกู้คืนหรือไม่?")) {
    localStorage.removeItem(DRAFT_KEY);
    return;
  }
  setEntryDate(draft.date || todayISO());
  $("entryTime").value = draft.time || nowHM();
  $("entryTitle").value = draft.title || "";
  $("entryContent").value = draft.content || "";
  $("entryTags").value = draft.tags || "";
  state.moodSelected = draft.mood || "";
  state.entryColor = draft.color || "none";
  document.querySelectorAll(".mood-btn").forEach((b) => b.classList.toggle("selected", b.dataset.mood === state.moodSelected));
  document.querySelectorAll(".color-swatch").forEach((b) => b.classList.toggle("selected", b.dataset.color === state.entryColor));
  showToast("กู้คืนร่างแล้ว");
}

function resetWriteForm() {
  $("entryId").value = "";
  setEntryType("diary");
  populateEventCategorySelect();
  setEntryDate(todayISO());
  $("entryTime").value = nowHM();
  $("entryTitle").value = "";
  $("entryContent").value = "";
  $("entryTags").value = "";
  $("entryPrivate").checked = false;
  $("entryPinnedCheckbox").checked = false;
  $("entryLocationToggle").checked = false;
  state.entryLocation = null;
  $("locationSubText").textContent = "ไม่บังคับ — ใช้ตำแหน่งคร่าวๆ จาก GPS";
  state.moodSelected = "";
  state.entryColor = "none";
  document.querySelectorAll(".color-swatch").forEach((b) => b.classList.toggle("selected", b.dataset.color === "none"));
  state.pendingAttachments = [];
  state.removedAttachmentIds = [];
  clearRecordingUI();
  renderAttachStrip();
  $("emojiPanel").hidden = true;
  document.querySelectorAll(".mood-btn").forEach((b) => b.classList.remove("selected"));
}

function openWriteForNew() {
  resetWriteForm();
  $("writeHeading").textContent = "เขียนบันทึก";
  state.editId = null;
  showView("write");
  pushNavState("write");
  offerDraftRestore("");
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
  setEntryType(rec.entryType === "event" ? "event" : "diary");
  setEntryDate(rec.date);
  $("entryTime").value = rec.time;
  $("entryTitle").value = data.title || "";
  $("entryContent").value = data.content || "";
  $("entryTags").value = (data.tags || []).join(", ");
  $("entryPrivate").checked = !!rec.private;
  $("entryPinnedCheckbox").checked = !!rec.pinned;
  if (rec.entryType === "event") {
    populateEventCategorySelect(rec.eventCategory || "อื่นๆ");
    populateEventLinkTxSelect(rec.date, rec.linkedTxId || "");
  }
  state.moodSelected = data.mood || "";
  state.entryColor = rec.color || "none";
  document.querySelectorAll(".color-swatch").forEach((b) => b.classList.toggle("selected", b.dataset.color === state.entryColor));

  const loc = rec.private ? data.location : rec.location;
  if (loc) {
    state.entryLocation = loc;
    $("entryLocationToggle").checked = true;
    const placeText = loc.placeName ? `📍 ${loc.placeName}` : `ตำแหน่ง: ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`;
    $("locationSubText").innerHTML = escapeHTML(placeText) + (loc.weather ? `<br>${escapeHTML(formatWeatherText(loc.weather))}` : "");
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
  pushNavState("write");
  offerDraftRestore(rec.id);
}

$("moodPicker").addEventListener("click", (e) => {
  const btn = e.target.closest(".mood-btn");
  if (!btn) return;
  const m = btn.dataset.mood;
  state.moodSelected = state.moodSelected === m ? "" : m;
  document.querySelectorAll(".mood-btn").forEach((b) => b.classList.toggle("selected", b.dataset.mood === state.moodSelected));
  saveDraftNow();
});

$("entryPrivate").addEventListener("change", async (e) => {
  if (e.target.checked && !DiaryCrypto.hasPassword()) {
    e.target.checked = false;
    showToast("ตั้งรหัสผ่านก่อนใช้โหมดส่วนตัว");
    openSetPwModal("create");
    return;
  }
  if (e.target.checked) clearDraft();
});

$("newEntryBtn").addEventListener("click", openWriteForNew);
$("cancelWriteBtn").addEventListener("click", () => { clearRecordingUI(); showView(state.editId ? "entry" : "home"); popNavState(); });

$("entryForm").addEventListener("submit", (e) => e.preventDefault());

$("saveEntryBtn").addEventListener("click", async () => {
  try {
    const date = $("entryDate").value;
    const time = $("entryTime").value;
    if (!date || !time) { showToast("กรุณาใส่วันที่และเวลา"); return; }

    const wasEditingFromEntry = !!state.editId;
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
      color: state.entryColor === "none" ? null : state.entryColor,
      pinned: $("entryPinnedCheckbox").checked,
      entryType: state.entryType,
      eventCategory: state.entryType === "event" ? $("eventCategory").value : null,
      linkedTxId: state.entryType === "event" ? ($("eventLinkTx").value || null) : null,
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

    if (!existing && !isPrivate && typeof TelegramNotify !== "undefined") {
      TelegramNotify.sendEntry(rec, rec, state.pendingAttachments); // fire-and-forget; never blocks the save, never sent if private
    }

    clearDraft();
    clearRecordingUI();
    renderHome();
    showToast("บันทึกแล้ว");
    showView("home");
    popNavState();
    if (wasEditingFromEntry) popNavState();
  } catch (err) {
    console.error("Save failed:", err);
    showToast("บันทึกไม่สำเร็จ: " + (err && err.message ? err.message : "ไม่ทราบสาเหตุ"));
  }
});

/* ---------------- date picker ---------------- */

$("entryDatePicker").addEventListener("click", () => {
  openCalendarForPick($("entryDate").value, (dateStr) => setEntryDate(dateStr));
});
function setEntryDate(dateStr) {
  $("entryDate").value = dateStr;
  $("entryDatePicker").textContent = formatFullThaiDate(dateStr);
  if (state.entryType === "event") populateEventLinkTxSelect(dateStr, $("eventLinkTx").value);
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
  $("shareEntryBtn").hidden = rec.private;
  $("telegramResendBtn").hidden = rec.private;
  $("pinEntryBtn").textContent = rec.pinned ? "📌 เลิกปักหมุด" : "📌 ปักหมุด";

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

  const linkedTx = (rec.entryType === "event" && rec.linkedTxId && typeof Finance !== "undefined") ? Finance.getTransactionById(rec.linkedTxId) : null;

  const detail = $("entryDetail");
  detail.innerHTML = `
    <div class="detail-datetime">${formatDateHeading(rec.date)} · ${rec.time} น.</div>
    ${rec.entryType === "event" ? `<div class="entry-badge-event" style="display:inline-block;margin-bottom:8px;">${EVENT_CATEGORY_ICONS[rec.eventCategory] || "📌"} ${escapeHTML(rec.eventCategory || "เหตุการณ์")}</div>` : ""}
    ${data.title ? `<h2 class="detail-title">${escapeHTML(data.title)}</h2>` : ""}
    ${data.mood ? `<div class="detail-mood">${data.mood}</div>` : ""}
    <div class="detail-content">${MarkdownLite.render(data.content || "")}</div>
    ${images.length ? `<div class="detail-images">${images.map((m) => `<img src="${m.url}">`).join("")}</div>` : ""}
    ${(audios.length || videos.length) ? `<div class="detail-media">
        ${audios.map((m) => `<div><audio controls src="${m.url}"></audio>${m.blob ? `<div class="attach-size-label">${formatBytes(m.blob.size)}</div>` : ""}</div>`).join("")}
        ${videos.map((m) => `<div><video controls src="${m.url}"></video>${m.blob ? `<div class="attach-size-label">${formatBytes(m.blob.size)}</div>` : ""}</div>`).join("")}
      </div>` : ""}
    ${loc ? `<div class="detail-location"><a href="https://www.google.com/maps?q=${loc.lat},${loc.lng}" target="_blank" rel="noopener">📍 ${loc.placeName ? escapeHTML(loc.placeName) : "ดูตำแหน่งใน Google Maps"}</a>${loc.weather ? `<br>${escapeHTML(formatWeatherText(loc.weather))}` : ""}</div>` : ""}
    ${linkedTx ? `<div class="detail-location" id="linkedTxLink" style="cursor:pointer;">🔗 ผูกกับรายการเงิน: ${escapeHTML(linkedTx.title)} (${Finance.formatMoney(linkedTx.type === "expense" ? -linkedTx.amount : linkedTx.amount)})</div>` : ""}
    ${(data.tags && data.tags.length) ? `<div class="detail-tags">${data.tags.map((t) => `<span class="entry-tag">${escapeHTML(t)}</span>`).join("")}</div>` : ""}
  `;
  showView("entry");
  pushNavState("entry");
}

$("entryDetail").addEventListener("click", (e) => {
  if (e.target.closest("#linkedTxLink")) { showView("finance"); if (typeof Banking !== "undefined") Banking.render(); if (typeof Finance !== "undefined") Finance.render(); if (typeof Assets !== "undefined") Assets.render(); }
});

$("entryDetail").addEventListener("click", async (e) => {
  const copyBtn = e.target.closest(".code-copy-btn");
  if (!copyBtn) return;
  const text = MarkdownLite.getCodeBlock(copyBtn.dataset.codeId);
  try {
    await navigator.clipboard.writeText(text);
    showToast("คัดลอกโค้ดแล้ว");
  } catch (err) {
    showToast("คัดลอกไม่สำเร็จ");
  }
});

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

$("backFromEntryBtn").addEventListener("click", () => { showView("home"); popNavState(); });
$("editEntryBtn").addEventListener("click", () => openWriteForEdit(state.viewId));

$("pinEntryBtn").addEventListener("click", async () => {
  const rec = state.entries.find((e) => e.id === state.viewId);
  if (!rec) return;
  rec.pinned = !rec.pinned;
  rec.updatedAt = new Date().toISOString();
  await DiaryDB.put(rec);
  $("pinEntryBtn").textContent = rec.pinned ? "📌 เลิกปักหมุด" : "📌 ปักหมุด";
  renderHome();
  showToast(rec.pinned ? "ปักหมุดแล้ว" : "เลิกปักหมุดแล้ว");
});

$("deleteEntryBtn").addEventListener("click", async () => {
  if (!state.viewId) return;
  if (!confirm("ย้ายบันทึกนี้ไปถังขยะหรือไม่? (ลบถาวรอัตโนมัติใน 30 วัน)")) return;
  const rec = state.entries.find((e) => e.id === state.viewId);
  if (!rec) return;
  rec.deletedAt = new Date().toISOString();
  rec.updatedAt = new Date().toISOString();
  await DiaryDB.put(rec);
  renderHome();
  showToast("ย้ายไปถังขยะแล้ว");
  showView("home");
  popNavState();
});

// Quick trash from the list card itself, without opening the entry first —
// the only way to remove a private entry whose password has been forgotten
// (opening it to reach the normal delete button requires unlocking it).
async function quickTrashEntry(id) {
  const rec = state.entries.find((e) => e.id === id);
  if (!rec) return;
  if (!confirm("ย้ายบันทึกนี้ไปถังขยะหรือไม่? (ลบถาวรอัตโนมัติใน 30 วัน)")) return;
  rec.deletedAt = new Date().toISOString();
  rec.updatedAt = new Date().toISOString();
  await DiaryDB.put(rec);
  renderHome();
  showToast("ย้ายไปถังขยะแล้ว");
}

$("exportEntryBtn").addEventListener("click", () => {
  const rec = state.entries.find((e) => e.id === state.viewId);
  if (!rec) return;
  downloadJSON(rec, `diary-entry-${rec.date}-${rec.id}.json`);
});

/* ---------------- share out ---------------- */

$("shareEntryBtn").addEventListener("click", async () => {
  const rec = state.entries.find((e) => e.id === state.viewId);
  if (!rec || !state.viewDecrypted) return;
  const data = state.viewDecrypted;
  const text = [data.title, data.content].filter(Boolean).join("\n\n");
  // Text-only, on purpose: most share targets (LINE, Messenger, etc.) drop
  // the caption text entirely when a file is attached alongside it, so
  // sharing text+image together is unreliable. To share a photo, long-press
  // it in the entry view instead — the browser's own save/share menu
  // handles that reliably without going through this button at all.
  const shareData = { title: data.title || "บันทึกจากสมุดบันทึก", text };

  try {
    if (navigator.share) {
      await navigator.share(shareData);
    } else {
      await navigator.clipboard.writeText(text);
      showToast("อุปกรณ์นี้ไม่รองรับเมนูแชร์ — คัดลอกข้อความแล้วแทน");
    }
  } catch (err) {
    if (err && err.name === "AbortError") return; // user cancelled the share sheet
    console.error("Share failed:", err);
    showToast("แชร์ไม่สำเร็จ: " + (err && err.message ? err.message : ""));
  }
});

async function loadLocalAttachmentBlobsForEntry(rec) {
  // Telegram-forwarding only: unlike loadAttachmentsForEntry above, this
  // does NOT auto-download from Drive (keeps bulk Telegram resends fast)
  // and doesn't need id/url — just blob+type to hand to the Bot API.
  const result = [];
  for (const ref of rec.attachmentRefs || []) {
    const att = await DiaryDB.getAttachment(ref.id);
    if (att && att.blob) result.push({ type: att.type, blob: att.blob });
  }
  return result;
}

$("telegramResendBtn").addEventListener("click", async () => {
  const rec = state.entries.find((e) => e.id === state.viewId);
  if (!rec || rec.private) return;
  if (typeof TelegramNotify === "undefined" || !TelegramNotify.isConfigured()) {
    showToast("ยังไม่ได้ตั้งค่า Telegram (ตั้งค่า → Telegram)");
    return;
  }
  $("telegramResendBtn").disabled = true;
  try {
    const attachments = await loadLocalAttachmentBlobsForEntry(rec);
    await TelegramNotify.sendEntry(rec, rec, attachments);
    showToast("ส่งเข้า Telegram แล้ว");
  } finally {
    $("telegramResendBtn").disabled = false;
  }
});

/* ---------------- trash ---------------- */

function activeTrashed() {
  return state.entries.filter((e) => e.deletedAt && !e.purged);
}

function renderTrash() {
  $("trashRetentionNote").textContent = `บันทึกที่ลบจะอยู่ที่นี่ ${getTrashRetentionDays()} วัน ก่อนลบถาวรอัตโนมัติ`;
  const trashed = activeTrashed().sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  const list = $("trashList");
  list.innerHTML = "";
  $("trashEmptyState").hidden = trashed.length > 0;

  const soonCount = trashed.filter((e) => {
    const daysLeft = getTrashRetentionDays() - Math.floor((Date.now() - new Date(e.deletedAt).getTime()) / 86400000);
    return daysLeft <= 3;
  }).length;
  const warnBanner = $("trashWarningBanner");
  if (soonCount > 0) {
    warnBanner.hidden = false;
    warnBanner.textContent = `⚠️ มี ${soonCount} รายการจะถูกลบถาวรภายใน 3 วัน`;
  } else {
    warnBanner.hidden = true;
  }

  trashed.forEach((e) => {
    const item = document.createElement("div");
    item.className = "trash-item";
    const label = e.private ? "🔒 บันทึกส่วนตัว" : escapeHTML(e.title || "(ไม่มีชื่อเรื่อง)");
    const daysLeft = getTrashRetentionDays() - Math.floor((Date.now() - new Date(e.deletedAt).getTime()) / 86400000);
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

$("trashRetentionSelect").addEventListener("change", (e) => {
  localStorage.setItem("diary_trash_retention_days", e.target.value);
  renderTrash();
});
$("debtReminderDaysInput").addEventListener("change", (e) => {
  const v = Math.max(0, Math.min(30, parseInt(e.target.value, 10) || 0));
  e.target.value = String(v);
  localStorage.setItem("diary_debt_reminder_days", String(v));
  updateDebtReminderBanner();
});

function checkTrashExpiryWarning() {
  const trashed = activeTrashed();
  const soon = trashed.filter((e) => {
    const daysLeft = getTrashRetentionDays() - Math.floor((Date.now() - new Date(e.deletedAt).getTime()) / 86400000);
    return daysLeft <= 3;
  });
  if (soon.length === 0) return;
  const warnedDate = localStorage.getItem("diary_trash_warned_date");
  if (warnedDate === todayISO()) return; // once per day is enough
  localStorage.setItem("diary_trash_warned_date", todayISO());
  showToast(`⚠️ มี ${soon.length} รายการในถังขยะจะถูกลบถาวรภายใน 3 วัน`);
}

// Permanently purging locally must not let a later sync pull the entry back
// from Drive (the remote copy doesn't know it was deleted). We keep a tiny
// "tombstone" record instead of removing it outright — its very recent
// updatedAt + purged flag always wins the merge, and it travels to Drive on
// the next sync so other devices purge their copy too.
async function purgeToTombstone(rec) {
  for (const ref of rec.attachmentRefs || []) {
    await DiaryDB.removeAttachment(ref.id);
  }
  const tombstone = {
    id: rec.id, date: rec.date, time: rec.time, private: false,
    deletedAt: rec.deletedAt || new Date().toISOString(),
    purged: true,
    updatedAt: new Date().toISOString(),
  };
  await DiaryDB.put(tombstone);
  const idx = state.entries.findIndex((e) => e.id === rec.id);
  if (idx >= 0) state.entries[idx] = tombstone;
}

$("trashList").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const id = btn.dataset.id;
  const rec = state.entries.find((x) => x.id === id);
  if (!rec) return;
  if (btn.dataset.action === "restore") {
    rec.deletedAt = null;
    rec.updatedAt = new Date().toISOString();
    await DiaryDB.put(rec);
    renderTrash();
    renderHome();
    showToast("กู้คืนแล้ว");
  } else if (btn.dataset.action === "purge") {
    if (!confirm("ลบถาวรจริงหรือไม่? กู้คืนไม่ได้อีก")) return;
    await purgeToTombstone(rec);
    renderTrash();
    renderHome();
    showToast("ลบถาวรแล้ว");
  }
});

$("openTrashBtn").addEventListener("click", () => { renderTrash(); showView("trash"); pushNavState("trash"); });
$("backFromTrashBtn").addEventListener("click", () => { showView("settings"); popNavState(); });

async function purgeOldTrash() {
  const cutoff = Date.now() - getTrashRetentionDays() * 86400000;
  const toPurge = state.entries.filter((e) => e.deletedAt && !e.purged && new Date(e.deletedAt).getTime() < cutoff);
  for (const e of toPurge) await purgeToTombstone(e);
}

/* ---------------- stats ---------------- */

function computeCurrentStreak(dateSet) {
  let streak = 0;
  let cursor = new Date();
  let dateStr = todayISO();
  if (!dateSet.has(dateStr)) {
    cursor.setDate(cursor.getDate() - 1);
    dateStr = `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}-${pad2(cursor.getDate())}`;
    if (!dateSet.has(dateStr)) return 0;
  }
  while (dateSet.has(dateStr)) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
    dateStr = `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}-${pad2(cursor.getDate())}`;
  }
  return streak;
}

function computeLongestStreak(sortedDates) {
  let longest = 0, current = 0, prevTime = null;
  for (const d of sortedDates) {
    const t = new Date(d).getTime();
    if (prevTime !== null && Math.round((t - prevTime) / 86400000) === 1) current++;
    else current = 1;
    longest = Math.max(longest, current);
    prevTime = t;
  }
  return longest;
}

function renderBarChart(container, rows) {
  if (rows.length === 0) { container.innerHTML = '<p class="settings-note">ยังไม่มีข้อมูล</p>'; return; }
  const max = Math.max(...rows.map((r) => r.count), 1);
  container.innerHTML = rows.map((r) => `
    <div class="stat-bar-row">
      <span class="stat-bar-label">${escapeHTML(r.label)}</span>
      <span class="stat-bar-track"><span class="stat-bar-fill" style="width:${Math.round((r.count / max) * 100)}%"></span></span>
      <span class="stat-bar-count">${r.count}</span>
    </div>`).join("");
}

function renderStats() {
  const entries = activeEntries();
  const dateSet = new Set(entries.map((e) => e.date));
  const sortedDates = [...dateSet].sort();

  $("statTotalEntries").textContent = entries.length;
  $("statCurrentStreak").textContent = computeCurrentStreak(dateSet);
  $("statLongestStreak").textContent = computeLongestStreak(sortedDates);

  const moodCounts = {};
  const tagCounts = {};
  entries.forEach((e) => {
    if (e.private) return;
    if (e.mood) moodCounts[e.mood] = (moodCounts[e.mood] || 0) + 1;
    (e.tags || []).forEach((t) => { tagCounts[t] = (tagCounts[t] || 0) + 1; });
  });
  const moodRows = Object.entries(moodCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, count]) => ({ label, count }));
  const tagRows = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, count]) => ({ label: "#" + label, count }));
  renderBarChart($("statMoodChart"), moodRows);
  renderBarChart($("statTagChart"), tagRows);

  const monthCounts = {};
  entries.forEach((e) => { const m = e.date.slice(0, 7); monthCounts[m] = (monthCounts[m] || 0) + 1; });
  const now = new Date();
  const monthRows = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
    monthRows.push({ label: `${THAI_MONTHS[d.getMonth()]} ${(d.getFullYear() + 543).toString().slice(2)}`, count: monthCounts[key] || 0 });
  }
  renderBarChart($("statMonthChart"), monthRows);
}
$("backFromStatsBtn").addEventListener("click", () => { showView(state.statsReturnView || "dashboard"); popNavState(); });

/* ---------------- backup / restore ---------------- */

function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function downloadTextFile(text, filename, mime) {
  const blob = new Blob([text], { type: mime || "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

$("exportReadableBtn").addEventListener("click", async () => {
  const entries = activeEntries().slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const privateCount = entries.filter((e) => e.private).length;
  let includePrivate = false;
  if (privateCount > 0) {
    includePrivate = confirm(`พบบันทึกส่วนตัว ${privateCount} รายการ ต้องการรวมไว้ในไฟล์ที่ส่งออกด้วยไหม (ต้องปลดล็อกก่อน)?`);
    if (includePrivate) {
      const ok = await ensureUnlocked("เพื่อรวมบันทึกส่วนตัวในไฟล์ส่งออก");
      if (!ok) includePrivate = false;
    }
  }

  let md = `# สมุดบันทึก\n\nส่งออกเมื่อ ${formatFullThaiDate(todayISO())}\n\n---\n\n`;
  for (const rec of entries) {
    if (rec.private) {
      if (!includePrivate) { md += `## ${formatFullThaiDate(rec.date)} · ${rec.time} น.\n\n🔒 *(บันทึกส่วนตัว — ไม่รวมไว้ในไฟล์นี้)*\n\n---\n\n`; continue; }
      let data;
      try { data = await DiaryCrypto.decryptJSON({ iv: rec.encIv, data: rec.encData }); }
      catch (e) { md += `## ${formatFullThaiDate(rec.date)} · ${rec.time} น.\n\n🔒 *(ถอดรหัสไม่สำเร็จ)*\n\n---\n\n`; continue; }
      md += `## ${formatFullThaiDate(rec.date)} · ${rec.time} น. 🔒\n\n`;
      if (data.title) md += `**${data.title}**\n\n`;
      if (data.mood) md += `${data.mood}\n\n`;
      md += `${data.content || ""}\n\n`;
      if (data.tags && data.tags.length) md += `แท็ก: ${data.tags.map((t) => "#" + t).join(" ")}\n\n`;
      md += `---\n\n`;
    } else {
      md += `## ${formatFullThaiDate(rec.date)} · ${rec.time} น.\n\n`;
      if (rec.title) md += `**${rec.title}**\n\n`;
      if (rec.mood) md += `${rec.mood}\n\n`;
      md += `${rec.content || ""}\n\n`;
      if (rec.tags && rec.tags.length) md += `แท็ก: ${rec.tags.map((t) => "#" + t).join(" ")}\n\n`;
      md += `---\n\n`;
    }
  }
  downloadTextFile(md, `diary-readable-${todayISO()}.md`, "text/markdown");
  showToast("ดาวน์โหลดไฟล์แล้ว");
});

$("backupBtn").addEventListener("click", async () => {
  showToast("กำลังเตรียมไฟล์สำรอง...");
  const hasPw = DiaryCrypto.hasPassword();

  // Attachments synced in from another device sometimes only have a
  // driveFileId locally (the actual blob is fetched lazily, only when the
  // entry is opened) — fetch those now so the backup is genuinely
  // complete instead of silently skipping anything never viewed on this
  // device. Best-effort: if Drive isn't signed in or a fetch fails, that
  // one attachment is skipped and counted, rest of the backup proceeds.
  let missingCount = 0;
  async function resolveBlob(att) {
    if (att && att.blob) return att.blob;
    if (att && att.driveFileId && typeof DriveSync !== "undefined") {
      try { return await DriveSync.downloadAttachmentBlob(att.driveFileId); }
      catch (e) { missingCount++; return null; }
    }
    if (att) missingCount++;
    return null;
  }

  const entries = [];
  for (const e of state.entries) {
    const copy = { ...e };
    if (!e.private && e.attachmentRefs && e.attachmentRefs.length) {
      const atts = [];
      for (const ref of e.attachmentRefs) {
        const att = await DiaryDB.getAttachment(ref.id);
        const blob = await resolveBlob(att);
        if (blob) atts.push({ id: att.id, type: att.type, mimeType: att.mimeType, dataURL: await blobToDataURL(blob) });
      }
      copy.attachmentBlobs = atts;
    }
    entries.push(copy);
  }
  // Finance/Banking data never needs decrypting for a backup file — for
  // private diary entries and everything from the Banking module, the raw
  // encIv/encData fields are copied through as-is, same as they already
  // are inside the app's own IndexedDB. This was previously diary-only;
  // Google Drive sync was the only backup that covered transactions,
  // assets, and Banking data, so a Drive outage meant no fallback at all
  // for that data.
  const transactions = await DiaryDB.getAllTransactions();
  for (const t of transactions) {
    if (!t.hasAttachments) continue;
    const atts = await DiaryDB.getAttachmentsByEntry(t.id);
    const withBlob = [];
    for (const att of atts) {
      const blob = await resolveBlob(att);
      if (blob) withBlob.push({ id: att.id, type: att.type, mimeType: att.mimeType, dataURL: await blobToDataURL(blob) });
    }
    if (withBlob.length) t.attachmentBlobs = withBlob;
  }
  const backup = {
    version: 3,
    exportedAt: new Date().toISOString(),
    settings: hasPw ? {
      salt: localStorage.getItem("diary_pw_salt"),
      verifierIv: localStorage.getItem("diary_pw_verifier_iv"),
      verifier: localStorage.getItem("diary_pw_verifier"),
    } : null,
    entries,
    transactions,
    assets: await DiaryDB.getAllAssets(),
    bankAccounts: await DiaryDB.getAllBankAccounts(),
    debts: await DiaryDB.getAllDebts(),
    otherInfo: await DiaryDB.getAllOtherInfo(),
  };
  const stamp = todayISO().replace(/-/g, "");
  downloadJSON(backup, `diary-backup-${stamp}.json`);
  showToast(missingCount > 0 ? `ดาวน์โหลดไฟล์สำรองแล้ว (ไฟล์แนบ ${missingCount} รายการดึงจาก Drive ไม่ได้ — ข้ามไป)` : "ดาวน์โหลดไฟล์สำรองแล้ว");
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

    let skippedAttachments = 0;
    for (const e of backup.entries) {
      const rec = { ...e };
      if (Array.isArray(rec.attachmentBlobs)) {
        const refs = [];
        for (const a of rec.attachmentBlobs) {
          try {
            const blob = dataURLToBlob(a.dataURL);
            await DiaryDB.putAttachment({ id: a.id, entryId: rec.id, type: a.type, blob, mimeType: a.mimeType, size: blob.size, createdAt: rec.createdAt, driveFileId: null });
            refs.push({ id: a.id, type: a.type });
          } catch (attErr) {
            console.error("Skipping corrupted attachment in backup:", a && a.id, attErr);
            skippedAttachments++;
          }
        }
        rec.attachmentRefs = refs;
        delete rec.attachmentBlobs;
      }
      await DiaryDB.put(rec);
    }
    state.entries = await DiaryDB.getAll();

    // Older backup files (version 2 and before) simply won't have these
    // fields — Array.isArray guards each one so restoring an old file
    // still works, it just won't bring back finance/banking data that was
    // never in it to begin with.
    let restoredCount = backup.entries.length;
    if (Array.isArray(backup.transactions) && backup.transactions.length) {
      for (const t of backup.transactions) {
        if (Array.isArray(t.attachmentBlobs)) {
          for (const a of t.attachmentBlobs) {
            try {
              const blob = dataURLToBlob(a.dataURL);
              await DiaryDB.putAttachment({ id: a.id, entryId: t.id, type: a.type, blob, mimeType: a.mimeType, size: blob.size, createdAt: t.createdAt, driveFileId: null });
            } catch (attErr) {
              console.error("Skipping corrupted attachment in backup:", a && a.id, attErr);
              skippedAttachments++;
            }
          }
          delete t.attachmentBlobs;
        }
      }
      await DiaryDB.bulkPutTransactions(backup.transactions);
      restoredCount += backup.transactions.length;
    }
    if (Array.isArray(backup.assets) && backup.assets.length) {
      await DiaryDB.bulkPutAssets(backup.assets);
      restoredCount += backup.assets.length;
    }
    if (Array.isArray(backup.bankAccounts) && backup.bankAccounts.length) {
      await DiaryDB.bulkPutBankAccounts(backup.bankAccounts);
      restoredCount += backup.bankAccounts.length;
    }
    if (Array.isArray(backup.debts) && backup.debts.length) {
      await DiaryDB.bulkPutDebts(backup.debts);
      restoredCount += backup.debts.length;
    }
    if (Array.isArray(backup.otherInfo) && backup.otherInfo.length) {
      await DiaryDB.bulkPutOtherInfo(backup.otherInfo);
      restoredCount += backup.otherInfo.length;
    }

    renderHome();
    if (typeof Finance !== "undefined") await Finance.render();
    if (typeof Banking !== "undefined") await Banking.render();
    if (typeof Assets !== "undefined") await Assets.render();
    showToast(`กู้คืนข้อมูลแล้ว (${restoredCount} รายการ)` + (skippedAttachments > 0 ? ` — ข้ามไฟล์แนบที่เสีย ${skippedAttachments} ไฟล์` : ""));
  } catch (err) {
    console.error(err);
    showToast("กู้คืนไม่สำเร็จ: " + (err && err.message ? err.message : "ไม่ทราบสาเหตุ"));
  }
  e.target.value = "";
});

/* ---------------- calendar picker (modal — always date-pick mode) ---------------- */

function computeCalendarDayInfo() {
  const info = {};
  activeEntries().forEach((e) => {
    if (!info[e.date]) info[e.date] = { hasEntry: false, hasMedia: false, hasMoney: false };
    info[e.date].hasEntry = true;
    if (e.hasMedia) info[e.date].hasMedia = true;
  });
  if (typeof Finance !== "undefined") {
    Finance.getTransactionDateSet().forEach((date) => {
      if (!info[date]) info[date] = { hasEntry: false, hasMedia: false, hasMoney: false };
      info[date].hasMoney = true;
    });
  }
  return info;
}

function buildCalendarGrid(gridEl, titleEl, year, month) {
  titleEl.textContent = `${THAI_MONTHS[month]} ${year + 543}`;
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = todayISO();
  const dayInfo = computeCalendarDayInfo();

  gridEl.innerHTML = "";
  for (let i = 0; i < firstWeekday; i++) {
    gridEl.insertAdjacentHTML("beforeend", '<span class="cal-cell empty"></span>');
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${pad2(month + 1)}-${pad2(d)}`;
    const info = dayInfo[dateStr];
    const classes = ["cal-cell"];
    if (dateStr === todayStr) classes.push("today");
    if (info && info.hasEntry) classes.push("has-entry");
    const dots = [];
    if (info && info.hasEntry) dots.push('<i class="cal-dot-mark entry"></i>');
    if (info && info.hasMedia) dots.push('<i class="cal-dot-mark media"></i>');
    if (info && info.hasMoney) dots.push('<i class="cal-dot-mark money"></i>');
    const marks = dots.length ? `<span class="cal-dots">${dots.join("")}</span>` : "";
    gridEl.insertAdjacentHTML("beforeend", `<button type="button" class="${classes.join(" ")}" data-date="${dateStr}">${d}${marks}</button>`);
  }
}

function renderCalendar() { buildCalendarGrid($("calGrid"), $("calTitle"), state.cal.year, state.cal.month); }

function openCalendarForPick(initialDateStr, onPick) {
  const [y, m] = (initialDateStr || todayISO()).split("-").map(Number);
  state.cal.year = y;
  state.cal.month = m - 1;
  state.calPickCallback = onPick;
  $("calendarModal").hidden = false;
  pushNavState("calendar");
  renderCalendar();
}
function closeCalendarVisual() { $("calendarModal").hidden = true; }
function closeCalendar() { closeCalendarVisual(); popNavState(); }

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
  const cb = state.calPickCallback;
  closeCalendar();
  if (cb) cb(dateStr);
});

/* ---------------- calendar page (persistent tab — browse mode) ---------------- */

function renderCalendarPage() {
  buildCalendarGrid($("calPageGrid"), $("calPageTitle"), state.calPage.year, state.calPage.month);
}
$("todayPill").addEventListener("click", () => { showView("calendarPage"); renderCalendarPage(); });
$("calPagePrevBtn").addEventListener("click", () => {
  state.calPage.month -= 1;
  if (state.calPage.month < 0) { state.calPage.month = 11; state.calPage.year -= 1; }
  renderCalendarPage();
});
$("calPageNextBtn").addEventListener("click", () => {
  state.calPage.month += 1;
  if (state.calPage.month > 11) { state.calPage.month = 0; state.calPage.year += 1; }
  renderCalendarPage();
});
$("calPageGrid").addEventListener("click", (e) => {
  const cell = e.target.closest(".cal-cell:not(.empty)");
  if (!cell) return;
  const dateStr = cell.dataset.date;
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
  btn.addEventListener("click", () => {
    showView(btn.dataset.nav);
    if (btn.dataset.nav === "finance" && typeof Banking !== "undefined") Banking.render();
    if (btn.dataset.nav === "finance" && typeof Finance !== "undefined") Finance.render();
    if (btn.dataset.nav === "finance" && typeof Assets !== "undefined") Assets.render();
    if (btn.dataset.nav === "gallery" && typeof Gallery !== "undefined") Gallery.openTab();
    if (btn.dataset.nav === "calendarPage") renderCalendarPage();
  });
});
$("headerSettingsBtn").addEventListener("click", () => showView("settings"));
$("headerStatsBtn").addEventListener("click", () => {
  state.statsReturnView = state.view;
  renderStats();
  showView("stats");
  pushNavState("stats");
});
$("dashWriteBtn").addEventListener("click", openWriteForNew);
$("dashAddTxBtn").addEventListener("click", () => { if (typeof Finance !== "undefined") Finance.openNewTx(); });
$("newTxBtn").addEventListener("click", () => { if (typeof Finance !== "undefined") Finance.openNewTx(); });

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

function registerServiceWorkerWithUpdateCheck() {
  navigator.serviceWorker.register("sw.js").then((reg) => {
    // Don't just wait for the browser's own update-check heuristic (up to
    // 24h, and can get stuck if sw.js itself was cached by the browser's
    // own HTTP layer) — actively ask for a fresh check every time the app
    // opens instead.
    reg.update().catch(() => {});

    reg.addEventListener("updatefound", () => {
      const newWorker = reg.installing;
      if (!newWorker) return;
      newWorker.addEventListener("statechange", () => {
        // navigator.serviceWorker.controller already existing means this
        // is a genuine update (not the very first install ever) — show
        // the banner rather than reloading out from under the user.
        if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
          $("updateAvailableBanner").hidden = false;
        }
      });
    });
  }).catch(() => {});
}
$("updateReloadBtn").addEventListener("click", () => window.location.reload());
$("updateDismissBtn").addEventListener("click", () => { $("updateAvailableBanner").hidden = true; });

async function init() {
  try {
    ThemeSettings.apply();

    const today = new Date();
    $("todayPill").textContent = `${today.getDate()} ${THAI_MONTHS[today.getMonth()]} ${today.getFullYear() + 543}`;
    $("appVersionText").textContent = `เวอร์ชัน ${APP_VERSION} · อัปเดตล่าสุด ${formatFullThaiDate(APP_BUILD_DATE)}`;
    $("brandText").textContent = `สมุดบันทึก v.${APP_VERSION}`;
    state.cal.year = today.getFullYear();
    state.cal.month = today.getMonth();
    state.calPage.year = today.getFullYear();
    state.calPage.month = today.getMonth();

    await DiaryDB.migrateIfNeeded();
    state.entries = await DiaryDB.getAll();
    await purgeOldTrash();
    if (typeof Banking !== "undefined") await Banking.init();
    if (typeof Finance !== "undefined") await Finance.init();
    if (typeof Assets !== "undefined") await Assets.init();
    if (typeof Statement !== "undefined") await Statement.init();
    if (typeof NetTrend !== "undefined") await NetTrend.init();
    if (typeof Gallery !== "undefined") Gallery.init();

    renderHome();
    refreshSettingsView();
    showView("dashboard");
    handleShareTarget();
    checkTrashExpiryWarning();
    checkSyncReminder();
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
    if (typeof ExchangeRate !== "undefined") {
      ExchangeRate.refreshIfStale().then(refreshExchangeRateDisplay);
    }
    resetAutoLockTimer();

    if ("serviceWorker" in navigator) {
      registerServiceWorkerWithUpdateCheck();
    }
  } catch (err) {
    console.error("Init failed:", err);
    showToast("โหลดข้อมูลไม่สำเร็จ: " + (err && err.message ? err.message : "ไม่ทราบสาเหตุ"));
  }
}

init();
