// Pressbooks importer (Node). Mirrored in src/php/Plugin.php; both return identical results.
// Port of core's convertPressbooksToSite.js: the book's REST API (wp-json/pressbooks/v2), or an uploaded XHTML export.
const API = "/wp-json/pressbooks/v2";
// path segments that end the book's base path when someone pastes a chapter or API URL
const STOP_SEGMENTS = ["wp-json", "front-matter", "chapter", "back-matter", "part", "toc"];
const SECTION = /<div\s+class="(front-matter|part|chapter|back-matter)(?:\s[^"]*)?"[^>]*>/gi;
const SECTION_TITLE = /<h[1-6][^>]*class="[^"]*\b(?:front-matter|part|chapter|back-matter)-title\b[^"]*"[^>]*>([\s\S]*?)<\/h[1-6]>/i;

/** HAXCMS.cleanTitle from core: lowercase, spaces and anything outside [\w-/] become single dashes. */
export function cleanTitle(value) {
  const t = String(value).trim().replace(/ /g, "-").toLowerCase().replace(/[^\w\-/]+/g, "-").replace(/--+/g, "-");
  return t === "" ? "blank" : t;
}

/** Leading integer of a value, or 0 (parseInt without NaN, written so PHP matches it). */
function toInt(value) {
  const m = /^\s*([+-]?\d+)/.exec(String(value ?? ""));
  return m ? Number(m[1]) : 0;
}

/** The few entities WordPress writes in titles, decoded the same way in both runtimes. */
function decode(s) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (m, n) => named[n]);
}

/** Plain text of an HTML fragment. */
const textOf = (html) => decode(withoutTags(html)).replace(/[ \t\n\r\f\x0B\u00a0]+/g, " ").trim();

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

/** Drop script elements and inline event handlers; core sanitizes again on save. */
function strip(html) {
  return cleanHtml(html, ["script"], [], false);
}

/** The pasted URL and each shorter path above it, stopping at a known Pressbooks segment. */
export function candidates(url) {
  let u;
  try { u = new URL(String(url)); } catch { return []; }
  if (!/^https?:$/.test(u.protocol)) return [];
  const origin = `${u.protocol}//${u.host}`;
  let parts = u.pathname.split("/").filter(Boolean);
  const stop = parts.findIndex((p) => STOP_SEGMENTS.includes(p));
  if (stop !== -1) parts = parts.slice(0, stop);
  const out = [];
  for (let i = parts.length; i >= 0; i--) {
    const c = i > 0 ? `${origin}/${parts.slice(0, i).join("/")}` : origin;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

async function getJson(ctx, url) {
  try { const r = await ctx.fetch(url); return r.ok ? await r.json() : null; } catch { return null; }
}

const isList = (v) => Array.isArray(v);
const tocOk = (t) => !!t && typeof t === "object" && isList(t["front-matter"]) && isList(t.parts) && isList(t["back-matter"]);

/** The book's base URL: the first candidate whose REST index lists pressbooks/v2, or whose TOC answers. */
async function discover(ctx, url) {
  for (const c of candidates(url)) {
    const index = await getJson(ctx, `${c}/wp-json/`);
    if (index && isList(index.namespaces) && index.namespaces.includes("pressbooks/v2")) return { base: c, toc: null };
    const toc = await getJson(ctx, `${c}${API}/toc`);
    if (tocOk(toc)) return { base: c, toc };
  }
  return null;
}

/** title, content: a string or WordPress's { rendered, raw }. */
function field(obj, key) {
  const v = obj && obj[key];
  if (typeof v === "string") return v;
  if (v && typeof v === "object") return (typeof v.rendered === "string" && v.rendered) || (typeof v.raw === "string" && v.raw) || "";
  return "";
}

function sorted(list) {
  return (isList(list) ? [...list] : []).sort((a, b) => toInt(a && a.menu_order) - toInt(b && b.menu_order));
}

function absolutize(html, base) {
  const u = new URL(base);
  return String(html).replace(/(href|src|poster|srcset)="\/(?!\/)/g, `$1="${u.protocol}//${u.host}/`);
}

function metadataFor(entry, full, sourceType) {
  const pressbooks = {};
  const id = (full && full.id) || (entry && entry.id) || null;
  if (id) pressbooks.id = id;
  if (entry && entry.slug) pressbooks.slug = entry.slug;
  if (entry && entry.menu_order !== undefined && entry.menu_order !== null) pressbooks.menuOrder = entry.menu_order;
  if (entry && entry.status) pressbooks.status = entry.status;
  const meta = { sourceType, pressbooks };
  const source = (full && full.link) || (entry && entry.link) || null;
  if (source) meta.source = source;
  return meta;
}

/** A unique slug: -2, -3 ... when two sections clean to the same one. */
function unique(slug, used) {
  let s = slug, n = 2;
  while (used.has(s)) s = `${slug}-${n++}`;
  used.add(s);
  return s;
}

/** The REST path (core's main path): front matter, then each part followed by its chapters, then back matter. */
async function fromApi(ctx, url) {
  const found = await discover(ctx, url);
  if (!found) return { error: "no Pressbooks API found at that address (expected /wp-json/pressbooks/v2)" };
  const { base } = found;
  const toc = found.toc || (await getJson(ctx, `${base}${API}/toc`));
  if (!tocOk(toc)) return { error: "the Pressbooks table of contents could not be read" };
  const meta = await getJson(ctx, `${base}${API}/metadata`);
  const items = [];
  const used = new Set();
  let top = 0;
  const add = async (entry, endpoint, sourceType, parent) => {
    const full = entry && entry.id ? await getJson(ctx, `${base}${API}/${endpoint}/${entry.id}`) : null;
    const title = textOf(field(full, "title") || field(entry, "title") || (entry && entry.slug) || "");
    const raw = field(full, "content");
    const item = {
      id: `item-${items.length + 1}`,
      title,
      slug: unique(parent ? `${parent.slug}/${cleanTitle(title)}` : cleanTitle(title), used),
      parent: parent ? parent.id : null,
      order: 0,
      indent: parent ? 1 : 0,
      content: raw === "" ? "<p></p>" : strip(absolutize(raw, base)),
      metadata: metadataFor(entry, full, sourceType),
    };
    items.push(item);
    return item;
  };
  for (const s of sorted(toc["front-matter"])) { if (s && s.export === false) continue; (await add(s, "front-matter", "front-matter", null)).order = top++; }
  for (const part of sorted(toc.parts)) {
    if (part && part.export === false) continue;
    const p = await add(part, "parts", "part", null);
    p.order = top++;
    let n = 0;
    for (const ch of sorted(part.chapters)) { if (ch && ch.export === false) continue; (await add(ch, "chapters", "chapter", p)).order = n++; }
  }
  for (const s of sorted(toc["back-matter"])) { if (s && s.export === false) continue; (await add(s, "back-matter", "back-matter", null)).order = top++; }
  if (!items.length) return { error: "the Pressbooks book has no sections to import" };
  const last = new URL(base).pathname.split("/").filter(Boolean).pop();
  const title = textOf((meta && typeof meta.name === "string" && meta.name) || last || "Pressbooks import");
  return { title, items };
}

/** Drop the </div> closers that belong to the section wrapper, not to the section's own content. */
function balance(html) {
  let s = html.trim();
  const count = (re) => (s.match(re) || []).length;
  while (/<\/div>$/i.test(s) && count(/<\/div>/gi) > count(/<div\b/gi)) s = s.slice(0, -6).trim();
  return s;
}

/** An uploaded XHTML export: one item per front-matter, part, chapter and back-matter section, chapters under parts. */
export function fromExport(html, name) {
  const doc = strip(html);
  const end = doc.search(/<\/body>/i);
  const body = end === -1 ? doc : doc.slice(0, end);
  const marks = [...body.matchAll(SECTION)];
  if (!marks.length) return { error: "the file is not a Pressbooks XHTML export (no front-matter, part or chapter sections)" };
  const items = [];
  const used = new Set();
  let top = 0, part = null, n = 0;
  marks.forEach((m, i) => {
    const kind = m[1].toLowerCase();
    const seg = body.slice(m.index + m[0].length, i + 1 < marks.length ? marks[i + 1].index : body.length);
    const h = SECTION_TITLE.exec(seg);
    const idAttr = /\sid="([^"]*)"/.exec(m[0]);
    const title = (h && textOf(h[1])) || (idAttr && idAttr[1]) || kind;
    const ugc = /<div\s+class="ugc[^"]*"[^>]*>/i.exec(seg);
    const content = ugc ? balance(seg.slice(ugc.index + ugc[0].length)) : "";
    const parent = kind === "chapter" ? part : null;
    const item = {
      id: `item-${items.length + 1}`,
      title,
      slug: unique(parent ? `${parent.slug}/${cleanTitle(title)}` : cleanTitle(title), used),
      parent: parent ? parent.id : null,
      order: parent ? n++ : top++,
      indent: parent ? 1 : 0,
      content: content === "" ? "<p></p>" : content,
      metadata: { sourceType: kind, pressbooks: idAttr ? { slug: idAttr[1] } : {} },
    };
    if (kind === "part") { part = item; n = 0; }
    if (kind !== "chapter" && kind !== "part") part = null;
    items.push(item);
  });
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(doc);
  return { title: (t && textOf(t[1])) || String(name).replace(/\.[^.]+$/, ""), items };
}

export default {
  contracts: {
    "import.platform": {
      /**
       * Implements contract import.platform, operation convert (dispatch: chosen).
       *
       * Reads a Pressbooks book through its REST API (front matter, each part with its chapters, back matter, in menu
       * order) or splits an uploaded XHTML export into the same tree. Root-relative links are pointed at the book's
       * host, and scripts and inline handlers are dropped (core sanitizes again).
       *
       * @param {object} ctx    Platform context (spec/13); ctx.fetch reaches only input.url's host.
       * @param {object} input  { url } of the book (any page of it), or { files: [{ name, data (base64) }] } with one .html export.
       * @returns {Promise<object>}  { title, items } or { error }.
       */
      async convert(ctx, input) {
        input = input || {};
        if (Array.isArray(input.files) && input.files.length) {
          const f = input.files[0] || {};
          const name = String(f.name || "");
          if (!/\.(html|htm|xhtml)$/i.test(name)) return { error: "expected a Pressbooks XHTML export (.html)" };
          const html = Buffer.from(String(f.data || ""), "base64").toString("utf8");
          if (!html.trim()) return { error: "the file is empty" };
          return fromExport(html, name);
        }
        if (!input.url) return { error: "url or files is required" };
        if (!candidates(input.url).length) return { error: "url is not a URL" };
        return fromApi(ctx, input.url);
      },
    },
  },
};
