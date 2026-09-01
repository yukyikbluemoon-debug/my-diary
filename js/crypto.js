/* crypto.js — passphrase-based encryption for "private" diary entries.
   Nothing here ever stores the passphrase itself. We store:
   - a random salt (for PBKDF2)
   - a "verifier": a known plaintext string encrypted with the derived key,
     used only to check whether a re-entered passphrase is correct.
   The derived CryptoKey lives in memory only (DiaryCrypto.sessionKey) and
   is cleared on lock / page reload — matching "unlock once per session". */

const DiaryCrypto = (() => {
  const VERIFIER_PLAINTEXT = "diary-ok";
  let sessionKey = null; // CryptoKey, only in memory

  function bufToB64(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  }
  function b64ToBuf(b64) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr.buffer;
  }

  async function deriveKey(passphrase, saltB64) {
    const enc = new TextEncoder();
    const salt = b64ToBuf(saltB64);
    const baseKey = await crypto.subtle.importKey(
      "raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function setupPassword(passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltB64 = bufToB64(salt);
    const key = await deriveKey(passphrase, saltB64);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv }, key, enc.encode(VERIFIER_PLAINTEXT)
    );
    localStorage.setItem("diary_pw_salt", saltB64);
    localStorage.setItem("diary_pw_verifier_iv", bufToB64(iv));
    localStorage.setItem("diary_pw_verifier", bufToB64(cipher));
    sessionKey = key;
    return true;
  }

  function hasPassword() {
    return !!localStorage.getItem("diary_pw_salt");
  }

  async function tryUnlock(passphrase) {
    const saltB64 = localStorage.getItem("diary_pw_salt");
    const ivB64 = localStorage.getItem("diary_pw_verifier_iv");
    const cipherB64 = localStorage.getItem("diary_pw_verifier");
    if (!saltB64) return false;
    try {
      const key = await deriveKey(passphrase, saltB64);
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: b64ToBuf(ivB64) }, key, b64ToBuf(cipherB64)
      );
      const text = new TextDecoder().decode(plain);
      if (text === VERIFIER_PLAINTEXT) {
        sessionKey = key;
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  function lock() {
    sessionKey = null;
  }

  function isUnlocked() {
    return !!sessionKey;
  }

  async function encryptJSON(obj) {
    if (!sessionKey) throw new Error("locked");
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv }, sessionKey, enc.encode(JSON.stringify(obj))
    );
    return { iv: bufToB64(iv), data: bufToB64(cipher) };
  }

  async function decryptJSON(payload) {
    if (!sessionKey) throw new Error("locked");
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBuf(payload.iv) }, sessionKey, b64ToBuf(payload.data)
    );
    return JSON.parse(new TextDecoder().decode(plain));
  }

  return {
    setupPassword, hasPassword, tryUnlock, lock, isUnlocked,
    encryptJSON, decryptJSON
  };
})();
