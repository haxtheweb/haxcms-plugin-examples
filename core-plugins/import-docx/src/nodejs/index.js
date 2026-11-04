// Word import (Node). Mirrored in src/php/Plugin.php; both produce the same HTML.
// A .docx is a zip of XML. ctx.archive.read gives us the parts; we read them with regular expressions (no DOM in
// either runtime, so both parse identically). Images are not carried over yet (core's mammoth path inlines them).

const PARTS = "^(word/document\\.xml|word/numbering\\.xml|word/_rels/document\\.xml\\.rels|docProps/core\\.xml)$";
const attr = (xml, name) => { const m = new RegExp(`${name}="([^"]*)"`).exec(xml); return m ? m[1] : null; };

/** numId -> "ol" or "ul", from numbering.xml (decimal and letters are ordered lists). */
function listKinds(xml) {
  const abstract = {};
  for (const m of String(xml || "").matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    const fmt = /<w:lvl\b[^>]*w:ilvl="0"[^>]*>[\s\S]*?<w:numFmt w:val="([^"]+)"/.exec(m[2]);
    abstract[m[1]] = fmt && /decimal|letter|roman/i.test(fmt[1]) ? "ol" : "ul";
  }
  const out = {};
  for (const m of String(xml || "").matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>[\s\S]*?<w:abstractNumId w:val="(\d+)"/g)) out[m[1]] = abstract[m[2]] || "ul";
  return out;
}

/** Relationship id -> target (hyperlinks). */
function relTargets(xml) {
  const out = {};
  for (const m of String(xml || "").matchAll(/<Relationship\b([^>]*)\/?>/g)) { const id = attr(m[1], "Id"); if (id) out[id] = attr(m[1], "Target"); }
  return out;
}

/** The text of one run, wrapped for bold, italic, underline (as em) and strike. */
function run(xml) {
  const props = (/<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(xml) || [null, ""])[1];
  let text = "";
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)) text += m[1] !== undefined ? m[1] : m[0] === "<w:tab/>" ? " " : "<br>";
  if (!text) return "";
  if (/<w:strike\/>/.test(props)) text = `<del>${text}</del>`;
  if (/<w:(i|u)\b(?![^>]*w:val="(false|0|none)")/.test(props)) text = `<em>${text}</em>`;
  if (/<w:b\b(?![^>]*w:val="(false|0)")/.test(props)) text = `<strong>${text}</strong>`;
  return text;
}

/** One paragraph: { tag, html, list } where list is the numId for list items. */
function paragraph(xml, rels) {
  const style = attr((/<w:pStyle\b[^>]*\/>/.exec(xml) || [""])[0], "w:val") || "";
  const numId = attr((/<w:numId\b[^>]*\/>/.exec(xml) || [""])[0], "w:val");
  let html = "";
  for (const m of xml.matchAll(/<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>|<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)) {
    if (m[1] !== undefined) {
      const href = rels[attr(m[1], "r:id")] || "";
      const inner = [...m[2].matchAll(/<w:r\b[^>]*>([\s\S]*?)<\/w:r>/g)].map((r) => run(r[1])).join("");
      html += /^(https?:|mailto:)/.test(href) ? `<a href="${href}">${inner}</a>` : inner;
    } else html += run(m[3]);
  }
  const h = /^heading\s?([1-6])$/i.exec(style);
  return { tag: /^title$/i.test(style) ? "title" : h ? `h${h[1]}` : numId && numId !== "0" ? "li" : "p", html: html.trim(), list: numId };
}

/** A table: first row as header cells. */
function table(xml, rels) {
  const rows = [...xml.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)].map((r) => [...r[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map((c) => [...c[1].matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map((p) => paragraph(p[0], rels).html).join(" ")));
  return `<table>${rows.map((cells, i) => `<tr>${cells.map((c) => (i === 0 ? `<th>${c}</th>` : `<td>${c}</td>`)).join("")}</tr>`).join("")}</table>`;
}

export function docxToHtml(parts) {
  const doc = parts["word/document.xml"];
  if (!doc) return { error: "this .docx has no word/document.xml" };
  const kinds = listKinds(parts["word/numbering.xml"]);
  const rels = relTargets(parts["word/_rels/document.xml.rels"]);
  const body = (/<w:body>([\s\S]*)<\/w:body>/.exec(doc) || [null, ""])[1];
  let title = (/<dc:title>([\s\S]*?)<\/dc:title>/.exec(parts["docProps/core.xml"] || "") || [null, ""])[1].trim();
  const out = [];
  let open = null; // { tag: ul|ol, id }
  const close = () => { if (open) { out.push(`</${open.tag}>`); open = null; } };
  for (const m of body.matchAll(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    if (m[0].startsWith("<w:tbl")) { close(); out.push(table(m[0], rels)); continue; }
    const p = paragraph(m[0], rels);
    if (p.tag === "title") { if (!title) title = p.html.replace(/<[^>]+>/g, ""); continue; }
    if (p.tag === "li") {
      const kind = kinds[p.list] || "ul";
      if (!open || open.id !== p.list) { close(); out.push(`<${kind}>`); open = { tag: kind, id: p.list }; }
      out.push(`<li>${p.html}</li>`);
      continue;
    }
    close();
    if (p.html) out.push(`<${p.tag}>${p.html}</${p.tag}>`);
  }
  close();
  return { html: out.join(""), ...(title ? { title } : {}) };
}

export default {
  contracts: {
    "import.file": {
      /**
       * Implements contract import.file, operation convert (dispatch: accepts .docx).
       *
       * Reads the document parts from the uploaded zip and returns HTML; core splits it into pages by headings,
       * using the person's choice of site, branch or page. Never writes pages itself.
       *
       * @param {object} ctx    Platform context (spec/13); uses ctx.archive.read.
       * @param {object} input  { name, data (base64), method, type, parentId }.
       * @returns {Promise<object>}  { html, title? } or { error }.
       */
      async convert(ctx, input) {
        let parts;
        try { parts = await ctx.archive.read(input.data, { match: PARTS }); } catch (e) { return { error: `not a .docx file (${e.message}); a .doc file must be saved as .docx first` }; }
        return docxToHtml(parts);
      },
    },
  },
};
