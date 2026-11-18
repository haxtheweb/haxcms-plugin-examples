// Astro importer (Node). Mirrored in src/php/Plugin.php; both return identical results.
// Reads an Astro site as data. A Starlight site: its docs collection, in the order of the sidebar in astro.config.*
// (read as data and never executed) or of its folders. Any other Astro site: its markdown pages, its content
// collections, and the static markup of its .astro pages. Nothing of Astro runs: no components, no expressions, no
// integrations. The repository or zip is listed and read through import-source.tree, front matter through
// import-frontmatter.data, markdown through import.file.
const MAX_PAGES = 500;
const IMPORTABLE = /\.(jpg|jpeg|png|gif|webm|webp|mp4|mp3|mov|csv|ppt|pptx|xlsx|doc|xls|docx|pdf|rtf|txt|vtt|xml|svg)$/i;
const IMAGE = /\.(jpg|jpeg|png|gif|webp|svg)$/i;
const CONFIG_FILE = /^((?:[^/]+\/)*)astro\.config\.(mjs|js|ts|mts|cjs)$/;
const DOC_EXT = /\.(md|mdx|markdown)$/;
const PAGE_EXT = /\.(md|mdx|markdown|astro|html)$/;
// Starlight's asides, onto the stop-note statuses HAX offers
const NOTES = { note: ["info", "Note"], tip: ["success", "Tip"], caution: ["warning", "Caution"], danger: ["stop", "Danger"] };
// what is read as text out of a zip: pages, configuration
const SOURCE_TEXT = "(\\.(md|mdx|markdown|astro|html)|astro\\.config\\.(mjs|js|ts|mts|cjs))$";

// ---- small helpers (each has a twin in Plugin.php) ----

/** HAXCMS.cleanTitle from core: lowercase, spaces and anything outside [\w-/] become single dashes. */
export function cleanTitle(value) {
  const t = String(value).trim().replace(/ /g, "-").toLowerCase().replace(/[^\w\-/]+/g, "-").replace(/--+/g, "-");
  return t === "" ? "blank" : t;
}
function titleSlug(title) {
  const c = cleanTitle(title);
  const t = c.replace(/^-+|-+$/g, "");
  return t === "" ? c : t;
}
const ucfirst = (s) => (/^[a-z]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);
const escAttr = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const stringOf = (v) => (typeof v === "string" ? v.trim() : "");
const isExternal = (ref) => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(ref);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** encodeURIComponent per path segment, the same in PHP (rawurlencode with !*'() kept). */
const encPath = (p) => p.split("/").map((s) => encodeURIComponent(s)).join("/");

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

/** Drop script elements and inline event handlers; core sanitizes again on save. */
function strip(html) {
  return cleanHtml(html, ["script"], [], false);
}

function normalizePath(path) {
  const parts = [];
  for (const piece of path.split("/")) {
    if (piece === "" || piece === ".") continue;
    if (piece === "..") parts.pop();
    else parts.push(piece);
  }
  return parts.join("/");
}

const isSpace = (c) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\v" || c === "\f";

// ---- the config, read as data and never executed (port of core's literal reader) ----

/** Whether an offset sits inside a string literal or a comment. */
function insideStringOrComment(src, offset) {
  let i = 0, quote = "", comment = "";
  while (i < offset && i < src.length) {
    const c = src[i], n = src[i + 1];
    if (comment === "line") { if (c === "\n") comment = ""; }
    else if (comment === "block") { if (c === "*" && n === "/") { comment = ""; i++; } }
    else if (quote !== "") { if (c === "\\") i++; else if (c === quote) quote = ""; }
    else if (c === "/" && n === "/") { comment = "line"; i++; }
    else if (c === "/" && n === "*") { comment = "block"; i++; }
    else if (c === '"' || c === "'" || c === "`") quote = c;
    i++;
  }
  return quote !== "" || comment !== "";
}

/** The position just after `key:`, ignoring matches inside strings and comments; -1 when absent. */
function keyPosition(src, key) {
  const re = new RegExp(`(^|[^A-Za-z0-9_$.'"\`])${key}\\s*:`, "g");
  let m;
  while ((m = re.exec(src)) !== null) {
    const at = m.index + m[1].length;
    if (!insideStringOrComment(src, at)) return src.indexOf(":", at) + 1;
  }
  return -1;
}

/** The balanced [..] or {..} literal assigned to a key, as text, or null. */
function literalValue(src, key) {
  const start = keyPosition(src, key);
  if (start === -1) return null;
  let i = start;
  while (i < src.length && isSpace(src[i])) i++;
  const open = src[i];
  if (open !== "[" && open !== "{") return null;
  const close = open === "[" ? "]" : "}";
  let depth = 0, quote = "";
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (quote !== "") { if (c === "\\") k++; else if (c === quote) quote = ""; }
    else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  return null;
}

/** The plain string assigned to a key, or null. */
function stringValue(src, key) {
  const start = keyPosition(src, key);
  if (start === -1) return null;
  const m = /^\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/.exec(src.slice(start));
  return m ? m[2].replace(/\\(['"`\\])/g, "$1") : null;
}

/** A JavaScript data literal (arrays, objects, strings, numbers, booleans, null); anything else throws. */
export function parseJsLiteral(text) {
  const st = { t: String(text), i: 0 };
  const skip = () => {
    while (st.i < st.t.length) {
      const c = st.t[st.i], n = st.t[st.i + 1];
      if (isSpace(c)) st.i++;
      else if (c === "/" && n === "/") { while (st.i < st.t.length && st.t[st.i] !== "\n") st.i++; }
      else if (c === "/" && n === "*") { st.i += 2; while (st.i < st.t.length && !(st.t[st.i] === "*" && st.t[st.i + 1] === "/")) st.i++; st.i += 2; }
      else return;
    }
  };
  const str = () => {
    const q = st.t[st.i++];
    let v = "";
    while (st.i < st.t.length) {
      const c = st.t[st.i];
      if (c === "\\") { const e = st.t[st.i + 1]; v += e === "n" ? "\n" : e === "t" ? "\t" : e; st.i += 2; continue; }
      if (c === q) { st.i++; return v; }
      if (q === "`" && c === "$" && st.t[st.i + 1] === "{") throw new Error("template expressions are not plain data");
      v += c;
      st.i++;
    }
    throw new Error("unterminated string");
  };
  const value = () => {
    skip();
    const c = st.t[st.i];
    if (c === "[") {
      const out = [];
      st.i++;
      for (;;) {
        skip();
        if (st.t[st.i] === "]") { st.i++; return out; }
        out.push(value());
        skip();
        if (st.t[st.i] === ",") st.i++;
        else if (st.t[st.i] !== "]") throw new Error(`expected , or ] at ${st.i}`);
      }
    }
    if (c === "{") {
      const out = {};
      st.i++;
      for (;;) {
        skip();
        if (st.t[st.i] === "}") { st.i++; return out; }
        let key;
        if (st.t[st.i] === '"' || st.t[st.i] === "'" || st.t[st.i] === "`") key = str();
        else {
          const id = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(st.t.slice(st.i));
          if (!id) throw new Error(`expected a key at ${st.i}`);
          key = id[0];
          st.i += key.length;
        }
        skip();
        if (st.t[st.i] !== ":") throw new Error(`expected : after ${key}`);
        st.i++;
        out[key] = value();
        skip();
        if (st.t[st.i] === ",") st.i++;
        else if (st.t[st.i] !== "}") throw new Error(`expected , or } at ${st.i}`);
      }
    }
    if (c === '"' || c === "'" || c === "`") return str();
    const rest = st.t.slice(st.i);
    const kw = /^(true|false|null)\b/.exec(rest);
    if (kw) { st.i += kw[1].length; return kw[1] === "true" ? true : kw[1] === "false" ? false : null; }
    const num = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(rest);
    if (num) { st.i += num[0].length; return Number(num[0]); }
    throw new Error(`unsupported value at ${st.i}`);
  };
  const v = value();
  skip();
  if (st.i !== st.t.length) throw new Error("unexpected content after the literal");
  return v;
}

// ---- Astro helpers ----

const isTrue = (v) => String(v ?? "").trim().toLowerCase() === "true";
const mapOf = (v) => (isObject(v) ? v : {});
const lower = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
const rtrim = (s, chars) => { let e = s.length; while (e > 0 && chars.includes(s[e - 1])) e--; return s.slice(0, e); };
const ltrim = (s, chars) => { let b = 0; while (b < s.length && chars.includes(s[b])) b++; return s.slice(b); };
const trimSlashes = (s) => ltrim(rtrim(s, "/"), "/");
const withoutQuery = (ref) => ref.split("#")[0].split("?")[0];
const dirOf = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const baseOf = (path) => path.slice(path.lastIndexOf("/") + 1);
const stem = (name) => name.replace(PAGE_EXT, "");
const escHtml = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
function titleFromName(name) {
  const t = name.replace(/[-_]+/g, " ").trim();
  return t === "" ? name : ucfirst(t);
}
/** A number written in front matter (order: 2, 2.5, -1), or null. */
function numberOf(v) {
  const s = String(v ?? "").trim();
  return /^-?\d{1,9}(\.\d{1,9})?$/.test(s) ? Number(s) : null;
}
/** Astro's slug for a path: lower case, spaces and anything unsafe as dashes, index dropped. */
export function slugOf(path) {
  const segs = path.split("/").map((s) => lower(s).replace(/[^a-z0-9._~-]+/g, "-")).filter((s) => s !== "");
  if (segs.length && segs[segs.length - 1] === "index") segs.pop();
  return segs.join("/");
}
/** How links name a page: no slashes at the ends, lower case, no extension, no index file. */
export function normKey(path) {
  let k = lower(trimSlashes(path)).replace(/\.(md|mdx|markdown|astro|html)$/, "");
  if (k === "index") return "";
  if (k.endsWith("/index")) k = k.slice(0, -6);
  return trimSlashes(k);
}

/**
 * Seconds since 1970 for a front matter date: 2026-03-09, 2026-03-09T14:30:00Z, 2026-03-09 14:30:00+02:00.
 * A date with no offset is read as UTC. null when the text does not start with a date.
 */
export function parseDate(text) {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?[ ]?(Z|[+-]\d{2}:?\d{2})?)?/.exec(String(text ?? "").trim());
  if (!m) return null;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const h = m[4] === undefined ? 0 : Number(m[4]);
  const mi = m[5] === undefined ? 0 : Number(m[5]);
  const sec = m[6] === undefined ? 0 : Number(m[6]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return null;
  let t = Date.UTC(Number(m[1]), mo - 1, d, h, mi, sec) / 1000;
  if (m[7] !== undefined && m[7] !== "Z") {
    const digits = m[7].slice(1).replace(":", "");
    t -= (m[7][0] === "-" ? -1 : 1) * (Number(digits.slice(0, 2)) * 3600 + Number(digits.slice(2, 4)) * 60);
  }
  return t;
}

// ---- reading the site: a GitHub repository or an uploaded zip of one, both through import-source ----

/** The site's files through import-source: { name, repo, branch, list, paths (Set), readMany, rawUrl }. */
async function openSource(ctx, input) {
  const upload = Array.isArray(input.files) && input.files.length ? { files: input.files } : null;
  const listed = await ctx.contracts.call("import-source.tree", "list", upload || { url: input.url });
  if (!listed || listed.error || !Array.isArray(listed.paths)) return { error: (listed && listed.error) || "the site's files could not be listed" };
  const from = upload ? { ...upload, prefix: listed.prefix } : { repo: listed.repo, branch: listed.branch };
  const readMany = async (wanted, binary) => {
    const out = new Map();
    if (!wanted.length) return out;
    const ask = { ...from, paths: wanted };
    if (upload && binary) ask.binary = true;
    if (upload && !binary) ask.match = SOURCE_TEXT;
    const got = await ctx.contracts.call("import-source.tree", "read", ask);
    for (const f of (got && Array.isArray(got.files) ? got.files : [])) out.set(f.path, f.data);
    return out;
  };
  return { name: listed.name, repo: listed.repo, branch: listed.branch, list: listed.paths, paths: new Set(listed.paths), readMany, rawUrl: listed.rawBase ? (p) => `${listed.rawBase}/${encPath(p)}` : null };
}

/** The Astro site in the files: the shallowest folder holding astro.config.*. { dir, config } or null. */
export function findSite(list) {
  let best = null;
  for (const p of list) {
    const m = CONFIG_FILE.exec(p);
    if (!m) continue;
    const depth = m[1] === "" ? 0 : m[1].split("/").length - 1;
    const order = best === null ? -1 : depth - best.depth || byText(p, best.config);
    if (order < 0) best = { dir: m[1], config: p, depth };
  }
  return best === null ? null : { dir: best.dir, config: best.config };
}

/** What the importer needs from astro.config.*: Starlight's title, sidebar and locales, and the site's base. */
function readConfig(text) {
  const out = { starlight: /@astrojs\/starlight|\bstarlight\s*\(/.test(text), title: stringValue(text, "title"), base: trimSlashes(stringValue(text, "base") || ""), site: lower(rtrim(stringValue(text, "site") || "", "/")), sidebar: null, sidebarUnread: false, locales: null, defaultLocale: stringValue(text, "defaultLocale") };
  const sidebar = literalValue(text, "sidebar");
  if (sidebar !== null) { try { const v = parseJsLiteral(sidebar); if (Array.isArray(v)) out.sidebar = v; else out.sidebarUnread = true; } catch { out.sidebarUnread = true; } }
  else if (keyPosition(text, "sidebar") !== -1) out.sidebarUnread = true;
  const locales = literalValue(text, "locales");
  if (locales !== null) { try { const v = parseJsLiteral(locales); if (isObject(v)) out.locales = Object.keys(v); } catch { out.locales = null; } }
  return out;
}

// ---- page bodies ----

const bump = (st, key) => st.unmapped.set(key, (st.unmapped.get(key) || 0) + 1);

/** Where a tag that starts at `lt` ends (just past its >), skipping quoted values and {expressions}; -1 when it does not. */
function jsxTagEnd(s, lt) {
  let depth = 0;
  let quote = "";
  for (let i = lt + 1; i < s.length; i++) {
    const c = s[i];
    if (quote !== "") { if (c === quote) quote = ""; continue; }
    if (depth > 0) { if (c === "{") depth++; else if (c === "}") depth--; else if (c === '"' || c === "'" || c === "`") quote = c; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === "{") depth++;
    else if (c === ">") return i + 1;
  }
  return -1;
}
/** Where a {expression} that starts at `open` ends (just past its }), or -1. */
function braceEnd(s, open) {
  let depth = 0;
  let quote = "";
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (quote !== "") { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}
/** A component tag's plain attributes (name="value"); {expressions} become { expr: "..." }. */
function jsxAttrs(tag) {
  const out = {};
  const re = /([A-Za-z_][A-Za-z0-9_:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^{}]*)\})/g;
  for (const m of tag.matchAll(re)) out[m[1]] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : { expr: m[4].trim() };
  return out;
}

/**
 * MDX and .astro markup, read by scanning (nothing runs): components (capitalised tags) are removed around their
 * content, except Aside (a stop-note), LinkCard (a link), Image and Picture (an img, when the source is a file the
 * page imports or names); {expressions} and {/* comments *\/} go. Removed components and expressions are counted.
 * Returns parts: { md } text to convert, and { html } wrappers that go around it as they are.
 */
function jsx(text, doc, st, images) {
  const parts = [];
  let out = "";
  const html = (h) => { parts.push({ md: out }, { html: h }); out = ""; };
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf("<", i);
    const br = text.indexOf("{", i);
    const s = lt === -1 ? br : br === -1 ? lt : Math.min(lt, br);
    if (s === -1) { out += text.slice(i); break; }
    out += text.slice(i, s);
    if (s === br) {
      const e = braceEnd(text, s);
      if (e === -1) { out += text.slice(s); break; }
      if (!/^\{\s*\/\*[\s\S]*\*\/\s*\}$/.test(text.slice(s, e))) bump(st, "expression");
      i = e;
      continue;
    }
    const m = /^<(\/?)([A-Z][A-Za-z0-9_.]*)/.exec(text.slice(s, s + 80));
    if (!m) {
      // an HTML tag stays; attributes whose value is an {expression}, and {...spread}, go
      const h = /^<[a-z][a-z0-9-]*/.exec(text.slice(s, s + 40));
      const he = h ? jsxTagEnd(text, s) : -1;
      if (he === -1) { out += "<"; i = s + 1; continue; }
      const tag = text.slice(s, he);
      const kept = tag.replace(/\s+[A-Za-z_:][-A-Za-z0-9_:.]*\s*=\s*\{[^{}]*\}/g, "").replace(/\s*\{[^{}]*\}/g, "");
      if (kept !== tag) bump(st, "expression");
      out += kept;
      i = he;
      continue;
    }
    const e = jsxTagEnd(text, s);
    if (e === -1) { out += text.slice(s); break; }
    const tag = text.slice(s, e);
    i = e;
    const name = m[2];
    if (m[1] === "/") { if (name === "Aside") html("</div></stop-note>"); continue; }
    const a = jsxAttrs(tag);
    if (name === "Aside") {
      const note = NOTES[typeof a.type === "string" && has(NOTES, a.type) ? a.type : "note"];
      html(`<stop-note status="${note[0]}" title="${escAttr(typeof a.title === "string" ? a.title : note[1])}"><div slot="message">`);
      if (tag.endsWith("/>")) html("</div></stop-note>");
      continue;
    }
    if (name === "LinkCard" && typeof a.href === "string" && typeof a.title === "string") { html(`<p><a href="${escAttr(a.href)}">${escHtml(a.title)}</a></p>`); continue; }
    if ((name === "Image" || name === "Picture") && a.src !== undefined) {
      const src = typeof a.src === "string" ? a.src : images.get(a.src.expr);
      if (typeof src === "string") { out += `<img src="${escAttr(src)}" alt="${escAttr(typeof a.alt === "string" ? a.alt : "")}">`; continue; }
    }
    bump(st, `component:${name}`);
  }
  parts.push({ md: out });
  return parts;
}

/** An MDX page's imports of image files: Map(name -> path written in the import). */
function imageImports(text) {
  const out = new Map();
  for (const m of text.matchAll(/^import\s+([A-Za-z_$][A-Za-z0-9_$]*)\s+from\s+["']([^"']+)["'];?[ \t]*$/gm)) if (IMAGE.test(m[2])) out.set(m[1], m[2]);
  return out;
}

/**
 * A markdown or MDX body, outside fenced code: Starlight asides (:::note[Title] ... :::) become stop-notes and other
 * directives are unwrapped (and counted); in MDX, import and export lines go and JSX is read as in jsx().
 * Returns parts: { md } text to convert, and { html } wrappers that go around it as they are.
 */
function prepare(body, doc, st) {
  const mdx = doc.ext === "mdx";
  const images = mdx ? imageImports(body) : new Map();
  const parts = [];
  const out = [];
  let chunk = [];
  let fenced = false;
  const open = [];
  const flush = () => {
    if (!chunk.length) return;
    const t = chunk.join("\n");
    chunk = [];
    if (!mdx) { out.push(t); return; }
    for (const p of jsx(t, doc, st, images)) { if (p.html !== undefined) { parts.push({ md: out.join("\n") }, p); out.length = 0; } else out.push(p.md); }
  };
  const html = (h) => { flush(); parts.push({ md: out.join("\n") }, { html: h }); out.length = 0; };
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { flush(); out.push(line); fenced = !fenced; continue; }
    if (fenced) { out.push(line); continue; }
    if (mdx && /^(import|export)\s/.test(line)) { if (line.startsWith("export")) bump(st, "export"); continue; }
    const d = /^(:{3,})([A-Za-z][A-Za-z0-9-]*)?(?:\[([^\]\n]*)\])?\s*(\{[^{}\n]*\})?\s*$/.exec(line.trim());
    if (d && d[2] !== undefined) {
      const note = has(NOTES, d[2]) ? NOTES[d[2]] : null;
      if (note === null) { bump(st, `directive:${d[2]}`); flush(); }
      else html(`<stop-note status="${note[0]}" title="${escAttr(d[3] !== undefined && d[3].trim() !== "" ? d[3].trim() : note[1])}"><div slot="message">`);
      open.push({ colons: d[1].length, note: note !== null });
      continue;
    }
    if (d && d[2] === undefined && open.length && d[1].length === open[open.length - 1].colons) {
      if (open.pop().note) html("</div></stop-note>");
      else flush();
      continue;
    }
    chunk.push(line);
  }
  flush();
  while (open.length) { if (open.pop().note) html("</div></stop-note>"); }
  parts.push({ md: out.join("\n") });
  return parts;
}

/** The static markup of an .astro page: no frontmatter script, no <head>, <style> or <script>; JSX read as in jsx(). */
function astroMarkup(text, doc, st) {
  let t = text;
  const fm = /^\s*---\n[\s\S]*?\n---[ \t]*(\n|$)/.exec(t);
  if (fm) t = t.slice(fm[0].length);
  t = cleanHtml(t, ["script", "style", "head"], [], true);
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(t);
  if (body) t = body[1];
  return jsx(t, doc, st, new Map()).map((p) => (p.html !== undefined ? p.html : p.md)).join("").replace(/<\/?(html|main|article)\b[^>]*>/gi, "").trim();
}

async function markdown(ctx, text) {
  if (text.trim() === "") return "";
  const r = await ctx.contracts.call("import.file", "convert", { name: "page.md", data: Buffer.from(`\n${text}`, "utf8").toString("base64") });
  if (!r || typeof r.html !== "string") throw new Error(`markdown could not be converted: ${(r && r.error) || "no result"}`);
  return r.html;
}

// ---- links and media ----

/** A reference as a path on the site ("/x/y") when it is written against the site's address or base, else as written. */
function onSite(ref, st) {
  let r = ref;
  if (st.site !== "" && lower(r).startsWith(st.site)) { const rest = r.slice(st.site.length); r = rest === "" ? "/" : rest[0] === "/" ? rest : r; }
  if (st.base !== "" && r[0] === "/" && (r === `/${st.base}` || r.startsWith(`/${st.base}/`))) r = r.slice(st.base.length + 1) || "/";
  return r;
}

/** The file a page's reference points at, or null: beside the page's file, or (from the site's root) under public/. */
function mediaPath(ref, doc, st) {
  const clean = decode(withoutQuery(onSite(ref, st)));
  if (clean === "" || isExternal(clean)) return null;
  const candidates = clean[0] === "/" ? [`${st.dir}public/${clean.slice(1)}`, `${st.dir}${clean.slice(1)}`] : [`${dirOf(doc.file)}/${clean}`];
  for (const c of candidates) { const n = normalizePath(c); if (st.src.paths.has(n)) return n; }
  return null;
}

function uniqueFileName(repoPath, st) {
  const base = repoPath.split("/").pop().replace(/[^A-Za-z0-9._-]+/g, "-");
  if (!st.fileNames.has(base)) { st.fileNames.add(base); return base; }
  const dot = base.lastIndexOf(".");
  const s = dot === -1 ? base : base.slice(0, dot);
  const ext = dot === -1 ? "" : base.slice(dot);
  let n = 1;
  while (st.fileNames.has(`${s}-${n}${ext}`)) n++;
  st.fileNames.add(`${s}-${n}${ext}`);
  return `${s}-${n}${ext}`;
}

/** A file of the site that a page uses, added to the list for the new site's files/ folder; its site path, or null. */
function registerAsset(ref, doc, st) {
  if (typeof ref !== "string" || ref === "") return null;
  const repoPath = mediaPath(ref, doc, st);
  if (repoPath === null || !IMPORTABLE.test(repoPath)) return null;
  if (st.filesByPath.has(repoPath)) return st.filesByPath.get(repoPath);
  const path = `files/${uniqueFileName(repoPath, st)}`;
  st.media.push({ path, repoPath });
  st.filesByPath.set(repoPath, path);
  return path;
}

/** The imported page a link points at: by its address (Astro's addresses end in /, so a relative link starts there), or by its file. */
function pageSlug(href, doc, st) {
  const target = decode(withoutQuery(onSite(href, st)));
  if (target === "" || isExternal(target)) return null;
  const candidates = target[0] === "/" ? [target] : [`${doc.url}/${target}`, `${dirOf(doc.url)}/${target}`, `${dirOf(doc.rel)}/${target}`];
  for (const c of candidates) {
    const k = normKey(normalizePath(c));
    if (st.slugByKey.has(k)) return st.slugByKey.get(k);
  }
  return null;
}

/** Images become media-image, links between pages point at the imported slugs, files join the file list. */
function rewrite(html, doc, st) {
  html = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\ssrc="([^"]*)"/i.exec(tag);
    if (!src || src[1] === "") return tag;
    const alt = /\salt="([^"]*)"/i.exec(tag);
    const file = registerAsset(src[1], doc, st);
    const source = file !== null ? file : isExternal(src[1]) && IMAGE.test(withoutQuery(src[1])) ? src[1] : null;
    return source === null ? tag : `<media-image source="${escAttr(source)}" alt="${escAttr(alt ? alt[1] : "")}"></media-image>`;
  });
  return html.replace(/(<a\b[^>]*?\shref=")([^"]*)(")/gi, (m, pre, href, post) => {
    if (href === "" || href[0] === "#") return m;
    const slug = pageSlug(href, doc, st);
    if (slug !== null) return `${pre}${slug}${href.includes("#") ? href.slice(href.indexOf("#")) : ""}${post}`;
    const file = registerAsset(href, doc, st);
    return file === null ? m : `${pre}${escAttr(file)}${post}`;
  });
}

async function renderBody(ctx, doc, st) {
  let html;
  if (doc.ext === "astro") html = astroMarkup(doc.body, doc, st);
  else if (doc.ext === "html") html = doc.body;
  else {
    html = "";
    for (const p of prepare(doc.body, doc, st)) html += p.html !== undefined ? p.html : await markdown(ctx, p.md);
    const tagline = stringOf(mapOf(doc.data.hero).tagline);
    if (tagline !== "") html = `<p>${escHtml(tagline)}</p>${html}`;
  }
  return strip(rewrite(html, doc, st)).trim();
}

// ---- the documents ----

async function frontMatterCall(ctx, op, input) {
  const r = await ctx.contracts.call("import-frontmatter.data", op, input);
  if (!r || (op === "split" ? !Array.isArray(r.results) : r.data === undefined && r.error === undefined)) throw new Error(`front matter could not be read: ${(r && r.error) || "no result"}`);
  return r;
}

/** The text of some markup: everything outside its tags, by scanning. */
function textOf(html) {
  let out = "";
  let inTag = false;
  for (const c of html) { if (c === "<") inTag = true; else if (c === ">") inTag = false; else if (!inTag) out += c; }
  return out.replace(/\s+/g, " ").trim();
}
/** The first <h1> of some markup, as text, or "". */
function firstHeading(html) {
  const m = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return m ? textOf(m[1]) : "";
}

/** Read and split every document (up to MAX_PAGES) in two calls; each gets data, body, title, created and keys. */
async function readDocs(ctx, src, st, docs) {
  let truncated = false;
  if (docs.length > MAX_PAGES) { docs = docs.slice(0, MAX_PAGES); truncated = true; }
  const texts = await src.readMany(docs.map((d) => d.file), false);
  docs = docs.filter((d) => typeof texts.get(d.file) === "string");
  const md = docs.filter((d) => d.ext !== "astro");
  const split = md.length ? (await frontMatterCall(ctx, "split", { texts: md.map((d) => texts.get(d.file)) })).results : [];
  md.forEach((d, i) => { const r = split[i] || {}; d.data = mapOf(r.data); d.body = typeof r.body === "string" ? r.body : ""; });
  for (const d of docs) {
    if (d.ext === "astro") {
      d.data = {};
      d.body = texts.get(d.file).replace(/\r\n?/g, "\n");
      // an .astro page's title: its first <h1>, else the title its layout component is given
      const markup = d.body.replace(/^\s*---\n[\s\S]*?\n---[ \t]*(\n|$)/, "");
      const layout = /<[A-Z][A-Za-z0-9_.]*\b[^>]*?\stitle\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(markup);
      d.title = firstHeading(markup) || (layout ? (layout[1] !== undefined ? layout[1] : layout[2]) : "");
    } else d.title = stringOf(d.data.title);
    if (d.title === "") d.title = titleFromName(baseOf(d.route) || st.siteTitle);
    d.created = parseDate(stringOf(d.data.pubDate) || stringOf(d.data.date) || stringOf(d.data.publishDate) || stringOf(d.data.lastUpdated));
    const own = stringOf(d.data.slug);
    if (own !== "") d.route = d.kind === "entry" ? `${slugOf(d.collection)}/${trimSlashes(own)}` : trimSlashes(own);
    d.url = `/${d.route}`;
    d.keys = [d.url, `/${stem(d.rel)}`];
  }
  return { docs, truncated };
}

// ---- the import ----

async function importSite(ctx, src) {
  const found = findSite(src.list);
  if (found === null) return { error: `no Astro site found in ${src.repo || src.name} (expected an astro.config.mjs, .js or .ts)` };
  const configText = (await src.readMany([found.config], false)).get(found.config);
  const config = readConfig(typeof configText === "string" ? configText : "");
  const dir = found.dir;
  const st = {
    src, dir, base: config.base, site: config.site, siteTitle: config.title || src.name,
    unmapped: new Map(), media: [], fileNames: new Set(), filesByPath: new Map(), slugByKey: new Map(),
  };
  if (config.sidebarUnread) bump(st, "config:sidebar");
  const docsRoot = `${dir}src/content/docs/`;
  const starlight = config.starlight && src.list.some((p) => p.startsWith(docsRoot) && DOC_EXT.test(p));
  const items = [];
  const outline = [];
  const used = new Set();
  let languageFiles = 0;

  const add = (d, parentItem, order, depth, group) => {
    const own = group ? titleSlug(group) : d.route === "" ? titleSlug(d.title) : titleSlug(baseOf(d.route));
    let slug = parentItem ? `${parentItem.slug}/${own}` : own;
    for (let i = 2, s = slug; used.has(slug); i++) slug = `${s}-${i}`;
    used.add(slug);
    const metadata = { sourceType: "astro", astro: group ? { kind: d.kind } : { path: d.file, kind: d.kind } };
    if (!group) {
      if (d.hidden) metadata.hideInMenu = true;
      if (isTrue(d.data.draft)) metadata.published = false;
      if (d.created !== null) metadata.created = d.created;
      const tags = Array.isArray(d.data.tags) ? d.data.tags.filter((t) => typeof t === "string" && t.trim() !== "").map((t) => t.trim()) : [];
      if (tags.length) metadata.tags = tags;
    } else if (d.link) metadata.astro.link = d.link;
    const item = { id: `item-${items.length + 1}`, title: d.title, slug, parent: parentItem ? parentItem.id : null, order, indent: depth, content: "<p></p>", metadata };
    items.push(item);
    if (!group) {
      outline.push({ doc: d, item });
      for (const k of d.keys) { const nk = normKey(k); if (!st.slugByKey.has(nk)) st.slugByKey.set(nk, slug); }
    } else if (d.link) item.content = `<p><a href="${escAttr(d.link)}">${escHtml(d.title)}</a></p>`;
    return item;
  };

  let truncated = false;
  if (starlight) {
    // which folder holds the default language: the root locale, else defaultLocale's folder, else all of docs/
    let langDir = "";
    if (Array.isArray(config.locales) && !config.locales.includes("root") && typeof config.defaultLocale === "string" && config.locales.includes(config.defaultLocale)) langDir = `${config.defaultLocale}/`;
    const others = Array.isArray(config.locales) ? config.locales.filter((l) => l !== "root" && `${l}/` !== langDir) : [];
    const candidates = [];
    for (const p of src.list) {
      if (!p.startsWith(docsRoot) || !DOC_EXT.test(p)) continue;
      const rel = p.slice(docsRoot.length);
      if (others.some((l) => rel.startsWith(`${l}/`)) || (langDir !== "" && !rel.startsWith(langDir))) { languageFiles++; continue; }
      if (rel.split("/").some((s) => s.startsWith("_"))) continue;
      const inner = rel.slice(langDir.length);
      candidates.push({ file: p, rel: inner, ext: p.slice(p.lastIndexOf(".") + 1), kind: "doc", route: slugOf(inner.replace(DOC_EXT, "")) });
    }
    const read = await readDocs(ctx, src, st, candidates);
    truncated = read.truncated;
    const docs = read.docs;
    for (const d of docs) {
      const sb = mapOf(d.data.sidebar);
      d.order = numberOf(sb.order);
      d.hidden = isTrue(sb.hidden);
    }
    const byRoute = new Map(docs.map((d) => [d.route, d]));
    const placed = new Set();
    // an autogenerated group: the docs under a folder, ordered by sidebar.order then slug; folders become groups
    const autogen = (directory, parentItem, depth, startOrder) => {
      const pre = trimSlashes(directory) === "" ? "" : `${slugOf(trimSlashes(directory))}/`;
      const under = docs.filter((d) => !placed.has(d) && (pre === "" || d.route.startsWith(pre) || `${d.route}/` === pre) && d.route !== "");
      // folders first found, then the pages directly in this one (a page named like a folder is that folder's index)
      const dirs = new Map();
      for (const d of under) { const rest = d.route.slice(pre.length); if (rest.includes("/")) { const head = rest.split("/")[0]; if (!dirs.has(head)) dirs.set(head, { name: head, dir: `${pre}${head}`, doc: byRoute.get(`${pre}${head}`) || null }); } }
      const entries = [...dirs.values()];
      for (const d of under) { const rest = d.route.slice(pre.length); if (!rest.includes("/") && !dirs.has(rest)) entries.push({ name: rest, dir: null, doc: d }); }
      entries.sort((a, b) => {
        const oa = a.doc && a.doc.order !== null ? a.doc.order : Infinity;
        const ob = b.doc && b.doc.order !== null ? b.doc.order : Infinity;
        return oa !== ob ? (oa < ob ? -1 : 1) : byText(a.name, b.name);
      });
      let order = startOrder;
      for (const e of entries) {
        if (e.dir === null) { placed.add(e.doc); add(e.doc, parentItem, order++, depth, null); continue; }
        // a folder's own index page holds that folder's group; else a group page is made
        const holder = e.doc && !placed.has(e.doc) ? e.doc : null;
        if (holder) placed.add(holder);
        const item = holder ? add(holder, parentItem, order++, depth, null) : add({ kind: "group", title: titleFromName(e.name) }, parentItem, order++, depth, e.name);
        autogen(e.dir, item, depth + 1, 0);
      }
      return order;
    };
    // the sidebar in astro.config, read as data: links, groups and autogenerated groups
    const walk = (entries, parentItem, depth, start) => {
      let order = start;
      for (const e of entries) {
        if (typeof e === "string" || (isObject(e) && typeof e.slug === "string")) {
          const d = byRoute.get(slugOf(trimSlashes(typeof e === "string" ? e : e.slug)));
          if (d && !placed.has(d)) { placed.add(d); add(d, parentItem, order++, depth, null); }
          continue;
        }
        if (!isObject(e)) continue;
        const label = typeof e.label === "string" ? e.label : "";
        if (typeof e.link === "string") {
          const d = isExternal(e.link) ? null : byRoute.get(normKey(onSite(e.link, st)));
          if (d && !placed.has(d)) { placed.add(d); add(d, parentItem, order++, depth, null); }
          else if (!d && label !== "") add({ kind: "link", title: label, link: e.link }, parentItem, order++, depth, label);
          continue;
        }
        const auto = isObject(e.autogenerate) && typeof e.autogenerate.directory === "string" ? e.autogenerate.directory : null;
        if (label === "" && auto !== null) { order = autogen(auto, parentItem, depth, order); continue; }
        if (label === "") continue;
        const item = add({ kind: "group", title: label }, parentItem, order++, depth, label);
        if (auto !== null) autogen(auto, item, depth + 1, 0);
        else if (Array.isArray(e.items)) walk(e.items, item, depth + 1, 0);
      }
      return order;
    };
    let order = 0;
    const home = byRoute.get("");
    if (home) { placed.add(home); add(home, null, order++, 0, null); }
    if (config.sidebar) {
      order = walk(config.sidebar, null, 0, order);
      // pages the sidebar does not list are still pages of the site: kept, out of the menu
      for (const d of docs.filter((x) => !placed.has(x)).sort((a, b) => byText(a.route, b.route))) { d.hidden = true; placed.add(d); add(d, null, order++, 0, null); }
    } else autogen("", null, 0, order);
  } else {
    // any other Astro site: src/pages (markdown, .astro, .html) by folder, then each content collection
    const pagesRoot = `${dir}src/pages/`;
    const contentRoot = `${dir}src/content/`;
    const candidates = [];
    for (const p of src.list) {
      if (p.startsWith(pagesRoot) && PAGE_EXT.test(p)) {
        const rel = p.slice(pagesRoot.length);
        if (rel.split("/").some((s) => s.startsWith("_"))) continue;
        if (/\[/.test(rel)) { bump(st, "route:dynamic"); continue; }
        if (/^404\./.test(rel)) continue;
        candidates.push({ file: p, rel, ext: p.slice(p.lastIndexOf(".") + 1), kind: "page", route: slugOf(stem(rel)) });
      } else if (p.startsWith(contentRoot) && DOC_EXT.test(p)) {
        const rel = p.slice(contentRoot.length);
        if (!rel.includes("/") || rel.split("/").some((s) => s.startsWith("_"))) continue;
        const collection = rel.slice(0, rel.indexOf("/"));
        candidates.push({ file: p, rel, ext: p.slice(p.lastIndexOf(".") + 1), kind: "entry", collection, route: `${slugOf(collection)}/${slugOf(rel.slice(collection.length + 1).replace(DOC_EXT, ""))}` });
      }
    }
    const read = await readDocs(ctx, src, st, candidates);
    truncated = read.truncated;
    const pages = read.docs.filter((d) => d.kind === "page");
    const entries = read.docs.filter((d) => d.kind === "entry");
    for (const d of read.docs) d.hidden = false;
    const byRoute = new Map(pages.map((d) => [d.route, d]));
    const titleOrder = (a, b) => byText(lower(a.title), lower(b.title)) || byText(a.route, b.route);
    const childrenOf = (route) => pages.filter((d) => d.route !== "" && dirOf(d.route) === route).sort(titleOrder);
    const holders = new Map();
    const walk = (route, parentItem, depth, start) => {
      let order = start;
      for (const d of childrenOf(route)) { const item = add(d, parentItem, order++, depth, null); holders.set(d.route, item); walk(d.route, item, depth + 1, 0); }
      // folders of pages with no index page of their own get a page
      const dirs = new Set(pages.filter((d) => d.route !== "" && dirOf(d.route) !== route && (route === "" || dirOf(d.route).startsWith(`${route}/`))).map((d) => (route === "" ? d.route : d.route.slice(route.length + 1)).split("/")[0]));
      for (const name of [...dirs].sort(byText)) {
        const full = route === "" ? name : `${route}/${name}`;
        if (byRoute.has(full) || !pages.some((d) => dirOf(d.route) === full || dirOf(d.route).startsWith(`${full}/`))) continue;
        const item = add({ kind: "group", title: titleFromName(name) }, parentItem, order++, depth, name);
        holders.set(full, item);
        walk(full, item, depth + 1, 0);
      }
      return order;
    };
    let order = 0;
    const home = byRoute.get("");
    if (home) add(home, null, order++, 0, null);
    order = walk("", null, 0, order);
    // each collection: under the top-level page of the same name, else a page of its own; newest first when dated
    const names = [...new Set(entries.map((d) => d.collection))].sort(byText);
    for (const name of names) {
      const list = entries.filter((d) => d.collection === name);
      const dated = list.some((d) => d.created !== null);
      list.sort(dated ? (a, b) => { const ca = a.created === null ? 0 : a.created; const cb = b.created === null ? 0 : b.created; return ca !== cb ? (ca > cb ? -1 : 1) : byText(a.route, b.route); } : titleOrder);
      const holder = holders.get(slugOf(name)) || add({ kind: "collection", title: titleFromName(name) }, null, order++, 0, name);
      const first = items.filter((it) => it.parent === holder.id).length;
      list.forEach((d, i) => add(d, holder, first + i, holder.indent + 1, null));
    }
  }
  if (!outline.length) return { error: `no pages found in ${src.repo || src.name}` };

  for (const { doc, item } of outline) {
    const html = await renderBody(ctx, doc, st);
    item.content = html === "" ? "<p></p>" : html;
  }

  // media: a repository's files are fetched by core from their URLs; a zip's are read here and handed over as data
  let files = [];
  if (src.rawUrl) files = st.media.map((f) => ({ path: f.path, url: src.rawUrl(f.repoPath) }));
  else if (st.media.length) {
    const data = await src.readMany(st.media.map((f) => f.repoPath), true);
    for (const f of st.media) if (typeof data.get(f.repoPath) === "string") files.push({ path: f.path, data: data.get(f.repoPath) });
  }

  const out = { title: st.siteTitle, items, files };
  if (truncated) out.truncated = true;
  out.stats = { pages: items.length, media: files.length, languageFiles, starlight };
  if (st.unmapped.size) {
    out.stats.unmapped = {};
    for (const k of [...st.unmapped.keys()].sort(byText)) out.stats.unmapped[k] = st.unmapped.get(k);
  }
  return out;
}

export default {
  contracts: {
    "import.platform": {
      /**
       * Implements contract import.platform, operation convert (dispatch: chosen).
       *
       * Reads an Astro site from a GitHub repository (or an uploaded zip of one). A Starlight site gives its docs in
       * the order of the sidebar in astro.config (read as data, never executed) or of its folders, with asides as
       * stop-notes. Any other Astro site gives its markdown and .astro pages by folder (static markup only) and its
       * content collections, newest first when dated. Front matter gives titles, dates, tags and drafts; links
       * between pages point at the imported slugs; the images and files pages use are listed for the new site.
       * Components and expressions are not run; what was left out is counted in stats.
       *
       * @param {object} ctx    Platform context (spec/13); the repository or zip is read through import-source.tree, so nothing is fetched here.
       * @param {object} input  { url } of the repository (https://github.com/<owner>/<repo>, optionally /tree/<branch>), or { files: [{ name, data (base64 zip) }] }.
       * @returns {Promise<object>}  { title, items, files, truncated?, stats } or { error }.
       */
      async convert(ctx, input) {
        input = input || {};
        try {
          if (Array.isArray(input.files) && input.files.length) {
            const f = input.files[0] || {};
            if (!/\.zip$/i.test(String(f.name || ""))) return { error: "expected a .zip of the Astro site" };
          } else if (!input.url) return { error: "url or files is required" };
          const src = await openSource(ctx, input);
          if (src.error) return src;
          return await importSite(ctx, src);
        } catch (e) {
          return { error: e.message };
        }
      },
    },
  },
};
