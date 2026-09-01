/* db.js — storage layer backed by localStorage.
   Switched from IndexedDB: IndexedDB can silently fail to open in some
   mobile browsers and when the app is opened directly as a file:// page,
   which was causing saves to disappear with no error. localStorage is
   synchronous and works everywhere; API here stays Promise-based so the
   rest of the app (which already uses await) doesn't need to change. */

const DiaryDB = (() => {
  const KEY = "diary_entries_v1";

  function readAll() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error("DiaryDB readAll failed", e);
      return [];
    }
  }

  function writeAll(arr) {
    localStorage.setItem(KEY, JSON.stringify(arr));
  }

  async function put(entry) {
    const all = readAll();
    const idx = all.findIndex((e) => e.id === entry.id);
    if (idx >= 0) all[idx] = entry; else all.push(entry);
    writeAll(all);
    return entry;
  }

  async function remove(id) {
    writeAll(readAll().filter((e) => e.id !== id));
    return true;
  }

  async function getAll() {
    return readAll();
  }

  async function get(id) {
    return readAll().find((e) => e.id === id) || null;
  }

  async function bulkPut(entries) {
    const all = readAll();
    entries.forEach((e) => {
      const idx = all.findIndex((x) => x.id === e.id);
      if (idx >= 0) all[idx] = e; else all.push(e);
    });
    writeAll(all);
    return true;
  }

  return { put, remove, getAll, get, bulkPut };
})();
