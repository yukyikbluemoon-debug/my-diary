/* drive-sync.js — manual "sync now" against a single JSON file in the
   user's own Google Drive, using the drive.file scope (the app can only
   ever see files it created — nothing else in the user's Drive). */

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
      callback: () => {}, // set per-call below
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
    const boundary = "diaryAppBoundary";
    const metadata = { name: FILE_NAME, mimeType: "application/json" };
    const multipartBody =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
    const res = await authedFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: multipartBody,
    });
    if (!res.ok) throw new Error("สร้างไฟล์บน Drive ไม่สำเร็จ");
    const data = await res.json();
    fileId = data.id;
    localStorage.setItem("diary_drive_file_id", fileId);
    return fileId;
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

  async function sync() {
    await requestAccessToken();
    const local = await DiaryDB.getAll();
    let remoteObj = null;
    try { remoteObj = await downloadRemote(); } catch (e) { remoteObj = null; }
    const remoteEntries = (remoteObj && remoteObj.entries) || [];
    const merged = mergeEntries(local, remoteEntries);
    await DiaryDB.bulkPut(merged);
    await uploadRemote({ version: 1, syncedAt: new Date().toISOString(), entries: merged });
    localStorage.setItem("diary_last_synced", new Date().toISOString());
    return merged.length;
  }

  function lastSyncedText() {
    const t = localStorage.getItem("diary_last_synced");
    return t ? new Date(t).toLocaleString("th-TH") : "ยังไม่เคยซิงค์";
  }

  return { sync, lastSyncedText };
})();
