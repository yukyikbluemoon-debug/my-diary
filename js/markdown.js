/* markdown.js — a deliberately tiny formatting layer, not a full Markdown
   parser: bold, italic, bullets, and toggleable checkboxes. Enough for
   diary entries that also want a quick to-do list mixed in. */

const MarkdownLite = (() => {
  function escapeHTML(str) {
    return (str || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function inline(text) {
    let t = escapeHTML(text);
    t = t.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    return t;
  }

  const CHECK_RE = /^\s*-\s*\[( |x|X)\]\s?(.*)$/;
  const BULLET_RE = /^\s*[-*]\s+(.*)$/;

  function render(content) {
    const lines = (content || "").split("\n");
    let html = "";
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
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
        if (l.trim() === "" || CHECK_RE.test(l) || BULLET_RE.test(l)) break;
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

  return { render, toggleCheckboxLine, insertAround, insertLinePrefix };
})();
