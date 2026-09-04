/* db.js — storage layer backed by IndexedDB.
   Object stores:
   - "entries": diary entry records (metadata + text; for private entries,
     everything content-related is inside an encrypted blob, as before)
   - "attachments": binary blobs (photos, sketches, voice notes, video
     clips) for NON-private entries, referenced by id from entry.attachmentRefs.
     Private-entry media stays inline as base64 inside the encrypted
     payload (same mechanism as before) — simplest way to guarantee it's
     covered by encryption regardless of media type.
   - "transactions": finance module records (income/expense/transfer).
     Wallet/category lists themselves live in localStorage (see finance.js)
     since they're small config lists, not growing record data.
   - "bank_accounts" / "debts" / "other_info": Banking & Liabilities module
     records (see banking.js). None of this is encrypted (by explicit
     request, to remove decrypt-failure/unlock friction) — unlike private
     diary entries, which are unaffected and still fully encrypt via
     DiaryCrypto.

   Now that the app runs on a real https:// origin (GitHub Pages) instead
   of file://, IndexedDB is reliable again and gives us a much bigger
   storage ceiling than localStorage (which we used temporarily while the
   app was only reachable as a local file). On first run, any old data
   left in localStorage from that period is migrated in automatically. */

const DiaryDB = (() => {
  const DB_NAME = "diary_db_v2";
  const DB_VERSION = 4;
  const ENTRIES_STORE = "entries";
  const ATTACH_STORE = "attachments";
  const TX_STORE = "transactions";
  const ASSET_STORE = "assets";
  const BANK_STORE = "bank_accounts";
  const DEBT_STORE = "debts";
  const OTHER_STORE = "other_info";
  const OLD_LS_KEY = "diary_entries_v1";

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      let settled = false;

      // If another tab/window still has this database open at an older
      // version, the browser silently blocks this open() request forever
      // (no error, no event) until that other connection closes. Without
      // a timeout, every DB call in the app (including sync) just hangs
      // with no feedback — which is exactly what happened after the
      // schema change in v2.5.0. Surface it instead of hanging silently.
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        dbPromise = null;
        reject(new Error("เปิดฐานข้อมูลไม่สำเร็จ — อาจมีแท็บ/หน้าต่างอื่นของแอปนี้เปิดค้างอยู่ ลองปิดแท็บ/หน้าต่างอื่นทั้งหมดแล้วเปิดแอปใหม่อีกครั้ง"));
      }, 8000);

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
        if (!db.objectStoreNames.contains(TX_STORE)) {
          const s = db.createObjectStore(TX_STORE, { keyPath: "id" });
          s.createIndex("date", "date", { unique: false });
        }
        if (!db.objectStoreNames.contains(ASSET_STORE)) {
          db.createObjectStore(ASSET_STORE, { keyPath: "id" });
        }
        // v4: Banking & Liabilities module (bank accounts, debts, other
        // sensitive records like insurance/membership numbers). Every
        // record here is stored fully encrypted (encIv/encData, same
        // mechanism as private diary entries) — unlike transactions/assets,
        // there's no "public" variant, so no extra index is needed beyond
        // the id itself.
        if (!db.objectStoreNames.contains(BANK_STORE)) {
          db.createObjectStore(BANK_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(DEBT_STORE)) {
          db.createObjectStore(DEBT_STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(OTHER_STORE)) {
          db.createObjectStore(OTHER_STORE, { keyPath: "id" });
        }
      };
      req.onblocked = () => {
        console.error("DiaryDB open() blocked by another open connection (likely another tab).");
      };
      req.onsuccess = () => {
        if (settled) { req.result.close(); return; } // timed out already; don't leak the late connection
        settled = true;
        clearTimeout(timeoutId);
        const db = req.result;
        // If a newer version tries to open elsewhere later, release our
        // lock immediately instead of blocking it the same way.
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        dbPromise = null;
        reject(req.error);
      };
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

  /* ---------- transactions (finance module) ---------- */

  async function putTransaction(tx) {
    const store = await storeTx(TX_STORE, "readwrite");
    await reqToPromise(store.put(tx));
    return tx;
  }

  async function removeTransaction(id) {
    const store = await storeTx(TX_STORE, "readwrite");
    await reqToPromise(store.delete(id));
    return true;
  }

  async function getAllTransactions() {
    const store = await storeTx(TX_STORE, "readonly");
    return reqToPromise(store.getAll());
  }

  async function getTransaction(id) {
    const store = await storeTx(TX_STORE, "readonly");
    const res = await reqToPromise(store.get(id));
    return res || null;
  }

  async function bulkPutTransactions(txs) {
    const store = await storeTx(TX_STORE, "readwrite");
    return new Promise((resolve, reject) => {
      txs.forEach((t) => store.put(t));
      store.transaction.oncomplete = () => resolve(true);
      store.transaction.onerror = () => reject(store.transaction.error);
    });
  }

  /* ---------- assets (finance module) ---------- */

  async function putAsset(asset) {
    const store = await storeTx(ASSET_STORE, "readwrite");
    await reqToPromise(store.put(asset));
    return asset;
  }
  async function getAllAssets() {
    const store = await storeTx(ASSET_STORE, "readonly");
    return reqToPromise(store.getAll());
  }
  async function bulkPutAssets(assets) {
    const store = await storeTx(ASSET_STORE, "readwrite");
    return new Promise((resolve, reject) => {
      assets.forEach((a) => store.put(a));
      store.transaction.oncomplete = () => resolve(true);
      store.transaction.onerror = () => reject(store.transaction.error);
    });
  }

  /* ---------- banking & liabilities (bank accounts / debts / other) ---------- */

  async function putBankAccount(rec) {
    const store = await storeTx(BANK_STORE, "readwrite");
    await reqToPromise(store.put(rec));
    return rec;
  }
  async function getAllBankAccounts() {
    const store = await storeTx(BANK_STORE, "readonly");
    return reqToPromise(store.getAll());
  }
  async function bulkPutBankAccounts(recs) {
    const store = await storeTx(BANK_STORE, "readwrite");
    return new Promise((resolve, reject) => {
      recs.forEach((r) => store.put(r));
      store.transaction.oncomplete = () => resolve(true);
      store.transaction.onerror = () => reject(store.transaction.error);
    });
  }

  async function putDebt(rec) {
    const store = await storeTx(DEBT_STORE, "readwrite");
    await reqToPromise(store.put(rec));
    return rec;
  }
  async function getAllDebts() {
    const store = await storeTx(DEBT_STORE, "readonly");
    return reqToPromise(store.getAll());
  }
  async function bulkPutDebts(recs) {
    const store = await storeTx(DEBT_STORE, "readwrite");
    return new Promise((resolve, reject) => {
      recs.forEach((r) => store.put(r));
      store.transaction.oncomplete = () => resolve(true);
      store.transaction.onerror = () => reject(store.transaction.error);
    });
  }

  async function putOtherInfo(rec) {
    const store = await storeTx(OTHER_STORE, "readwrite");
    await reqToPromise(store.put(rec));
    return rec;
  }
  async function getAllOtherInfo() {
    const store = await storeTx(OTHER_STORE, "readonly");
    return reqToPromise(store.getAll());
  }
  async function bulkPutOtherInfo(recs) {
    const store = await storeTx(OTHER_STORE, "readwrite");
    return new Promise((resolve, reject) => {
      recs.forEach((r) => store.put(r));
      store.transaction.oncomplete = () => resolve(true);
      store.transaction.onerror = () => reject(store.transaction.error);
    });
  }

  return {
    put, remove, getAll, get, bulkPut,
    putAttachment, getAttachment, getAttachmentsByEntry, getAllAttachments, removeAttachment,
    putTransaction, removeTransaction, getAllTransactions, getTransaction, bulkPutTransactions,
    putAsset, getAllAssets, bulkPutAssets,
    putBankAccount, getAllBankAccounts, bulkPutBankAccounts,
    putDebt, getAllDebts, bulkPutDebts,
    putOtherInfo, getAllOtherInfo, bulkPutOtherInfo,
    migrateIfNeeded,
  };
})();
