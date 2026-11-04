// PDF import (Node). Mirrored in src/php/Plugin.php; same lines, same HTML.
// Scope of this draft: text in standard (single-byte) fonts, in content-stream order. Fonts with their own encodings
// (CID fonts with ToUnicode maps, common in PDFs exported from office suites) and scanned pages are not read yet;
// core's current importer (pdfjs) handles those, so the real plugin would vendor it.
import { inflateSync } from "node:zlib";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Decode a PDF literal string body: escapes and octal codes. */
function literal(s) {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3}|\r?\n)/g, (m, e) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" })[e] ?? (/^[0-7]/.test(e) ? String.fromCharCode(parseInt(e, 8)) : ""));
}

/** Text runs { text, size, y } from one content stream. */
function runs(stream) {
  const out = [];
  let size = 12, scale = 1, y = 0, leading = 0;
  const re = /\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>|\[[^\]]*\]|\/[^\s/\[\]()<>]+|-?\d*\.?\d+|[A-Za-z'"*]+/g;
  const stack = [];
  for (const m of stream.matchAll(re)) {
    const t = m[0];
    if (/^-?\d*\.?\d+$/.test(t) || t.startsWith("/") || t.startsWith("(") || t.startsWith("<") || t.startsWith("[")) { stack.push(t); continue; }
    const num = (i) => Number(stack[stack.length - i]);
    const str = (tok) => (tok.startsWith("(") ? literal(tok.slice(1, -1)) : tok.startsWith("<") ? tok.slice(1, -1).replace(/\s/g, "").replace(/../g, (h) => String.fromCharCode(parseInt(h, 16))) : "");
    if (t === "Tf") size = num(1);
    else if (t === "Tm") { scale = Math.abs(num(3)) || 1; y = num(1); }
    else if (t === "Td" || t === "TD") { y += num(1); if (t === "TD") leading = -num(1); }
    else if (t === "TL") leading = num(1);
    else if (t === "T*") y -= leading;
    else if (t === "Tj" || t === "'" || t === '"') { if (t !== "Tj") y -= leading; out.push({ text: str(stack[stack.length - 1] || ""), size: size * scale, y }); }
    else if (t === "TJ") { const arr = stack[stack.length - 1] || "[]"; const text = [...arr.matchAll(/\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]*>|-?\d*\.?\d+/g)].map((x) => (/^-?\d/.test(x[0]) ? (Number(x[0]) < -200 ? " " : "") : str(x[0]))).join(""); out.push({ text, size: size * scale, y }); }
    else if (t === "BT") { y = 0; }
    stack.length = 0;
  }
  return out;
}

export function pdfToHtml(bin) {
  if (!bin.startsWith("%PDF-")) return { error: "not a PDF file" };
  const lines = [];
  for (const m of bin.matchAll(/<<((?:(?!>>)[\s\S])*)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let data = m[2];
    if (/\/Filter\s*\/FlateDecode/.test(m[1])) { try { data = inflateSync(Buffer.from(data, "latin1")).toString("latin1"); } catch { continue; } }
    else if (/\/Filter/.test(m[1])) continue; // images and other encodings
    if (!/\bBT\b/.test(data)) continue;
    for (const r of runs(data)) {
      const last = lines[lines.length - 1];
      if (last && last.y === r.y && last.size === r.size) last.text += r.text; else lines.push({ ...r });
    }
  }
  if (!lines.length) return { error: "no readable text in this PDF (scanned pages and embedded-encoding fonts are not supported yet)" };
  // the most common size (by characters) is body text; larger sizes become h1, h2, h3 from the largest down
  const weight = {};
  for (const l of lines) weight[l.size] = (weight[l.size] || 0) + l.text.length;
  const body = Number(Object.entries(weight).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0][0]);
  const bigger = [...new Set(lines.map((l) => l.size).filter((s) => s > body * 1.15))].sort((a, b) => b - a).slice(0, 3);
  const html = [];
  let para = null, prev = null;
  for (const l of lines) {
    const text = esc(l.text.replace(/\s+/g, " ").trim());
    if (!text) continue;
    const level = bigger.indexOf(l.size);
    if (level >= 0) { if (para) { html.push(`<p>${para}</p>`); para = null; } html.push(`<h${level + 1}>${text}</h${level + 1}>`); prev = l; continue; }
    if (para && prev && prev.size === l.size && prev.y - l.y <= l.size * 1.8) para += ` ${text}`;
    else { if (para) html.push(`<p>${para}</p>`); para = text; }
    prev = l;
  }
  if (para) html.push(`<p>${para}</p>`);
  const title = (/\/Title\s*\(((?:\\.|[^\\)])*)\)/.exec(bin) || [null, ""])[1];
  return { html: html.join(""), ...(title ? { title: literal(title) } : {}) };
}

export default {
  contracts: {
    "import.file": {
      /**
       * Implements contract import.file, operation convert (dispatch: accepts .pdf).
       *
       * Reads the text runs of every content stream (inflating FlateDecode streams), joins them into lines, takes the
       * most common type size as body text and up to three larger sizes as h1 to h3, and returns HTML for core to
       * split into pages.
       *
       * @param {object} ctx    Platform context (spec/13).
       * @param {object} input  { name, data (base64), method, type, parentId }.
       * @returns {Promise<object>}  { html, title? } or { error }.
       */
      async convert(ctx, input) {
        return pdfToHtml(Buffer.from(String(input.data || ""), "base64").toString("latin1"));
      },
    },
  },
};
