// WordPress importer (Node). Mirrored in src/php/Plugin.php; identical output.
// Reads a WXR export (WordPress > Tools > Export) with regular expressions, as the other importers do, so both runtimes
// parse it the same way. Pages and posts become items; drafts are kept unpublished; attachments are listed in `files`
// for core to fetch (the contract's media slot), never downloaded here.
const tag = (xml, name) => { const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml); return m ? m[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1").trim() : ""; };
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

const strip = (html) => cleanHtml(html, ["script", "style"], [], false);
// WordPress keeps paragraphs as blank lines; wrap loose text in <p> as wpautop would
const autop = (s) => (/<(p|div|h[1-6]|ul|ol|figure|table|blockquote)\b/i.test(s) ? s : s.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${x}</p>`).join(""));

export function convert(xml) {
  const channel = tag(xml, "channel");
  const raw = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const posts = raw.map((x) => ({ id: tag(x, "wp:post_id"), type: tag(x, "wp:post_type"), status: tag(x, "wp:status"), title: tag(x, "title"), slug: tag(x, "wp:post_name"), parent: tag(x, "wp:post_parent"), order: Number(tag(x, "wp:menu_order")) || 0, content: tag(x, "content:encoded"), url: tag(x, "wp:attachment_url") }));
  const keep = posts.filter((p) => (p.type === "page" || p.type === "post") && p.status !== "trash");
  const ids = new Set(keep.map((p) => p.id));
  const items = keep
    .sort((a, b) => (a.type === b.type ? 0 : a.type === "page" ? -1 : 1) || a.order - b.order || Number(a.id) - Number(b.id))
    .map((p, i) => ({
      id: `item-${p.id}`, title: p.title || "Untitled", slug: p.slug || `item-${p.id}`,
      parent: p.parent && p.parent !== "0" && ids.has(p.parent) ? `item-${p.parent}` : null, order: i,
      content: autop(strip(p.content)), ...(p.status === "publish" ? {} : { metadata: { published: false } }),
    }));
  const files = posts.filter((p) => p.type === "attachment" && /^https?:\/\//.test(p.url)).map((p) => ({ path: `files/${p.url.split("/").pop().split("?")[0]}`, url: p.url }));
  return { title: tag(channel, "title") || "Imported site", items, ...(files.length ? { files } : {}) };
}

export default {
  contracts: {
    "import.platform": {
      /**
       * Implements contract import.platform, operation convert (dispatch: chosen).
       *
       * Turns a WordPress export (WXR) into pages: pages first, then posts, with parents kept, drafts unpublished and trashed items skipped. Attachments are listed in files for core to fetch, never downloaded here.
       *
       * @param {object} ctx    Platform context (spec/13); unused.
       * @param {object} input  { xml } (or { html } holding the same WXR text).
       * @returns {Promise<object>}  { title, items, files? } or { error }.
       */
      async convert(ctx, input) {
        const xml = input && typeof input.xml === "string" ? input.xml : input && typeof input.html === "string" ? input.html : null;
        if (!xml || !/<rss[\s>][\s\S]*xmlns:wp=/.test(xml)) return { error: "a WordPress export (WXR) file is required" };
        return convert(xml);
      },
    },
  },
};
