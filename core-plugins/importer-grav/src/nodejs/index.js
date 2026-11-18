// Grav importer (Node). Mirrored in src/php/Plugin.php; both return identical results.
// Reads a Grav site's pages folder as data: every folder under user/pages is a page, its numeric prefix (01.home) gives
// order and menu visibility, its markdown file names the template, and its YAML header carries title, slug, dates and
// taxonomy. Modules (_folders) fold into their page. Nothing of Grav is run: no Twig, no plugins, no theme.
// The repository or zip is listed and read through import-source.tree; markdown goes to import.file (import-markdown).
const MAX_PAGES = 500;
const IMPORTABLE = /\.(jpg|jpeg|png|gif|webm|webp|mp4|mp3|mov|csv|ppt|pptx|xlsx|doc|xls|docx|pdf|rtf|txt|vtt|xml)$/i;
const IMAGE = /\.(jpg|jpeg|png|gif|webp)$/i;
// <template>.md or <template>.<lang>.md (default.md, blog.md, default.fr.md)
const PAGE_FILE = /^(.+?)(?:\.([a-z]{2,3}(?:-[A-Za-z]{2})?))?\.md$/;
const NUMBERED = /^(\d+)\.(.+)$/;
// what is read as text out of a zip: pages and configuration
const SOURCE_TEXT = "\\.(md|yaml)$";

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

// ---- a YAML subset: block maps, block lists, scalars, [a, b] lists, | and > text. Enough for Grav page headers and site.yaml. ----

const KEY = /^("[^"]*"|'[^']*'|[^\s"'#][^:#]*?)\s*:(?:\s+(.*))?$/;
const isItem = (t) => t === "-" || t.startsWith("- ");
const stripComment = (v) => (/^["']/.test(v) ? v : v.replace(/\s+#.*$/, "").trim());
function scalar(v) {
  v = v.trim();
  if (v.startsWith('"')) { const m = /^"((?:\\.|[^"\\])*)"/.exec(v); return m ? m[1].replace(/\\(.)/g, "$1") : v.slice(1); }
  if (v.startsWith("'")) { const m = /^'((?:''|[^'])*)'/.exec(v); return m ? m[1].replace(/''/g, "'") : v.slice(1); }
  v = stripComment(v);
  if (v.startsWith("[") && v.endsWith("]")) { const inner = v.slice(1, -1).trim(); return inner === "" ? [] : inner.split(",").map((x) => scalar(x)); }
  return v;
}
function yamlBlock(st, indent) {
  const l = st.lines[st.i];
  if (!l || l.indent < indent) return null;
  return isItem(l.text) ? yamlList(st, l.indent) : yamlMap(st, l.indent);
}
function yamlList(st, indent) {
  const out = [];
  while (st.i < st.lines.length) {
    const l = st.lines[st.i];
    if (l.indent !== indent || !isItem(l.text)) break;
    const rest = l.text.slice(1).replace(/^ +/, "");
    const offset = l.text.length - rest.length;
    if (rest === "") { st.i++; const n = st.lines[st.i]; out.push(n && n.indent > indent ? yamlBlock(st, n.indent) : null); continue; }
    if (isItem(rest) || KEY.test(rest)) { st.lines[st.i] = { indent: indent + offset, text: rest }; out.push(yamlBlock(st, indent + offset)); continue; }
    st.i++;
    out.push(scalar(rest));
  }
  return out;
}
function yamlMap(st, indent) {
  const out = {};
  while (st.i < st.lines.length) {
    const l = st.lines[st.i];
    if (l.indent < indent || (l.indent === indent && isItem(l.text))) break;
    st.i++;
    if (l.indent > indent) continue;
    const m = KEY.exec(l.text);
    if (!m) continue;
    const key = scalar(m[1]);
    const v = m[2] === undefined ? "" : stripComment(m[2]);
    if (v === "") {
      const n = st.lines[st.i];
      out[key] = n && (n.indent > indent || (n.indent === indent && isItem(n.text))) ? yamlBlock(st, n.indent) : null;
    } else if (/^[|>][-+0-9]*$/.test(v)) {
      const parts = [];
      while (st.i < st.lines.length && st.lines[st.i].indent > indent) parts.push(st.lines[st.i++].text);
      out[key] = parts.join(v[0] === "|" ? "\n" : " ");
    } else out[key] = scalar(v);
  }
  return out;
}
export function parseYaml(text) {
  const lines = [];
  for (const raw of String(text).replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(#.*)?$/.test(raw) || /^(---|\.\.\.)\s*$/.test(raw)) continue;
    const indent = /^ */.exec(raw)[0].length;
    lines.push({ indent, text: raw.slice(indent).replace(/\s+$/, "") });
  }
  if (!lines.length) return {};
  const v = yamlBlock({ lines, i: 0 }, lines[0].indent);
  return isObject(v) ? v : {};
}

// ---- Grav helpers ----

const isFalse = (v) => ["false", "0", "no", "off"].includes(String(v ?? "").trim().toLowerCase());
const isTrue = (v) => ["true", "1", "yes", "on"].includes(String(v ?? "").trim().toLowerCase());
const mapOf = (v) => (isObject(v) ? v : {});
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
/** A list of non-empty strings out of a YAML list or a single value. */
function stringList(v) {
  const out = [];
  for (const x of Array.isArray(v) ? v : [v]) if (typeof x === "string" && x.trim() !== "") out.push(x.trim());
  return out;
}
/** A folder name: its ordering prefix (01.), the name Grav routes by, and whether it is a module (_name). */
function segment(seg) {
  const m = NUMBERED.exec(seg);
  const name = m ? m[2] : seg;
  return { numbered: m !== null, name, modular: name.startsWith("_") };
}
const prefixless = (path) => (path === "" ? "" : path.split("/").map((s) => segment(s).name).join("/"));
function titleFromName(name) {
  const t = name.replace(/^_+/, "").replace(/[-_]+/g, " ").trim();
  return t === "" ? name : ucfirst(t);
}
const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
/** s without the trailing characters in `chars` (a loop, so a long run of blanks costs one pass). */
const rtrim = (s, chars) => { let e = s.length; while (e > 0 && chars.includes(s[e - 1])) e--; return s.slice(0, e); };
/** The text of a level-one heading line (# Title, # Title #), or "". */
function headingOne(line) {
  const h = /^#[ \t]+(.*)$/.exec(line);
  if (!h) return "";
  let t = rtrim(h[1], " \t");
  const u = rtrim(t, "#");
  if (u !== t && (u === "" || " \t".includes(u[u.length - 1]))) t = rtrim(u, " \t");
  return t;
}

/**
 * Seconds since 1970 (UTC) for the date formats Grav documents: 2026-03-09 14:30, 17:34 07/04/2014 (month/day/year)
 * and 09-03-2026 or 09.03.2026 (day-month-year). null when the text is none of them.
 */
export function parseDate(text) {
  const s = String(text ?? "").trim();
  let y = 0, mo = 0, d = 0;
  let m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) { y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]); }
  else if ((m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s))) { mo = Number(m[1]); d = Number(m[2]); y = Number(m[3]); }
  else if ((m = /(\d{1,2})[-.](\d{1,2})[-.](\d{4})/.exec(s))) { d = Number(m[1]); mo = Number(m[2]); y = Number(m[3]); }
  else return null;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s.replace(m[0], " "));
  const h = t ? Number(t[1]) : 0;
  const mi = t ? Number(t[2]) : 0;
  const sec = t && t[3] !== undefined ? Number(t[3]) : 0;
  if (h > 23 || mi > 59 || sec > 59) return null;
  return Date.UTC(y, mo - 1, d, h, mi, sec) / 1000;
}

/** The page header (YAML between --- lines) and the markdown after it. */
function frontMatter(md) {
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(\n|$)/.exec(md);
  return m ? { data: parseYaml(m[1]), body: md.slice(m[0].length) } : { data: {}, body: md };
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

/**
 * Where the pages are: a whole Grav install (user/pages/), the user folder on its own as Git Sync keeps it (pages/),
 * or the pages folder itself (numbered folders at the top). `user` is where config/ and images/ sit, or null.
 */
export function findRoot(list) {
  const inFolder = /^[^/]+\/(?:.+\/)?[^/]+\.md$/;
  for (const pages of ["user/pages/", "pages/"]) {
    if (list.some((p) => p.startsWith(pages) && inFolder.test(p.slice(pages.length)))) return { pages, user: pages.slice(0, pages.length - 6) };
  }
  return list.some((p) => /^\d+\.[^/]+\/(?:.+\/)?[^/]+\.md$/.test(p)) ? { pages: "", user: null } : null;
}

// ---- the outline: one page per folder ----

/** Every folder under the pages root that holds a markdown file, and its ancestors: Map(dir -> [markdown file names]). */
function readFolders(src, root) {
  const folders = new Map();
  for (const p of src.list) {
    if (!p.startsWith(root.pages) || !/\.md$/.test(p)) continue;
    const rel = p.slice(root.pages.length);
    const cut = rel.lastIndexOf("/");
    if (cut === -1) continue;
    const segs = rel.slice(0, cut).split("/");
    for (let i = 1; i <= segs.length; i++) { const d = segs.slice(0, i).join("/"); if (!folders.has(d)) folders.set(d, []); }
    folders.get(rel.slice(0, cut)).push(rel.slice(cut + 1));
  }
  return folders;
}

/** The page file of a folder: one without a language, else the site's language, else the first by name. */
function pickFile(mds, lang) {
  let best = null;
  for (const f of mds.slice().sort(byText)) {
    const m = PAGE_FILE.exec(f);
    if (!m) continue;
    const l = m[2] || "";
    const rank = l === "" ? 0 : l === lang ? 1 : 2;
    if (best === null || rank < best.rank) best = { file: f, template: m[1], rank };
  }
  return best;
}

/** One node per folder that is not inside a module, in path order: Map(dir -> node). */
function buildNodes(folders, lang) {
  const nodes = new Map();
  for (const dir of [...folders.keys()].sort(byText)) {
    const segs = dir.split("/");
    if (segs.slice(0, -1).some((s) => segment(s).modular)) continue;
    const me = segment(segs[segs.length - 1]);
    const pick = pickFile(folders.get(dir), lang);
    nodes.set(dir, {
      dir, name: me.name, numbered: me.numbered, modular: me.modular, parent: segs.slice(0, -1).join("/"),
      file: pick ? `${dir}/${pick.file}` : null, template: pick ? pick.template : "", others: pick ? folders.get(dir).length - 1 : 0,
      header: {}, body: null, title: "", created: null, capped: false,
    });
  }
  return nodes;
}

/** Header, body, title and date of a node from its page file. */
function readNode(node, text) {
  const fm = frontMatter(text.replace(/\r\n?/g, "\n"));
  node.header = fm.data;
  let body = fm.body;
  let title = stringOf(node.header.title);
  if (title === "") {
    // a page with no title in its header is titled by its first level-one heading
    const lines = body.split("\n");
    let i = 0;
    while (i < lines.length && lines[i].trim() === "") i++;
    const h = i < lines.length ? headingOne(lines[i]) : "";
    if (h !== "") { title = h; lines.splice(i, 1); body = lines.join("\n"); }
  }
  node.title = title;
  node.body = body;
  node.created = parseDate(stringOf(node.header.date));
}

/** The folders directly under a parent, in the order Grav lists them: pages and modules apart. */
function childrenOf(nodes, parent) {
  const pages = [];
  const modules = [];
  for (const n of nodes.values()) if (n.parent === parent) (n.modular ? modules : pages).push(n);
  return { pages, modules };
}

/** Whether a page lists its child pages itself (a blog: content.items '@self.children'), so they need no menu prefix. */
function listsChildren(node) {
  return node !== null && stringList(mapOf(node.header.content).items).includes("@self.children");
}

/** Children by folder name, or by date when the parent's header asks (content.order.by: date, dir: asc | desc). */
function orderPages(pages, parentNode) {
  const order = mapOf(mapOf(parentNode ? parentNode.header.content : null).order);
  if (stringOf(order.by) !== "date") return pages;
  const sign = stringOf(order.dir).toLowerCase() === "desc" ? -1 : 1;
  return pages.slice().sort((a, b) => {
    if (a.created === null || b.created === null) return a.created === b.created ? 0 : a.created === null ? 1 : -1;
    return a.created === b.created ? 0 : (a.created < b.created ? -1 : 1) * sign;
  });
}

/** Modules in the page's own order (content.order.custom lists folder names), then the rest by folder name. */
function orderModules(modules, node) {
  const custom = stringList(mapOf(mapOf(node.header.content).order).custom);
  const out = [];
  for (const c of custom) for (const m of modules) if (m.name === c && !out.includes(m)) out.push(m);
  for (const m of modules) if (!out.includes(m)) out.push(m);
  return out;
}

// ---- page bodies ----

const bump = (st, key) => st.unmapped.set(key, (st.unmapped.get(key) || 0) + 1);
const SHORTCODE = /\[(\/?)([A-Za-z][A-Za-z0-9_-]*)((?:[ =][^\]\n]*)?)\]/g;

/**
 * Grav's additions to markdown, outside fenced code: the summary delimiter (===) goes, notice lines (! text) become
 * quotes, {.class} attribute blocks go, Twig goes when the page processes it, and shortcode tags that have a closing
 * tag ([name]...[/name]) are removed around their content. Twig and shortcodes are counted, never dropped silently.
 */
function prepare(body, twig, st) {
  const parts = [];
  let chunk = [];
  let fenced = false;
  const flush = () => { if (chunk.length) { parts.push({ text: chunk.join("\n") }); chunk = []; } };
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { flush(); parts.push({ code: line }); fenced = !fenced; continue; }
    if (fenced) { parts.push({ code: line }); continue; }
    if (line.trim() === "===") continue;
    const notice = /^(!{1,4})[ \t]+(.+)$/.exec(line);
    const l = notice ? `> ${notice[2]}` : line;
    const cut = l.replace(/\{[.#][^{}]*\}[ \t]*$/, "");
    chunk.push(cut === l ? l : rtrim(cut, " \t"));
  }
  flush();
  const closers = new Set();
  for (const p of parts) if (p.text !== undefined) for (const m of p.text.matchAll(/\[\/([A-Za-z][A-Za-z0-9_-]*)\]/g)) closers.add(m[1]);
  return parts.map((p) => {
    if (p.text === undefined) return p.code;
    let t = p.text;
    if (twig) t = t.replace(/\{#[\s\S]*?#\}|\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}/g, () => { bump(st, "twig"); return ""; });
    if (closers.size) {
      t = t.replace(SHORTCODE, (all, slash, name) => {
        if (!closers.has(name)) return all;
        if (slash === "") bump(st, `shortcode:${name}`);
        return "";
      });
    }
    return t;
  }).join("\n");
}

async function markdown(ctx, text) {
  if (text.trim() === "") return "";
  const r = await ctx.contracts.call("import.file", "convert", { name: "page.md", data: Buffer.from(`\n${text}`, "utf8").toString("base64") });
  if (!r || typeof r.html !== "string") throw new Error(`markdown could not be converted: ${(r && r.error) || "no result"}`);
  return r.html;
}

// ---- links and media ----

/** The file a page's reference points at, or null: beside the page, by folder or route, or through a Grav stream. */
function mediaPath(ref, baseDir, st) {
  const clean = decode(ref.split("#")[0].split("?")[0]);
  if (clean === "") return null;
  const root = st.root;
  const candidates = [];
  const stream = /^(image|user|page|theme):\/\/(.*)$/.exec(clean);
  if (stream) {
    if (stream[1] === "page") candidates.push(`${root.pages}${stream[2]}`);
    else if (root.user !== null && stream[1] === "image") candidates.push(`${root.user}images/${stream[2]}`);
    else if (root.user !== null && stream[1] === "user") candidates.push(`${root.user}${stream[2]}`);
  } else if (isExternal(clean)) return null;
  else if (clean[0] === "/") {
    if (root.user !== null && clean.startsWith("/user/")) candidates.push(`${root.user}${clean.slice(6)}`);
    candidates.push(`${root.pages}${clean.slice(1)}`);
  } else candidates.push(`${root.pages}${baseDir}/${clean}`);
  for (const c of candidates) { const n = normalizePath(c); if (st.src.paths.has(n)) return n; }
  if (stream) return null;
  // the folder written the way Grav routes it (../other-page/photo.jpg for 02.other-page)
  const cut = clean.lastIndexOf("/");
  const folder = cut === -1 ? "" : clean.slice(0, cut);
  const key = prefixless(normalizePath(clean[0] === "/" ? folder : `${baseDir}/${folder}`));
  if (!st.dirByKey.has(key)) return null;
  const n = `${root.pages}${st.dirByKey.get(key)}/${clean.slice(cut + 1)}`;
  return st.src.paths.has(n) ? n : null;
}

function uniqueFileName(repoPath, st) {
  const base = repoPath.split("/").pop().replace(/[^A-Za-z0-9._-]+/g, "-");
  if (!st.fileNames.has(base)) { st.fileNames.add(base); return base; }
  const dot = base.lastIndexOf(".");
  const stem = dot === -1 ? base : base.slice(0, dot);
  const ext = dot === -1 ? "" : base.slice(dot);
  let n = 1;
  while (st.fileNames.has(`${stem}-${n}${ext}`)) n++;
  st.fileNames.add(`${stem}-${n}${ext}`);
  return `${stem}-${n}${ext}`;
}

/** A file of the site that a page uses, added to the list for the new site's files/ folder; its site path, or null. */
function registerAsset(ref, baseDir, st) {
  if (typeof ref !== "string" || ref === "") return null;
  const repoPath = mediaPath(ref, baseDir, st);
  if (repoPath === null || !IMPORTABLE.test(repoPath)) return null;
  if (st.filesByPath.has(repoPath)) return st.filesByPath.get(repoPath);
  const path = `files/${uniqueFileName(repoPath, st)}`;
  st.media.push({ path, repoPath });
  st.filesByPath.set(repoPath, path);
  return path;
}

/** The imported page a link points at (by route, by folder, with or without numeric prefixes), or null. */
function pageSlug(href, baseDir, st) {
  let target = decode(href.split("#")[0].split("?")[0]);
  if (target === "") return null;
  if (/\.md$/.test(target)) target = target.includes("/") ? target.slice(0, target.lastIndexOf("/")) : ".";
  const key = prefixless(normalizePath(target[0] === "/" ? target : `${baseDir}/${target}`));
  return key !== "" && st.slugByKey.has(key) ? st.slugByKey.get(key) : null;
}

/** Images become media-image, links between pages point at the imported slugs, files join the file list. */
function rewrite(html, baseDir, st) {
  html = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\ssrc="([^"]*)"/i.exec(tag);
    if (!src || src[1] === "") return tag;
    const alt = /\salt="([^"]*)"/i.exec(tag);
    const file = registerAsset(src[1], baseDir, st);
    const source = file !== null ? file : isExternal(src[1]) && IMAGE.test(src[1].split("#")[0].split("?")[0]) ? src[1] : null;
    return source === null ? tag : `<media-image source="${escAttr(source)}" alt="${escAttr(alt ? alt[1] : "")}"></media-image>`;
  });
  return html.replace(/(<a\b[^>]*?\shref=")([^"]*)(")/gi, (m, pre, href, post) => {
    if (href === "" || href[0] === "#") return m;
    if (!isExternal(href)) {
      const slug = pageSlug(href, baseDir, st);
      if (slug !== null) return `${pre}${slug}${href.includes("#") ? href.slice(href.indexOf("#")) : ""}${post}`;
    }
    const file = registerAsset(href, baseDir, st);
    return file === null ? m : `${pre}${escAttr(file)}${post}`;
  });
}

async function renderBody(ctx, body, heading, node, st) {
  const twig = isTrue(mapOf(node.header.process).twig) || st.twig;
  let text = prepare(body, twig, st);
  if (heading !== "" && !/^\s*#/.test(text)) text = `## ${heading}\n\n${text}`;
  return strip(rewrite(await markdown(ctx, text), node.dir, st)).trim();
}

// ---- the import ----

async function importSite(ctx, src) {
  const root = findRoot(src.list);
  if (root === null) return { error: `no Grav pages found in ${src.repo || src.name} (expected user/pages/ or pages/ with a folder per page)` };

  // configuration: the site's title and description, its language, its home page, whether pages run Twig
  const configPaths = root.user === null ? [] : [`${root.user}config/site.yaml`, `${root.user}config/system.yaml`].filter((p) => src.paths.has(p));
  const configs = await src.readMany(configPaths, false);
  const yamlOf = (p) => (typeof configs.get(p) === "string" ? parseYaml(configs.get(p)) : {});
  const site = root.user === null ? {} : yamlOf(`${root.user}config/site.yaml`);
  const system = root.user === null ? {} : yamlOf(`${root.user}config/system.yaml`);
  const lang = stringList(mapOf(system.languages).supported)[0] || "";
  const home = prefixless(normalizePath(stringOf(mapOf(system.home).alias) || "/home"));

  const nodes = buildNodes(readFolders(src, root), lang);
  if (!nodes.size) return { error: `no Grav pages found in ${src.repo || src.name} (expected user/pages/ or pages/ with a folder per page)` };

  // the first MAX_PAGES page files are read in one call, in folder order
  const wanted = [];
  let truncated = false;
  for (const n of nodes.values()) {
    if (!n.file) continue;
    if (wanted.length >= MAX_PAGES) { n.capped = true; truncated = true; continue; }
    wanted.push(`${root.pages}${n.file}`);
  }
  const texts = await src.readMany(wanted, false);
  for (const n of nodes.values()) {
    const text = n.file && !n.capped ? texts.get(`${root.pages}${n.file}`) : null;
    if (typeof text === "string") readNode(n, text);
  }

  const st = { src, root, twig: isTrue(mapOf(mapOf(system.pages).process).twig), unmapped: new Map(), media: [], fileNames: new Set(), filesByPath: new Map(), slugByKey: new Map(), dirByKey: new Map() };
  const items = [];
  const outline = [];
  const used = new Set();
  let modules = 0;
  let languageFiles = 0;
  const walk = (parentDir, parentNode, parentItem, route, depth) => {
    let pages = orderPages(childrenOf(nodes, parentDir).pages, parentNode);
    // the page Grav serves at / goes first, as the new site's home
    if (parentDir === "") { const h = pages.filter((n) => prefixless(n.dir) === home); if (h.length) pages = [h[0], ...pages.filter((n) => n !== h[0])]; }
    let order = 0;
    for (const n of pages) {
      const own = titleSlug(stringOf(n.header.slug) || n.name);
      let slug = parentItem ? `${parentItem.slug}/${own}` : own;
      for (let i = 2, s = slug; used.has(slug); i++) slug = `${s}-${i}`;
      used.add(slug);
      const metadata = { sourceType: "grav", grav: { path: `${root.pages}${n.file || n.dir}`, template: n.template } };
      const visible = has(n.header, "visible") ? isTrue(n.header.visible) : n.numbered || listsChildren(parentNode);
      if (!visible || (has(n.header, "routable") && isFalse(n.header.routable))) metadata.hideInMenu = true;
      if (has(n.header, "published") && isFalse(n.header.published)) metadata.published = false;
      if (n.created !== null) metadata.created = n.created;
      const tags = stringList(mapOf(n.header.taxonomy).tag);
      if (tags.length) metadata.tags = tags;
      const item = { id: `item-${items.length + 1}`, title: n.title || titleFromName(n.name), slug, parent: parentItem ? parentItem.id : null, order: order++, indent: depth, content: "<p></p>", metadata };
      items.push(item);
      outline.push({ node: n, item });
      languageFiles += n.others;
      // links reach a page by its folders (with or without prefixes) or by its route (header slugs)
      const here = `${route}/${stringOf(n.header.slug) || n.name}`;
      st.slugByKey.set(prefixless(n.dir), slug);
      st.slugByKey.set(prefixless(normalizePath(here)), slug);
      st.dirByKey.set(prefixless(n.dir), n.dir);
      walk(n.dir, n, item, here, depth + 1);
    }
  };
  walk("", null, null, "", 0);

  for (const { node, item } of outline) {
    let html = node.body === null ? "" : await renderBody(ctx, node.body, "", node, st);
    for (const m of orderModules(childrenOf(nodes, node.dir).modules, node)) {
      modules++;
      languageFiles += m.others;
      if (m.body !== null) html += await renderBody(ctx, m.body, m.title, m, st);
    }
    const link = stringOf(node.header.external_url) || stringOf(node.header.redirect).replace(/\[\d+\]$/, "");
    if (html === "" && link !== "") html = `<p><a href="${escAttr(link)}">${escAttr(item.title)}</a></p>`;
    item.content = html === "" ? "<p></p>" : html;
  }

  // media: a repository's files are fetched by core from their URLs; a zip's are read here and handed over as data
  let files = [];
  if (src.rawUrl) files = st.media.map((f) => ({ path: f.path, url: src.rawUrl(f.repoPath) }));
  else if (st.media.length) {
    const data = await src.readMany(st.media.map((f) => f.repoPath), true);
    for (const f of st.media) if (typeof data.get(f.repoPath) === "string") files.push({ path: f.path, data: data.get(f.repoPath) });
  }

  const out = { title: stringOf(site.title) || src.name, items, files };
  const description = stringOf(mapOf(site.metadata).description);
  if (description !== "") out.site = { description };
  if (truncated) out.truncated = true;
  out.stats = { pages: items.length, modules, media: files.length, languageFiles };
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
       * Reads a Grav site from a GitHub repository (or an uploaded zip of one): one page per folder under its pages
       * folder, ordered and shown in the menu by numeric prefix, titled, dated and tagged from each page header, with
       * modules folded into their page, links between pages pointed at the imported slugs, and the images and files
       * pages use listed for the new site. Twig and shortcodes are not run; what was left out is counted in stats.
       *
       * @param {object} ctx    Platform context (spec/13); the repository or zip is read through import-source.tree, so nothing is fetched here.
       * @param {object} input  { url } of the repository (https://github.com/<owner>/<repo>, optionally /tree/<branch>), or { files: [{ name, data (base64 zip) }] }.
       * @returns {Promise<object>}  { title, items, files, site?, truncated?, stats } or { error }.
       */
      async convert(ctx, input) {
        input = input || {};
        try {
          if (Array.isArray(input.files) && input.files.length) {
            const f = input.files[0] || {};
            if (!/\.zip$/i.test(String(f.name || ""))) return { error: "expected a .zip of the Grav site" };
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
