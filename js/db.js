/* db.js — storage layer backed by IndexedDB.
   Two object stores:
   - "entries": diary entry records (metadata + text; for private entries,
     everything content-related is inside an encrypted blob, as before)
   - "attachments": binary blobs (photos, sketches, voice notes, video
     clips) for NON-private entries, referenced by id from entry.attachmentRefs.
     Private-entry media stays inline as base64 inside the encrypted
     payload (same mechanism as before) — simplest way to guarantee it's
     covered by encryption regardless of media type.

   Now that the app runs on a real https:// origin (GitHub Pages) instead
   of file://, IndexedDB is reliable again and gives us a much bigger
   storage ceiling than localStorage (which we used temporarily while the
   app was only reachable as a local file). On first run, any old data
   left in localStorage from that period is migrated in automatically. */

const DiaryDB = (() => {
  const DB_NAME = "diary_db_v2";
  const DB_VERSION = 1;
  const ENTRIES_STORE = "entries";
  const ATTACH_STORE = "attachments";
  const OLD_LS_KEY = "diary_entries_v1";

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(ENTRIES_STORE)) {
          const s = db.createObjectStore(ENTRIES_STORE, { keyPath: "id" });
          s.createIndex("date", "date", { unique: false });
        }
        if (!db.objectStoreNames.contains(ATTACH_STORE)) {
          const s = db.createObjectStore(ATTACH_STORE, { keyPath: "id" });
          s.createIndex("entryId", "entryId", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function storeTx(name, mode) {
    const db = await open();
    return db.transaction(name, mode).objectStore(name);
  }

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /* ---------- entries ---------- */

  async function put(entry) {
    const store = await storeTx(ENTRIES_STORE, "readwrite");
    await reqToPromise(store.put(entry));
    return entry;
  }

  async function remove(id) {
    // hard delete: entry + any attachments it owns
    const atts = await getAttachmentsByEntry(id);
    for (const a of atts) await removeAttachment(a.id);
    const store = await storeTx(ENTRIES_STORE, "readwrite");
    await reqToPromise(store.delete(id));
    return true;
  }

  async function getAll() {
    const store = await storeTx(ENTRIES_STORE, "readonly");
    return reqToPromise(store.getAll());
  }

  async function get(id) {
    const store = await storeTx(ENTRIES_STORE, "readonly");
    const res = await reqToPromise(store.get(id));
    return res || null;
  }

  async function bulkPut(entries) {
    const store = await storeTx(ENTRIES_STORE, "readwrite");
    return new Promise((resolve, reject) => {
      entries.forEach((e) => store.put(e));
      store.transaction.oncomplete = () => resolve(true);
      store.transaction.onerror = () => reject(store.transaction.error);
    });
  }

  /* ---------- attachments ---------- */

  async function putAttachment(att) {
    const store = await storeTx(ATTACH_STORE, "readwrite");
    await reqToPromise(store.put(att));
    return att;
  }

  async function getAttachment(id) {
    const store = await storeTx(ATTACH_STORE, "readonly");
    const res = await reqToPromise(store.get(id));
    return res || null;
  }

  async function getAttachmentsByEntry(entryId) {
    const store = await storeTx(ATTACH_STORE, "readonly");
    const idx = store.index("entryId");
    return reqToPromise(idx.getAll(entryId));
  }

  async function getAllAttachments() {
    const store = await storeTx(ATTACH_STORE, "readonly");
    return reqToPromise(store.getAll());
  }

  async function removeAttachment(id) {
    const store = await storeTx(ATTACH_STORE, "readwrite");
    await reqToPromise(store.delete(id));
    return true;
  }

  /* ---------- one-time migration from the old localStorage version ---------- */

  function dataURLToBlob(dataURL) {
    const [header, b64] = dataURL.split(",");
    const mime = /data:(.*?);base64/.exec(header)[1];
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  async function migrateIfNeeded() {
    const raw = localStorage.getItem(OLD_LS_KEY);
    if (!raw) return;
    const existing = await getAll();
    if (existing.length > 0) {
      // already have IndexedDB data; don't overwrite, just drop the old key
      localStorage.removeItem(OLD_LS_KEY);
      return;
    }
    let oldEntries;
    try { oldEntries = JSON.parse(raw); } catch (e) { localStorage.removeItem(OLD_LS_KEY); return; }

    for (const e of oldEntries) {
      const rec = { ...e };
      if (!rec.private && Array.isArray(rec.images) && rec.images.length) {
        const refs = [];
        for (const dataUrl of rec.images) {
          try {
            const blob = dataURLToBlob(dataUrl);
            const attId = "att_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
            await putAttachment({ id: attId, entryId: rec.id, type: "image", blob, mimeType: blob.type, size: blob.size, createdAt: rec.createdAt, driveFileId: null });
            refs.push({ id: attId, type: "image" });
          } catch (err) { /* skip a bad image rather than fail the whole migration */ }
        }
        rec.attachmentRefs = refs;
        delete rec.images;
      }
      if (rec.deletedAt === undefined) rec.deletedAt = null;
      await put(rec);
    }
    localStorage.removeItem(OLD_LS_KEY);
  }

  return {
    put, remove, getAll, get, bulkPut,
    putAttachment, getAttachment, getAttachmentsByEntry, getAllAttachments, removeAttachment,
    migrateIfNeeded,
  };
})();
