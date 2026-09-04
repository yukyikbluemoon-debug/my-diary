/* statement.js — a combined "statement" of every transaction across every
   wallet (cash + all bank accounts), in chronological order, for a chosen
   date range. Four export paths:
     1. Download CSV        — pure JS, no dependencies, always reliable.
     2. Download PDF (print) — uses the browser's own print-to-PDF via a
        dedicated print stylesheet. 100% reliable Thai text (the OS/browser
        renders it), but requires the user to manually "Save as PDF" from
        the print dialog — there's no JS-side file to attach to Telegram.
     3. Send CSV to Telegram  — same CSV, sent as a document attachment.
     4. Send PDF to Telegram  — a real jsPDF-generated PDF with the Sarabun
        Thai font embedded (see thai-font.js), sent as a document
        attachment. jsPDF + jspdf-autotable + thai-font.js are all loaded
        lazily, only the first time this specific action is used, since
        together they're a few hundred KB — not something every page load
        should pay for. */

const Statement = (() => {
  let pdfLibsPromise = null;

  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("โหลดไม่สำเร็จ: " + src));
      document.head.appendChild(s);
    });
  }

  // Tries each URL in order until one actually loads — a single CDN being
  // blocked/down/slow on someone's network (ad-blocker, carrier proxy,
  // outage) shouldn't be a hard failure when a mirror would work fine.
  async function loadScriptWithFallback(urls) {
    let lastErr = null;
    for (const url of urls) {
      try { await loadScriptOnce(url); return; }
      catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("โหลดไลบรารีไม่สำเร็จ");
  }

  function ensurePdfLibsLoaded() {
    if (!pdfLibsPromise) {
      pdfLibsPromise = (async () => {
        await loadScriptWithFallback([
          "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js",
          "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js",
          "https://unpkg.com/jspdf@2.5.2/dist/jspdf.umd.min.js",
        ]);
        await loadScriptWithFallback([
          "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js",
          "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
          "https://unpkg.com/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js",
        ]);
        await loadScriptOnce("js/thai-font.js");
      })().catch((err) => {
        pdfLibsPromise = null; // let the next attempt retry from scratch instead of staying permanently broken
        throw err;
      });
    }
    return pdfLibsPromise;
  }

  /* ---------------- row building (shared by every export format) ---------------- */

  function buildRows(fromDate, toDate) {
    const txs = Finance.getTransactionsInRange(fromDate, toDate);
    return txs.map((t) => {
      const isTransfer = t.type === "transfer";
      const typeLabel = t.type === "income" ? "รับ" : t.type === "expense" ? "จ่าย" : "โอน";
      const walletText = isTransfer
        ? `${Finance.walletLabel(t.wallet)} → ${Finance.walletLabel(t.toWallet)}`
        : Finance.walletLabel(t.wallet);
      return {
        date: t.date,
        time: t.time || "",
        title: t.title || "",
        typeLabel,
        walletText,
        category: isTransfer ? "" : (t.category || ""),
        income: t.type === "income" ? t.amount : null,
        expense: t.type === "expense" ? t.amount : null,
        note: t.note || "",
      };
    });
  }

  function computeTotals(rows) {
    let income = 0, expense = 0;
    rows.forEach((r) => { income += r.income || 0; expense += r.expense || 0; });
    return { income, expense, net: income - expense };
  }

  function rangeLabel(fromDate, toDate) {
    return `${formatFullThaiDate(fromDate)} ถึง ${formatFullThaiDate(toDate)}`;
  }

  /* ---------------- CSV ---------------- */

  function csvEscape(v) {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function buildCsv(rows) {
    const header = ["วันที่", "เวลา", "รายการ", "ประเภท", "แหล่งเงิน", "หมวดหมู่", "รับ", "จ่าย", "หมายเหตุ"];
    const lines = [header.map(csvEscape).join(",")];
    rows.forEach((r) => {
      lines.push([
        r.date, r.time, r.title, r.typeLabel, r.walletText, r.category,
        r.income !== null ? r.income : "", r.expense !== null ? r.expense : "", r.note,
      ].map(csvEscape).join(","));
    });
    const totals = computeTotals(rows);
    lines.push(["", "", "", "", "", "รวม", totals.income, totals.expense, ""].map(csvEscape).join(","));
    // Leading BOM so Excel opens this as UTF-8 and Thai text isn't garbled.
    return "\uFEFF" + lines.join("\r\n");
  }

  function downloadCsv() {
    const { from, to } = getSelectedRange();
    if (!from || !to) { showToast("กรุณาเลือกช่วงวันที่"); return; }
    const rows = buildRows(from, to);
    if (rows.length === 0) { showToast("ไม่มีธุรกรรมในช่วงที่เลือก"); return; }
    const csv = buildCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `statement-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    showToast("ดาวน์โหลด CSV แล้ว");
  }

  async function sendCsvToTelegram() {
    if (typeof TelegramNotify === "undefined" || !TelegramNotify.isConfigured()) {
      showToast("ยังไม่ได้ตั้งค่า Telegram (ตั้งค่า → Telegram)");
      return;
    }
    const { from, to } = getSelectedRange();
    if (!from || !to) { showToast("กรุณาเลือกช่วงวันที่"); return; }
    const rows = buildRows(from, to);
    if (rows.length === 0) { showToast("ไม่มีธุรกรรมในช่วงที่เลือก"); return; }
    const csv = buildCsv(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    try {
      await TelegramNotify.sendDocument(blob, `statement-${from}-to-${to}.csv`, `📊 Statement — ${rangeLabel(from, to)}`);
      showToast("ส่ง CSV เข้า Telegram แล้ว");
    } catch (err) {
      showToast("ส่งไม่สำเร็จ: " + (err && err.message ? err.message : ""));
    }
  }

  /* ---------------- PDF via browser print ---------------- */

  function formatFullMoney(n) {
    return (n || 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function downloadPdfViaPrint() {
    const { from, to } = getSelectedRange();
    if (!from || !to) { showToast("กรุณาเลือกช่วงวันที่"); return; }
    const rows = buildRows(from, to);
    if (rows.length === 0) { showToast("ไม่มีธุรกรรมในช่วงที่เลือก"); return; }
    const totals = computeTotals(rows);

    const rowsHtml = rows.map((r) => `
      <tr>
        <td>${escapeHTML(r.date)}</td>
        <td>${escapeHTML(r.time)}</td>
        <td>${escapeHTML(r.title)}</td>
        <td>${escapeHTML(r.typeLabel)}</td>
        <td>${escapeHTML(r.walletText)}</td>
        <td>${escapeHTML(r.category)}</td>
        <td class="num">${r.income !== null ? formatFullMoney(r.income) : ""}</td>
        <td class="num">${r.expense !== null ? formatFullMoney(r.expense) : ""}</td>
        <td>${escapeHTML(r.note)}</td>
      </tr>`).join("");

    $("printStatementArea").innerHTML = `
      <h1>Statement</h1>
      <p>${escapeHTML(rangeLabel(from, to))} · พิมพ์เมื่อ ${escapeHTML(formatFullThaiDate(todayISO()))}</p>
      <table>
        <thead><tr>
          <th>วันที่</th><th>เวลา</th><th>รายการ</th><th>ประเภท</th><th>แหล่งเงิน</th><th>หมวดหมู่</th><th>รับ</th><th>จ่าย</th><th>หมายเหตุ</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr>
          <td colspan="6">รวม</td>
          <td class="num">${formatFullMoney(totals.income)}</td>
          <td class="num">${formatFullMoney(totals.expense)}</td>
          <td></td>
        </tr></tfoot>
      </table>`;
    window.print();
  }

  /* ---------------- PDF via jsPDF (real file, Telegram-sendable) ---------------- */

  async function buildPdfBlob(rows, from, to) {
    await ensurePdfLibsLoaded();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: "landscape" });
    doc.addFileToVFS("Sarabun-Regular.ttf", ThaiFontData.regular);
    doc.addFont("Sarabun-Regular.ttf", "Sarabun", "normal");
    doc.addFileToVFS("Sarabun-Bold.ttf", ThaiFontData.bold);
    doc.addFont("Sarabun-Bold.ttf", "Sarabun", "bold");
    doc.setFont("Sarabun", "bold");
    doc.setFontSize(14);
    doc.text("Statement", 14, 15);
    doc.setFont("Sarabun", "normal");
    doc.setFontSize(10);
    doc.text(rangeLabel(from, to), 14, 22);

    const totals = computeTotals(rows);
    doc.autoTable({
      startY: 27,
      head: [["วันที่", "เวลา", "รายการ", "ประเภท", "แหล่งเงิน", "หมวดหมู่", "รับ", "จ่าย", "หมายเหตุ"]],
      body: rows.map((r) => [
        r.date, r.time, r.title, r.typeLabel, r.walletText, r.category,
        r.income !== null ? formatFullMoney(r.income) : "",
        r.expense !== null ? formatFullMoney(r.expense) : "",
        r.note,
      ]),
      foot: [["", "", "", "", "", "รวม", formatFullMoney(totals.income), formatFullMoney(totals.expense), ""]],
      styles: { font: "Sarabun", fontSize: 8, cellPadding: 2 },
      headStyles: { font: "Sarabun", fontStyle: "bold", fillColor: [58, 42, 46] },
      footStyles: { font: "Sarabun", fontStyle: "bold", fillColor: [230, 226, 220], textColor: [30, 30, 30] },
      columnStyles: { 6: { halign: "right" }, 7: { halign: "right" } },
    });
    return doc.output("blob");
  }

  async function sendPdfToTelegram() {
    if (typeof TelegramNotify === "undefined" || !TelegramNotify.isConfigured()) {
      showToast("ยังไม่ได้ตั้งค่า Telegram (ตั้งค่า → Telegram)");
      return;
    }
    const { from, to } = getSelectedRange();
    if (!from || !to) { showToast("กรุณาเลือกช่วงวันที่"); return; }
    const rows = buildRows(from, to);
    if (rows.length === 0) { showToast("ไม่มีธุรกรรมในช่วงที่เลือก"); return; }
    showToast("กำลังสร้าง PDF...");
    try {
      const blob = await buildPdfBlob(rows, from, to);
      await TelegramNotify.sendDocument(blob, `statement-${from}-to-${to}.pdf`, `📊 Statement — ${rangeLabel(from, to)}`);
      showToast("ส่ง PDF เข้า Telegram แล้ว");
    } catch (err) {
      console.error(err);
      showToast("สร้าง/ส่ง PDF ไม่สำเร็จ: " + (err && err.message ? err.message : ""));
    }
  }

  /* ---------------- modal + date range ---------------- */

  function getSelectedRange() {
    return { from: $("stmtFromDateValue").value, to: $("stmtToDateValue").value };
  }

  function setDate(fieldPrefix, dateStr) {
    $(fieldPrefix + "Value").value = dateStr;
    $(fieldPrefix + "Btn").textContent = formatFullThaiDate(dateStr);
  }

  function openStatementModal() {
    const today = todayISO();
    const firstOfMonth = today.slice(0, 8) + "01";
    if (!$("stmtFromDateValue").value) setDate("stmtFromDate", firstOfMonth);
    if (!$("stmtToDateValue").value) setDate("stmtToDate", today);
    $("statementModal").hidden = false;
    pushNavState("statement");
  }
  function closeStatementModalVisual() { $("statementModal").hidden = true; }
  function closeStatementModal() { closeStatementModalVisual(); popNavState(); }

  function wireEvents() {
    $("openStatementBtn").addEventListener("click", openStatementModal);
    $("statementCloseBtn").addEventListener("click", closeStatementModal);
    $("stmtFromDateBtn").addEventListener("click", () => {
      openCalendarForPick($("stmtFromDateValue").value || todayISO(), (d) => setDate("stmtFromDate", d));
    });
    $("stmtToDateBtn").addEventListener("click", () => {
      openCalendarForPick($("stmtToDateValue").value || todayISO(), (d) => setDate("stmtToDate", d));
    });
    $("stmtDownloadCsvBtn").addEventListener("click", downloadCsv);
    $("stmtSendCsvBtn").addEventListener("click", sendCsvToTelegram);
    $("stmtDownloadPdfBtn").addEventListener("click", downloadPdfViaPrint);
    $("stmtSendPdfBtn").addEventListener("click", sendPdfToTelegram);
  }

  function init() { wireEvents(); }

  return { init, closeStatementModalVisual };
})();
