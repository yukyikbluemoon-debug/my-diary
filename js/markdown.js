/* markdown.js — a deliberately tiny formatting layer, not a full Markdown
   parser: bold, italic, bullets, toggleable checkboxes, quotes, and fenced
   code blocks (with a copy button, auto-collapsed past 8 lines). */

const MarkdownLite = (() => {
  const codeRegistry = {};
  let codeCounter = 0;

  function escapeHTML(str) {
    return (str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function inline(text) {
    let t = escapeHTML(text);
    t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    t = autolink(t);
    return t;
  }

  function autolink(text) {
    return text.replace(/(https?:\/\/[^\s<]+)/g, (match) => {
      let url = match;
      let trailing = "";
      const trailChars = ".,!?)]}\"'";
      while (url.length > 0 && trailChars.includes(url[url.length - 1])) {
        trailing = url[url.length - 1] + trailing;
        url = url.slice(0, -1);
      }
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>${trailing}`;
    });
  }

  const CHECK_RE = /^\s*-\s*\[( |x|X)\]\s?(.*)$/;
  const BULLET_RE = /^\s*[-*]\s+(.*)$/;
  const QUOTE_RE = /^\s*>\s?(.*)$/;
  const FENCE_RE = /^```\s*(\S*)\s*$/;

  function renderCodeBlock(codeLines, lang) {
    const id = "mdcode" + (codeCounter++);
    const raw = codeLines.join("\n");
    codeRegistry[id] = raw;
    const header = `<div class="md-code-header"><span class="md-code-lang">${lang ? escapeHTML(lang) : "code"}</span><button type="button" class="code-copy-btn" data-code-id="${id}">📋 คัดลอก</button></div>`;
    const codeHtml = `<pre class="md-code"><code>${escapeHTML(raw)}</code></pre>`;
    if (codeLines.length > 8) {
      return `<div class="md-code-block">${header}<details><summary>${codeLines.length} บรรทัด — กดเพื่อดูโค้ด</summary>${codeHtml}</details></div>`;
    }
    return `<div class="md-code-block">${header}${codeHtml}</div>`;
  }

  function getCodeBlock(id) { return codeRegistry[id] || ""; }

  function render(content) {
    const lines = (content || "").split("\n");
    let html = "";
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      const fenceMatch = FENCE_RE.exec(line);
      if (fenceMatch) {
        const lang = fenceMatch[1];
        const codeLines = [];
        i++;
        while (i < lines.length && !FENCE_RE.test(lines[i])) { codeLines.push(lines[i]); i++; }
        if (i < lines.length) i++; // consume closing fence
        html += renderCodeBlock(codeLines, lang);
        continue;
      }

      const quoteMatch = QUOTE_RE.exec(line);
      if (quoteMatch) {
        const quoteLines = [];
        while (i < lines.length) {
          const qm = QUOTE_RE.exec(lines[i]);
          if (!qm) break;
          quoteLines.push(qm[1]);
          i++;
        }
        html += `<blockquote class="md-quote"><p>${quoteLines.map(inline).join("<br>")}</p></blockquote>`;
        continue;
      }

      const checkMatch = CHECK_RE.exec(line);
      const bulletMatch = !checkMatch && BULLET_RE.exec(line);
      if (checkMatch || bulletMatch) {
        html += '<div class="md-list">';
        while (i < lines.length) {
          const l = lines[i];
          const cm = CHECK_RE.exec(l);
          const bm = !cm && BULLET_RE.exec(l);
          if (cm) {
            const checked = cm[1].toLowerCase() === "x";
            html += `<div class="md-check${checked ? " checked" : ""}"><input type="checkbox" data-line="${i}" ${checked ? "checked" : ""}><span>${inline(cm[2])}</span></div>`;
          } else if (bm) {
            html += `<div class="md-bullet">${inline(bm[1])}</div>`;
          } else break;
          i++;
        }
        html += "</div>";
        continue;
      }

      if (line.trim() === "") { i++; continue; }

      const paraLines = [];
      while (i < lines.length) {
        const l = lines[i];
        if (l.trim() === "" || CHECK_RE.test(l) || BULLET_RE.test(l) || QUOTE_RE.test(l) || FENCE_RE.test(l)) break;
        paraLines.push(l);
        i++;
      }
      html += `<p>${paraLines.map(inline).join("<br>")}</p>`;
    }
    return html;
  }

  function toggleCheckboxLine(content, lineIndex) {
    const lines = content.split("\n");
    const line = lines[lineIndex];
    if (line == null) return content;
    if (/\[\s\]/.test(line)) lines[lineIndex] = line.replace(/\[\s\]/, "[x]");
    else if (/\[[xX]\]/.test(line)) lines[lineIndex] = line.replace(/\[[xX]\]/, "[ ]");
    return lines.join("\n");
  }

  function insertAround(textarea, before, after, placeholder) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const selected = value.slice(start, end) || placeholder || "";
    textarea.value = value.slice(0, start) + before + selected + after + value.slice(end);
    const cursorPos = start + before.length + selected.length + after.length;
    textarea.focus();
    textarea.setSelectionRange(cursorPos, cursorPos);
  }

  function insertLinePrefix(textarea, prefix) {
    const start = textarea.selectionStart;
    const value = textarea.value;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    textarea.value = value.slice(0, lineStart) + prefix + value.slice(lineStart);
    const cursorPos = start + prefix.length;
    textarea.focus();
    textarea.setSelectionRange(cursorPos, cursorPos);
  }

  function insertCodeFence(textarea) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const selected = value.slice(start, end);
    const block = "```\n" + (selected || "") + "\n```";
    textarea.value = value.slice(0, start) + block + value.slice(end);
    const cursorPos = selected ? start + block.length : start + 4;
    textarea.focus();
    textarea.setSelectionRange(cursorPos, cursorPos);
  }

  return { render, toggleCheckboxLine, insertAround, insertLinePrefix, insertCodeFence, getCodeBlock };
})();
