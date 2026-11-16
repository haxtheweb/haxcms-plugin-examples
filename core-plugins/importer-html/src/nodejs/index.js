// HTML importer (Node). Mirrored in src/php/Plugin.php.
// Splits the document at each <h2>; the <h1> (or <title>) becomes the site title. Scripts, styles and event
// handlers are dropped; core sanitizes page HTML again on save, as it does for every importer today.
// ---- HTML clean-up by scanning, not by regex replacement, so nested or broken markup cannot reassemble into a tag
// that a single pass missed. Same algorithm as the twin in Plugin.php.
// the ">" closing the tag that opens at lt (quoted attribute values may hold ">"); -1 when it never closes, -2 when
// another "<" comes first (then the first one is text)
const tagEnd = (s, lt) => {
  let q = "";
  for (let i = lt + 1; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = ""; } else if (c === '"' || c === "'") q = c; else if (c === ">") return i; else if (c === "<") return -2;
  }
  return -1;
};
const TAG_NAME = /^(\/?)([A-Za-z][A-Za-z0-9-]*)/;
const SPACE_CHAR = /[ \t\n\r\f\v]/;
const NAME_END = /[\s/=]/;
// a tag's source (between < and >) without on* event handler attributes
const withoutHandlers = (raw) => {
  const m = TAG_NAME.exec(raw);
  if (!m) return raw;
  let out = m[0];
  let i = m[0].length;
  while (i < raw.length) {
    let j = i;
    while (j < raw.length && (SPACE_CHAR.test(raw[j]) || raw[j] === "/")) j++;
    if (j >= raw.length) { out += raw.slice(i); break; }
    let k = j;
    while (k < raw.length && !NAME_END.test(raw[k])) k++;
    const name = raw.slice(j, k);
    let e = k;
    let w = k;
    while (w < raw.length && SPACE_CHAR.test(raw[w])) w++;
    if (raw[w] === "=") {
      w++;
      while (w < raw.length && SPACE_CHAR.test(raw[w])) w++;
      const q = raw[w];
      if (q === '"' || q === "'") { const close = raw.indexOf(q, w + 1); e = close < 0 ? raw.length : close + 1; } else { e = w; while (e < raw.length && !SPACE_CHAR.test(raw[e])) e++; }
    }
    if (name.slice(0, 2).toLowerCase() !== "on") out += raw.slice(i, e);
    i = e > i ? e : i + 1;
  }
  return out;
};
// drops each element in `blocks` with its content, each tag in `tags` (opening or closing), every on* attribute,
// and comments when `comments` is true; an unterminated tag, or a block never closed, drops the rest
const cleanHtml = (html, blocks, tags, comments) => {
  const s = String(html ?? "");
  const lower = s.replace(/[A-Z]/g, (c) => c.toLowerCase()); // ASCII only, so indexes line up with s
  let out = "";
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) { out += s.slice(i); break; }
    out += s.slice(i, lt);
    if (s.startsWith("<!--", lt)) {
      const end = s.indexOf("-->", lt + 4);
      const next = end < 0 ? s.length : end + 3;
      if (!comments) out += s.slice(lt, next);
      i = next;
      continue;
    }
    const m = TAG_NAME.exec(s.slice(lt + 1, lt + 65));
    // a "<" that starts no tag is written escaped, so nothing dropped after it can join it into one
    if (!m) { out += "&lt;"; i = lt + 1; continue; }
    const gt = tagEnd(s, lt);
    if (gt === -2) { out += "&lt;"; i = lt + 1; continue; }
    if (gt < 0) break;
    const name = m[2].toLowerCase();
    if (!m[1] && blocks.includes(name)) {
      const close = lower.indexOf(`</${name}`, gt + 1);
      if (close < 0) break;
      const closeGt = s.indexOf(">", close);
      i = closeGt < 0 ? s.length : closeGt + 1;
      continue;
    }
    if (blocks.includes(name) || tags.includes(name)) { i = gt + 1; continue; }
    out += `<${m[1] ? s.slice(lt + 1, gt) : withoutHandlers(s.slice(lt + 1, gt))}>`;
    i = gt + 1;
  }
  return out;
};
// the text of some markup: every tag and comment dropped, `glue` where each one was ("<" before anything but a
// letter, "/", "!" or "?" is text). Repeated until nothing changes, so what is left never holds a tag.
const TAG_START = /[A-Za-z/!?]/;
const withoutTagsOnce = (s, glue) => {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) { out += s.slice(i); break; }
    out += s.slice(i, lt);
    if (s.startsWith("<!--", lt)) {
      const end = s.indexOf("-->", lt + 4);
      out += glue;
      i = end < 0 ? s.length : end + 3;
      continue;
    }
    const gt = lt + 1 < s.length && TAG_START.test(s[lt + 1]) ? tagEnd(s, lt) : -2;
    if (gt === -2) { out += "<"; i = lt + 1; continue; }
    if (gt < 0) break;
    out += glue;
    i = gt + 1;
  }
  return out;
};
const withoutTags = (html, glue = "") => {
  let s = String(html ?? "");
  for (;;) {
    const next = withoutTagsOnce(s, glue);
    if (next === s) return s;
    s = next;
  }
};

const strip = (html) => cleanHtml(html, ["script", "style"], [], false);
const text = (html) => withoutTags(html).replace(/\s+/g, " ").trim();
export const slug = (t) => text(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "page";

export function convert(html) {
  const clean = strip(html);
  const body = (clean.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [null, clean])[1];
  const title = text((body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || clean.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [null, "Imported site"])[1]);
  const rest = body.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, "");
  const parts = rest.split(/(?=<h2[^>]*>)/i).map((p) => p.trim()).filter(Boolean);
  const items = [];
  for (const part of parts) {
    const h = part.match(/^<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const pageTitle = h ? text(h[1]) : "Introduction";
    const content = (h ? part.slice(h[0].length) : part).trim();
    let s = slug(pageTitle), n = 2;
    while (items.some((i) => i.slug === s)) s = `${slug(pageTitle)}-${n++}`;
    items.push({ id: `item-${items.length + 1}`, title: pageTitle, slug: s, parent: null, order: items.length, content });
  }
  return { title, items };
}

export default {
  contracts: {
    "import.platform": {
      /**
       * Implements contract import.platform, operation convert (dispatch: chosen).
       *
       * Splits an HTML document into pages at each h2, with the h1 (or title) as the site title and text before the first h2 as Introduction. Scripts, styles and event handlers are dropped; core sanitizes again on save.
       *
       * @param {object} ctx    Platform context (spec/13); unused.
       * @param {object} input  { html }.
       * @returns {Promise<object>}  { title, items } or { error }.
       */
      async convert(ctx, input) {
        if (!input || typeof input.html !== "string") return { error: "html is required" };
        return convert(input.html);
      },
    },
  },
};
