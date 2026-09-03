/* telegram.js — auto-forward non-private entries to a Telegram chat via
   the Bot API (plain fetch, no server needed — Telegram's sendMessage
   endpoint supports CORS from the browser).

   Hard rule, enforced here and only here: a private entry is NEVER sent,
   under any configuration. sendEntry() checks rec.private itself rather
   than trusting the caller, so there's exactly one place this can go wrong. */

const TelegramNotify = (() => {
  const TOKEN_KEY = "diary_telegram_bot_token";
  const CHAT_KEY = "diary_telegram_chat_id";

  function getConfig() {
    return {
      token: localStorage.getItem(TOKEN_KEY) || "",
      chatId: localStorage.getItem(CHAT_KEY) || "",
    };
  }
  function isConfigured() {
    const c = getConfig();
    return !!(c.token && c.chatId);
  }
  function setConfig(token, chatId) {
    localStorage.setItem(TOKEN_KEY, (token || "").trim());
    localStorage.setItem(CHAT_KEY, (chatId || "").trim());
  }
  function clearConfig() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(CHAT_KEY);
  }

  async function sendMessage(text) {
    const { token, chatId } = getConfig();
    if (!token || !chatId) throw new Error("ยังไม่ได้ตั้งค่า Telegram");
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).description || ""; } catch (e) {}
      throw new Error(detail || `Telegram API error ${res.status}`);
    }
    return true;
  }

  async function sendTestMessage() {
    await sendMessage("✅ เชื่อมต่อสมุดบันทึกกับ Telegram สำเร็จแล้ว");
  }

  function buildEntryText(rec, data) {
    const lines = [];
    const typeLabel = rec.entryType === "event"
      ? `📌 เหตุการณ์ · ${rec.eventCategory || ""}`
      : "📝 ไดอารี่";
    lines.push(`${typeLabel} — ${rec.date} ${rec.time} น.`);
    if (data.title) lines.push(data.title);
    if (data.mood) lines.push(data.mood);
    if (data.content) lines.push("", data.content.slice(0, 3000));
    if (data.tags && data.tags.length) lines.push("", "แท็ก: " + data.tags.map((t) => "#" + t).join(" "));
    return lines.join("\n");
  }

  async function sendPhotoBlob(blob, filename) {
    const { token, chatId } = getConfig();
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("photo", blob, filename);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).description || ""; } catch (e) {}
      throw new Error(detail || `Telegram API error ${res.status}`);
    }
  }

  async function sendDocumentBlob(blob, filename) {
    const { token, chatId } = getConfig();
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("document", blob, filename);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form });
    if (!res.ok) {
      let detail = "";
      try { detail = (await res.json()).description || ""; } catch (e) {}
      throw new Error(detail || `Telegram API error ${res.status}`);
    }
  }

  function extFor(mimeType) {
    if (!mimeType) return "bin";
    const map = { "image/jpeg": "jpg", "image/png": "png", "audio/webm": "webm", "audio/mp4": "m4a", "video/webm": "webm", "video/mp4": "mp4" };
    return map[mimeType] || mimeType.split("/")[1] || "bin";
  }

  // Photos/sketches go through sendPhoto (renders inline). Audio/video go
  // through sendDocument rather than sendVoice/sendVideo — those enforce
  // specific codecs (e.g. sendVoice wants OGG/OPUS) and our recordings
  // don't reliably match, so sendDocument (which accepts anything) is the
  // safe choice — still playable/downloadable on the receiving end.
  async function sendAttachments(attachments) {
    if (!attachments || attachments.length === 0) return;
    for (const att of attachments) {
      if (!att.blob) continue;
      const filename = `${att.type}.${extFor(att.blob.type)}`;
      try {
        if (att.type === "image" || att.type === "sketch") {
          await sendPhotoBlob(att.blob, filename);
        } else {
          await sendDocumentBlob(att.blob, filename);
        }
      } catch (err) {
        console.error("Telegram attachment send failed:", err);
        if (typeof showToast === "function") {
          showToast("ส่งไฟล์แนบเข้า Telegram ไม่สำเร็จ: " + (err && err.message ? err.message : ""));
        }
      }
      await new Promise((r) => setTimeout(r, 500)); // stay comfortably under Telegram's rate limit
    }
  }

  async function sendEntry(rec, data, attachments) {
    if (rec.private) return; // hard rule — no exceptions, no config can override this
    if (!isConfigured()) return;
    try {
      await sendMessage(buildEntryText(rec, data));
    } catch (err) {
      console.error("Telegram send failed:", err);
      if (typeof showToast === "function") {
        showToast("ส่งเข้า Telegram ไม่สำเร็จ: " + (err && err.message ? err.message : ""));
      }
      return; // don't try attachments if the text itself failed to send
    }
    await sendAttachments(attachments);
  }

  function isFinanceForwardingEnabled() {
    return localStorage.getItem("diary_telegram_send_finance") !== "0"; // default ON
  }
  function setFinanceForwardingEnabled(on) {
    localStorage.setItem("diary_telegram_send_finance", on ? "1" : "0");
  }

  function formatMoneyPlain(n) {
    return "฿" + Math.abs(n).toLocaleString("th-TH", { maximumFractionDigits: 2 });
  }

  function buildTxText(tx) {
    const typeLabel = tx.type === "income" ? "💰 รายรับ" : tx.type === "expense" ? "💸 รายจ่าย" : "🔁 โอนเงิน";
    const lines = [`${typeLabel} — ${tx.date}`, tx.title];
    if (tx.type === "transfer") {
      lines.push(`${tx.wallet} → ${tx.toWallet}`);
      lines.push(formatMoneyPlain(tx.amount));
    } else {
      const sign = tx.type === "income" ? "+" : "-";
      lines.push(`${sign}${formatMoneyPlain(tx.amount)} [${tx.wallet}]`);
      if (tx.category) lines.push("หมวด: " + tx.category);
    }
    if (tx.note) lines.push("หมายเหตุ: " + tx.note);
    return lines.join("\n");
  }

  async function sendTransaction(tx) {
    if (!isConfigured() || !isFinanceForwardingEnabled()) return;
    try {
      await sendMessage(buildTxText(tx));
    } catch (err) {
      console.error("Telegram transaction send failed:", err);
      if (typeof showToast === "function") {
        showToast("ส่งรายการเงินเข้า Telegram ไม่สำเร็จ: " + (err && err.message ? err.message : ""));
      }
    }
  }

  return {
    getConfig, setConfig, clearConfig, isConfigured, sendMessage, sendTestMessage, sendEntry,
    sendTransaction, isFinanceForwardingEnabled, setFinanceForwardingEnabled, sendAttachments,
  };
})();
