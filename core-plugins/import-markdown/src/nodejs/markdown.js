// A small CommonMark subset, written to give identical output to src/php/Markdown.php: ATX headings, paragraphs,
// bullet and numbered lists (one level), blockquotes, fenced code, rules, and inline code, strong, emphasis, links,
// images and autolinks. Raw HTML passes through (core sanitizes page HTML on save). Front matter supplies a title.
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => `\u0000${codes.push(`<code>${esc(c)}</code>`) - 1}\u0000`);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (m, alt, src, t) => `<img src="${src}" alt="${alt}"${t ? ` title="${t}"` : ""}>`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (m, text, href, t) => `<a href="${href}"${t ? ` title="${t}"` : ""}>${text}</a>`);
  s = s.replace(/<(https?:\/\/[^>\s]+)>/g, '<a href="$1">$1</a>');
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (m, a, b) => `<strong>${a ?? b}</strong>`);
  s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)|(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, (m, p1, a, p3, b) => `${p1 ?? p3}<em>${a ?? b}</em>`);
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => codes[Number(i)]);
}

export function markdownToHtml(md) {
  let src = String(md).replace(/\r\n?/g, "\n");
  let title = "";
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (fm) { const t = /^title:\s*["']?(.*?)["']?\s*$/m.exec(fm[1]); if (t) title = t[1]; src = src.slice(fm[0].length); }
  const lines = src.split("\n");
  const out = [];
  let para = [], list = null, quote = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; } };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote>${markdownToHtml(quote.join("\n")).html}</blockquote>`); quote = []; } };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^```\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      flushAll();
      const code = [];
      while (++i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i]);
      out.push(`<pre><code${fence[1] ? ` class="language-${fence[1]}"` : ""}>${esc(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (/^>\s?/.test(line)) { flushPara(); flushList(); quote.push(line.replace(/^>\s?/, "")); continue; }
    flushQuote();
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { flushAll(); out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushAll(); out.push("<hr>"); continue; }
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flushPara();
      const tag = /\d/.test(li[1]) ? "ol" : "ul";
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push(li[2]);
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
    flushList();
    para.push(line.trim());
  }
  flushAll();
  return { html: out.join(""), title };
}
