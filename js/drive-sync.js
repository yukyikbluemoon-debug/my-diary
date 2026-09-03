/* drive-sync.js — manual "sync now" against Google Drive, using the
   drive.file scope (the app can only ever see files it created).

   Layout on Drive:
   - "diary-data.json"     — one JSON file: all entries + an index that
                             maps each non-private attachment id to the
                             Drive file that holds its actual bytes.
   - "diary-attach-<id>"   — one file per non-private attachment (photo,
                             voice note, video clip, sketch).
   Private-entry media never gets a separate Drive file — it travels
   as base64 inside that entry's already-encrypted blob, inside
   diary-data.json, same as before. */

const DriveSync = (() => {
  const SCOPE = "https://www.googleapis.com/auth/drive.file";
  const FILE_NAME = "diary-data.json";
  let tokenClient = null;
  let accessToken = null;
  let fileId = localStorage.getItem("diary_drive_file_id") || null;

  function gisReady() {
    return typeof google !== "undefined" && google.accounts && google.accounts.oauth2;
  }

  function getTokenClient() {
    if (tokenClient) return tokenClient;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: DRIVE_CLIENT_ID,
      scope: SCOPE,
      callback: () => {},
    });
    return tokenClient;
  }

  function requestAccessToken() {
    return new Promise((resolve, reject) => {
      if (!DRIVE_CLIENT_ID || DRIVE_CLIENT_ID.includes("PASTE_YOUR")) {
        reject(new Error("ยังไม่ได้ตั้งค่า Google Client ID ใน js/drive-config.js"));
        return;
      }
      if (!gisReady()) {
        reject(new Error("โหลด Google Sign-In ไม่สำเร็จ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่"));
        return;
      }
      const client = getTokenClient();
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("หมดเวลารอการเข้าสู่ระบบ Google — เช็คว่าป๊อปอัพถูกบล็อกไหม หรือบัญชีนี้ยังไม่ได้เพิ่มเป็น Test user"));
      }, 45000);
      client.callback = (resp) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (resp.error) { reject(new Error(resp.error)); return; }
        accessToken = resp.access_token;
        resolve(accessToken);
      };
      client.requestAccessToken({ prompt: "" });
    });
  }

  async function authedFetch(url, options = {}) {
    if (!accessToken) await requestAccessToken();
    let res = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 401) {
      accessToken = null;
      await requestAccessToken();
      res = await fetch(url, {
        ...options,
        headers: { ...(options.headers || {}), Authorization: `Bearer ${accessToken}` },
      });
    }
    return res;
  }

  async function findFileId() {
    if (fileId) return fileId;
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const res = await authedFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive&fields=files(id,name)`);
    if (!res.ok) throw new Error("ค้นหาไฟล์บน Drive ไม่สำเร็จ");
    const data = await res.json();
    if (data.files && data.files.length) {
      fileId = data.files[0].id;
      localStorage.setItem("diary_drive_file_id", fileId);
    }
    return fileId;
  }

  async function downloadRemote() {
    const id = await findFileId();
    if (!id) return null;
    const res = await authedFetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
    if (!res.ok) throw new Error("ดาวน์โหลดจาก Drive ไม่สำเร็จ");
    return res.json();
  }

  async function uploadRemote(dataObj) {
    const body = JSON.stringify(dataObj);
    const id = await findFileId();
    if (id) {
      const res = await authedFetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!res.ok) throw new Error("อัปโหลดไป Drive ไม่สำเร็จ");
      return id;
    }
    const created = await uploadNewFile(FILE_NAME, new Blob([body], { type: "application/json" }));
    fileId = created;
    localStorage.setItem("diary_drive_file_id", fileId);
    return fileId;
  }

  // generic: create a brand-new Drive file (used for both diary-data.json's
  // first creation and every attachment file) via multipart upload.
  async function uploadNewFile(name, blob) {
    const boundary = "diaryAppBoundary";
    const metadata = { name, mimeType: blob.type || "application/octet-stream" };
    const blobBuf = await blob.arrayBuffer();
    const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`;
    const endPart = `\r\n--${boundary}--`;
    const body = new Blob([metaPart, blobBuf, endPart]);
    const res = await authedFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    if (!res.ok) throw new Error(`อัปโหลดไฟล์ "${name}" ไป Drive ไม่สำเร็จ`);
    const data = await res.json();
    return data.id;
  }

  async function downloadAttachmentBlob(driveFileId) {
    const res = await authedFetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`);
    if (!res.ok) throw new Error("ดาวน์โหลดไฟล์แนบจาก Drive ไม่สำเร็จ");
    return res.blob();
  }

  // last-write-wins merge by updatedAt, keyed by entry id
  function mergeEntries(localEntries, remoteEntries) {
    const map = new Map();
    (remoteEntries || []).forEach((e) => map.set(e.id, e));
    (localEntries || []).forEach((e) => {
      const r = map.get(e.id);
      if (!r || new Date(e.updatedAt) > new Date(r.updatedAt)) map.set(e.id, e);
    });
    return [...map.values()];
  }

  async function syncAttachments(mergedEntries) {
    // 1) figure out the total pending count first, so progress toasts can
    // say "X/Y" instead of just a running count with no sense of how much
    // is left.
    const pending = [];
    for (const entry of mergedEntries) {
      if (entry.private || entry.deletedAt || !entry.attachmentRefs) continue;
      for (const ref of entry.attachmentRefs) {
        const att = await DiaryDB.getAttachment(ref.id);
        if (att && att.blob && !att.driveFileId) pending.push(att);
      }
    }
    let uploadedCount = 0;
    const total = pending.length;
    for (const att of pending) {
      try {
        if (typeof showToast === "function") showToast(`กำลังอัปโหลดไฟล์แนบ ${uploadedCount + 1}/${total}...`);
        const driveFileId = await uploadNewFile(`diary-attach-${att.id}`, att.blob);
        att.driveFileId = driveFileId;
        await DiaryDB.putAttachment(att);
        uploadedCount++;
      } catch (err) {
        // don't fail the whole sync over one attachment; it'll retry next sync
        console.error("Attachment upload failed:", err);
      }
    }
    // 2) build the index of everything we can point another device to
    const allLocal = await DiaryDB.getAllAttachments();
    const index = allLocal
      .filter((a) => a.driveFileId)
      .map((a) => ({ id: a.id, entryId: a.entryId, type: a.type, mimeType: a.mimeType, driveFileId: a.driveFileId }));
    return { index, uploadedCount };
  }

  async function adoptRemoteAttachmentIndex(remoteIndex) {
    for (const meta of remoteIndex || []) {
      const existing = await DiaryDB.getAttachment(meta.id);
      if (!existing) {
        await DiaryDB.putAttachment({
          id: meta.id, entryId: meta.entryId, type: meta.type, mimeType: meta.mimeType,
          blob: null, size: 0, createdAt: new Date().toISOString(), driveFileId: meta.driveFileId,
        });
      } else if (!existing.driveFileId && meta.driveFileId) {
        existing.driveFileId = meta.driveFileId;
        await DiaryDB.putAttachment(existing);
      }
    }
  }

  function toast(msg) {
    if (typeof showToast === "function") showToast(msg);
  }

  async function sync() {
    toast("กำลังเชื่อมต่อ Google...");
    await requestAccessToken();
    const local = await DiaryDB.getAll();
    const localTx = await DiaryDB.getAllTransactions();
    const localAssets = await DiaryDB.getAllAssets();
    const localBanks = await DiaryDB.getAllBankAccounts();
    const localDebts = await DiaryDB.getAllDebts();
    const localOther = await DiaryDB.getAllOtherInfo();
    toast("กำลังดาวน์โหลดข้อมูลจาก Drive...");
    let remoteObj = null;
    try { remoteObj = await downloadRemote(); } catch (e) { remoteObj = null; }
    const remoteEntries = (remoteObj && remoteObj.entries) || [];
    const remoteTx = (remoteObj && remoteObj.transactions) || [];
    const remoteAssets = (remoteObj && remoteObj.assets) || [];
    const remoteBanks = (remoteObj && remoteObj.bankAccounts) || [];
    const remoteDebts = (remoteObj && remoteObj.debts) || [];
    const remoteOther = (remoteObj && remoteObj.otherInfo) || [];
    const merged = mergeEntries(local, remoteEntries);
    const mergedTx = mergeEntries(localTx, remoteTx); // same last-write-wins-by-updatedAt logic works for transactions too
    const mergedAssets = mergeEntries(localAssets, remoteAssets); // ...and for assets too
    // ...and for the (fully encrypted) Banking & Liabilities records too — Drive
    // only ever sees {id, kind, timestamps, encIv, encData}, same as it does
    // today for private diary entries.
    const mergedBanks = mergeEntries(localBanks, remoteBanks);
    const mergedDebts = mergeEntries(localDebts, remoteDebts);
    const mergedOther = mergeEntries(localOther, remoteOther);
    await DiaryDB.bulkPut(merged);
    await DiaryDB.bulkPutTransactions(mergedTx);
    await DiaryDB.bulkPutAssets(mergedAssets);
    await DiaryDB.bulkPutBankAccounts(mergedBanks);
    await DiaryDB.bulkPutDebts(mergedDebts);
    await DiaryDB.bulkPutOtherInfo(mergedOther);

    await adoptRemoteAttachmentIndex(remoteObj && remoteObj.attachmentIndex);
    const { index: attachmentIndex, uploadedCount } = await syncAttachments(merged);
    if (uploadedCount > 0) toast(`อัปโหลดไฟล์แนบเสร็จ ${uploadedCount} ไฟล์`);

    toast("กำลังบันทึกข้อมูลขึ้น Drive...");
    await uploadRemote({
      version: 5, syncedAt: new Date().toISOString(), entries: merged, transactions: mergedTx, assets: mergedAssets,
      bankAccounts: mergedBanks, debts: mergedDebts, otherInfo: mergedOther, attachmentIndex,
    });
    localStorage.setItem("diary_last_synced", new Date().toISOString());
    return merged.length + mergedTx.length + mergedAssets.length + mergedBanks.length + mergedDebts.length + mergedOther.length;
  }

  function lastSyncedText() {
    const t = localStorage.getItem("diary_last_synced");
    return t ? new Date(t).toLocaleString("th-TH") : "ยังไม่เคยซิงค์";
  }

  return { sync, lastSyncedText, downloadAttachmentBlob };
})();
