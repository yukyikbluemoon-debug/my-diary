/* gallery.js — a flat, filterable view of every attachment across all
   non-private entries, with multi-select + rate-limited batch download.
   Private-entry media is intentionally excluded (same rule as search/
   stats/on-this-day elsewhere) — nothing here ever decrypts anything. */

const Gallery = (() => {
  let items = [];        // {attId, entryId, type, blob, mimeType, size, entryDate}
  let filterType = "";
  let sortKey = "date";  // "date" | "size" | "type"
  let sortDir = "desc";  // "desc" | "asc"
  let selected = new Set();

  async function loadItems() {
    items = [];
    for (const e of activeEntries()) {
      if (e.private || !e.attachmentRefs) continue;
      for (const ref of e.attachmentRefs) {
        const att = await DiaryDB.getAttachment(ref.id);
        if (!att) continue;
        items.push({
          attId: att.id, entryId: e.id, type: att.type,
          blob: att.blob || null, mimeType: att.mimeType, size: att.size || 0,
          fileName: att.fileName || null,
          driveFileId: att.driveFileId || null, entryDate: e.date,
        });
      }
    }
    items.sort((a, b) => b.entryDate.localeCompare(a.entryDate));
  }

  function filteredItems() {
    const list = filterType ? items.filter((i) => i.type === filterType) : items.slice();
    const dir = sortDir === "asc" ? 1 : -1;
    list.sort((a, b) => {
      let cmp;
      if (sortKey === "size") cmp = a.size - b.size;
      else if (sortKey === "type") cmp = a.type.localeCompare(b.type);
      else cmp = a.entryDate.localeCompare(b.entryDate);
      return cmp * dir;
    });
    return list;
  }

  function iconFor(type) {
    return { image: "🖼️", audio: "🎙️", video: "🎥", sketch: "✏️", document: "📄" }[type] || "📎";
  }

  function extFor(mimeType) {
    if (!mimeType) return "bin";
    const map = { "image/jpeg": "jpg", "image/png": "png", "audio/webm": "webm", "audio/mp4": "m4a", "video/webm": "webm", "video/mp4": "mp4", "application/pdf": "pdf", "text/plain": "txt" };
    return map[mimeType] || mimeType.split("/")[1] || "bin";
  }

  async function ensureBlob(item) {
    if (item.blob) return item.blob;
    if (item.driveFileId && typeof DriveSync !== "undefined") {
      try {
        const blob = await DriveSync.downloadAttachmentBlob(item.driveFileId);
        item.blob = blob;
        const att = await DiaryDB.getAttachment(item.attId);
        if (att) { att.blob = blob; await DiaryDB.putAttachment(att); }
        return blob;
      } catch (err) {
        showToast("ดาวน์โหลดไฟล์จาก Drive ไม่สำเร็จ");
        return null;
      }
    }
    return null;
  }

  function render() {
    const list = filteredItems();
    const grid = $("galleryGrid");
    grid.innerHTML = "";
    $("galleryEmptyState").hidden = list.length > 0;

    let totalSize = 0;
    list.forEach((item) => {
      totalSize += item.size;
      const tile = document.createElement("div");
      tile.className = "gallery-item" + (selected.has(item.attId) ? " selected" : "");
      tile.dataset.id = item.attId;
      if ((item.type === "image" || item.type === "sketch") && item.blob) {
        tile.innerHTML = `<img src="${URL.createObjectURL(item.blob)}">`;
      } else {
        tile.innerHTML = `<div class="gallery-item-icon">${iconFor(item.type)}</div>`;
      }
      if (!item.blob && item.driveFileId) {
        tile.insertAdjacentHTML("beforeend", '<span class="gallery-item-cloud">☁️</span>');
      }
      tile.insertAdjacentHTML("beforeend", '<span class="gallery-item-check"></span>');
      grid.appendChild(tile);
    });

    $("gallerySummaryText").textContent = `${list.length} ไฟล์ · ${formatBytes(totalSize)}`;
    $("galleryDownloadBtn").textContent = `ดาวน์โหลดที่เลือก (${selected.size})`;
    $("galleryDownloadBtn").disabled = selected.size === 0;
    $("galleryDeleteBtn").textContent = `ลบที่เลือก (${selected.size})`;
    $("galleryDeleteBtn").disabled = selected.size === 0;
  }

  async function openItem(attId) {
    const item = items.find((i) => i.attId === attId);
    if (!item) return;
    if (item.type === "image" || item.type === "sketch") {
      const blob = await ensureBlob(item);
      if (blob) openLightbox(URL.createObjectURL(blob));
    } else if (item.type === "document") {
      const blob = await ensureBlob(item);
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = item.fileName || `file.${extFor(item.mimeType)}`;
      a.click();
    } else {
      // audio/video — jump to the entry itself so it plays in context
      showView("home");
      openEntry(item.entryId);
    }
  }

  function toggleSelect(attId) {
    if (selected.has(attId)) selected.delete(attId);
    else selected.add(attId);
    render();
  }

  async function downloadSelected() {
    const toDownload = items.filter((i) => selected.has(i.attId));
    if (toDownload.length === 0) return;
    $("galleryDownloadBtn").disabled = true;
    let done = 0;
    for (const item of toDownload) {
      showToast(`กำลังดาวน์โหลด ${done + 1}/${toDownload.length}...`);
      const blob = await ensureBlob(item);
      if (blob) {
        const filename = item.fileName || `diary-${item.type}-${item.entryDate}-${item.attId}.${extFor(item.mimeType)}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
      }
      done++;
      await new Promise((r) => setTimeout(r, 400));
    }
    showToast(`ดาวน์โหลดเสร็จแล้ว (${done} ไฟล์)`);
    $("galleryDownloadBtn").disabled = selected.size === 0;
  }

  async function deleteSelected() {
    const toDelete = items.filter((i) => selected.has(i.attId));
    if (toDelete.length === 0) return;
    const totalSize = toDelete.reduce((sum, i) => sum + (i.size || 0), 0);
    if (!confirm(`ลบไฟล์ที่เลือก ${toDelete.length} ไฟล์ (${formatBytes(totalSize)}) ทิ้งถาวร?\n\nจะลบออกจากบันทึกที่แนบไว้ด้วย และกู้คืนไม่ได้เลย (ไม่มีถังขยะสำหรับไฟล์แนบ)`)) return;

    // Group by entryId so each affected diary entry gets its
    // attachmentRefs updated (and hasMedia recalculated) exactly once,
    // even if several selected photos belong to the same entry.
    const byEntry = new Map();
    toDelete.forEach((item) => {
      if (!byEntry.has(item.entryId)) byEntry.set(item.entryId, []);
      byEntry.get(item.entryId).push(item.attId);
    });
    for (const [entryId, attIds] of byEntry) {
      const entry = state.entries.find((e) => e.id === entryId);
      if (entry && Array.isArray(entry.attachmentRefs)) {
        entry.attachmentRefs = entry.attachmentRefs.filter((r) => !attIds.includes(r.id));
        entry.hasMedia = entry.attachmentRefs.length > 0;
        entry.updatedAt = new Date().toISOString();
        await DiaryDB.put(entry);
      }
    }
    for (const item of toDelete) {
      await DiaryDB.removeAttachment(item.attId);
    }
    selected.clear();
    await loadItems();
    render();
    showToast(`ลบแล้ว ${toDelete.length} ไฟล์`);
  }

  async function openTab() {
    selected.clear();
    await loadItems();
    render();
  }

  function wireEvents() {
    $("galleryFilter").addEventListener("click", (e) => {
      const btn = e.target.closest(".entry-type-filter-btn");
      if (!btn) return;
      filterType = btn.dataset.galtype;
      document.querySelectorAll("#galleryFilter .entry-type-filter-btn").forEach((b) => b.classList.toggle("selected", b === btn));
      render();
    });
    $("gallerySortKey").addEventListener("change", (e) => { sortKey = e.target.value; render(); });
    $("gallerySortDir").addEventListener("change", (e) => { sortDir = e.target.value; render(); });
    $("galleryGrid").addEventListener("click", (e) => {
      const check = e.target.closest(".gallery-item-check");
      const tile = e.target.closest(".gallery-item");
      if (!tile) return;
      if (check) { toggleSelect(tile.dataset.id); return; }
      openItem(tile.dataset.id);
    });
    $("gallerySelectAllBtn").addEventListener("click", () => {
      filteredItems().forEach((i) => selected.add(i.attId));
      render();
    });
    $("galleryClearSelectionBtn").addEventListener("click", () => {
      selected.clear();
      render();
    });
    $("galleryDownloadBtn").addEventListener("click", downloadSelected);
    $("galleryDeleteBtn").addEventListener("click", deleteSelected);
  }

  function init() {
    wireEvents();
  }

  return { init, openTab };
})();
