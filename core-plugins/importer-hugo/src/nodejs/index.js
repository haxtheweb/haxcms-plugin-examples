// Hugo importer (Node). Mirrored in src/php/Plugin.php; both return identical results.
// Reads a Hugo site as data: the content tree (sections, page bundles and single pages), each page's front matter
// (YAML, TOML or JSON), the site configuration, and the built-in shortcodes that have a plain equivalent. Nothing of
// Hugo runs: no templates, no theme, no custom shortcodes. The repository or zip is listed and read through
// import-source.tree, front matter and configuration through import-frontmatter.data, markdown through import.file.
const MAX_PAGES = 500;
const IMPORTABLE = /\.(jpg|jpeg|png|gif|webm|webp|mp4|mp3|mov|csv|ppt|pptx|xlsx|doc|xls|docx|pdf|rtf|txt|vtt|xml)$/i;
const IMAGE = /\.(jpg|jpeg|png|gif|webp)$/i;
// a content file: its folders, its name and its format
const CONTENT_FILE = /^((?:[^/]+\/)*)([^/]+)\.(md|markdown|html)$/;
// a site configuration file: hugo.* or config.* at a site's top, or in its config/_default folder
const CONFIG_FILE = /^((?:[^/]+\/)*)(?:(hugo|config)\.(toml|yaml|yml|json)|config\/_default\/(hugo|config)\.(toml|yaml|yml|json))$/;
const OTHER_FORMAT = /\.(adoc|asciidoc|rst|org|pandoc|pdc)$/;
// what is read as text out of a zip: pages and configuration
const SOURCE_TEXT = "\\.(md|markdown|html|toml|yaml|yml|json)$";

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

// ---- Hugo helpers ----

const isTrue = (v) => String(v ?? "").trim().toLowerCase() === "true";
const mapOf = (v) => (isObject(v) ? v : {});
const lower = (s) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());
const decode = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
/** s without the trailing characters in `chars` (a loop, so a long run of blanks costs one pass). */
const rtrim = (s, chars) => { let e = s.length; while (e > 0 && chars.includes(s[e - 1])) e--; return s.slice(0, e); };
const ltrim = (s, chars) => { let b = 0; while (b < s.length && chars.includes(s[b])) b++; return s.slice(b); };
const trimSlashes = (s) => ltrim(rtrim(s, "/"), "/");
const withoutQuery = (ref) => ref.split("#")[0].split("?")[0];
const dirOf = (path) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const baseOf = (path) => path.slice(path.lastIndexOf("/") + 1);
const intOf = (v) => (/^-?\d{1,9}$/.test(String(v ?? "").trim()) ? Number(String(v).trim()) : 0);
/** A list of non-empty strings out of a list or a single value. */
function stringList(v) {
  const out = [];
  for (const x of Array.isArray(v) ? v : [v]) if (typeof x === "string" && x.trim() !== "") out.push(x.trim());
  return out;
}
function titleFromName(name) {
  const t = name.replace(/[-_]+/g, " ").trim();
  return t === "" ? name : ucfirst(t);
}
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

/** How links name a page: no slashes at the ends, lower case, no extension, no index file. */
export function normKey(path) {
  let k = lower(trimSlashes(path)).replace(/\.(md|markdown|html)$/, "");
  if (k === "index" || k === "_index") return "";
  if (k.endsWith("/index")) k = k.slice(0, -6);
  else if (k.endsWith("/_index")) k = k.slice(0, -7);
  return k;
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
 * The Hugo site in the files: the folder holding hugo.* (or config.* beside content/, layouts/, themes/ or
 * archetypes/), the shallowest first. { dir, config } or null.
 */
export function findSite(list) {
  const hugoDirs = new Set();
  for (const p of list) {
    const segs = p.split("/");
    for (let i = 0; i < segs.length - 1; i++) {
      if (segs[i] === "content" || segs[i] === "layouts" || segs[i] === "themes" || segs[i] === "archetypes") hugoDirs.add(i === 0 ? "" : `${segs.slice(0, i).join("/")}/`);
    }
  }
  let best = null;
  for (const p of list) {
    const m = CONFIG_FILE.exec(p);
    if (!m) continue;
    const named = (m[2] || m[4]) === "hugo";
    if (!named && !hugoDirs.has(m[1])) continue;
    // shallowest, then hugo.* before config.*, then a file at the top before config/_default, then by name
    const rank = [m[1] === "" ? 0 : m[1].split("/").length - 1, named ? 0 : 1, m[2] ? 0 : 1];
    const order = best === null ? -1 : rank[0] - best.rank[0] || rank[1] - best.rank[1] || rank[2] - best.rank[2] || byText(p, best.config);
    if (order < 0) best = { dir: m[1], config: p, rank };
  }
  return best === null ? null : { dir: best.dir, config: best.config };
}

const formatOf = (path) => { const ext = path.slice(path.lastIndexOf(".") + 1); return ext === "yml" ? "yaml" : ext; };

// ---- the outline: sections, bundles and pages ----

/**
 * One node per page of the content tree: Map(key -> node), where key is the page's path without extension, language
 * or index file ("posts", "posts/first", "" for the home page). A folder with index.md is one page and what is under
 * it belongs to it; folders without a page file of their own still get a node, to keep their pages together.
 */
function readContent(src, contentRoot, langs, defaultLang) {
  const picks = new Map();
  for (const p of src.list) {
    if (!p.startsWith(contentRoot)) continue;
    const m = CONTENT_FILE.exec(p.slice(contentRoot.length));
    if (!m) continue;
    const dir = rtrim(m[1], "/");
    let name = m[2];
    let lang = "";
    const dot = name.lastIndexOf(".");
    if (dot > 0 && langs.has(name.slice(dot + 1))) { lang = name.slice(dot + 1); name = name.slice(0, dot); }
    const kind = name === "_index" || (name === "index" && dir === "") ? "section" : name === "index" ? "bundle" : "page";
    const key = kind === "page" ? (dir === "" ? name : `${dir}/${name}`) : dir;
    // a file with no language, else the site's language, else any; markdown before HTML
    const rank = (lang === "" ? 0 : lang === defaultLang ? 1 : 2) * 10 + (m[3] === "md" ? 0 : m[3] === "markdown" ? 1 : 2);
    const cur = picks.get(key);
    if (cur === undefined) picks.set(key, { kind, file: p, ext: m[3], rank, files: 1 });
    else {
      cur.files++;
      if (rank < cur.rank || (rank === cur.rank && byText(p, cur.file) < 0)) { cur.kind = kind; cur.file = p; cur.ext = m[3]; cur.rank = rank; }
    }
  }
  const bundles = new Set();
  for (const [key, pick] of picks) if (pick.kind === "bundle") bundles.add(key);
  const nodes = new Map();
  const node = (key, pick) => ({
    key, name: baseOf(key), parent: key === "" ? null : dirOf(key), kind: pick ? pick.kind : "section", file: pick ? pick.file : null, ext: pick ? pick.ext : "",
    resDir: pick && pick.kind === "page" ? dirOf(key) : key, others: pick ? pick.files - 1 : 0,
    data: {}, body: null, title: "", weight: 0, created: null, url: "", capped: false,
  });
  for (const key of [...picks.keys()].sort(byText)) {
    const segs = key === "" ? [] : key.split("/");
    let inBundle = false;
    for (let i = 1; i < segs.length; i++) if (bundles.has(segs.slice(0, i).join("/"))) inBundle = true;
    if (inBundle) continue;
    for (let i = 1; i < segs.length; i++) { const d = segs.slice(0, i).join("/"); if (!nodes.has(d)) nodes.set(d, node(d, picks.get(d))); }
    if (!nodes.has(key)) nodes.set(key, node(key, picks.get(key)));
  }
  return nodes;
}

/** Hugo's default order: weight (set ones first, lowest first), then newest, then title, then path. */
function pageOrder(a, b) {
  if (a.weight !== b.weight) {
    if (a.weight === 0) return 1;
    if (b.weight === 0) return -1;
    return a.weight < b.weight ? -1 : 1;
  }
  if (a.created !== b.created) {
    if (a.created === null) return 1;
    if (b.created === null) return -1;
    return a.created > b.created ? -1 : 1;
  }
  const t = byText(lower(a.title), lower(b.title));
  return t !== 0 ? t : byText(a.key, b.key);
}

// ---- page bodies ----

const bump = (st, key) => st.unmapped.set(key, (st.unmapped.get(key) || 0) + 1);
// {{< name args >}} and {{% name args %}}, opening, closing ({{< /name >}}) or self-closing ({{< name />}})
const SHORTCODE = /\{\{[<%]\s*(\/?)\s*([A-Za-z0-9_][A-Za-z0-9_./-]*)((?:"[^"]*"|`[^`]*`|[^"`])*?)[>%]\}\}/g;
const ARG = /(?:([A-Za-z0-9_-]+)\s*=\s*)?(?:"([^"]*)"|`([^`]*)`|([^\s"`]+))/g;

/** A shortcode's arguments: { named: Map, positional: [] }. */
function shortcodeArgs(text) {
  const named = new Map();
  const positional = [];
  for (const m of text.matchAll(ARG)) {
    const value = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
    if (m[1] !== undefined) named.set(m[1], value);
    else if (value !== "/") positional.push(value);
  }
  return { named, positional };
}

/** What a ref or relref shortcode points at: the imported page's slug (with its #anchor), or the path as written. */
function refTarget(path, node, st) {
  const hash = path.indexOf("#");
  const anchor = hash === -1 ? "" : path.slice(hash);
  const p = hash === -1 ? path : path.slice(0, hash);
  if (p === "") return anchor;
  for (const c of p[0] === "/" ? [p] : [`${node.resDir}/${p}`, p]) {
    const k = normKey(normalizePath(c));
    if (st.slugByKey.has(k)) return `${st.slugByKey.get(k)}${anchor}`;
  }
  // Hugo also finds a page by its file name alone, when only one page has it
  let name = lower(baseOf(p)).replace(/\.(md|markdown|html)$/, "");
  if (name === "index" || name === "_index") name = lower(baseOf(dirOf(p)));
  const byName = st.slugByName.get(name);
  return typeof byName === "string" ? `${byName}${anchor}` : path;
}

/** The built-in shortcodes that have a plain equivalent; everything else is removed around its content and counted. */
function shortcodes(text, node, st) {
  const closers = new Set();
  for (const m of text.matchAll(SHORTCODE)) if (m[1] === "/") closers.add(m[2]);
  let highlighted = false;
  const out = text.replace(SHORTCODE, (all, slash, name, rest) => {
    if (slash === "/") { if (name === "highlight") highlighted = true; return name === "highlight" ? "\n```\n" : ""; }
    const args = shortcodeArgs(rest);
    const first = args.positional.length ? args.positional[0] : "";
    if (name === "ref" || name === "relref") return first === "" ? "" : refTarget(first, node, st);
    if (name === "figure") {
      const src = args.named.get("src") || first;
      if (src) {
        const caption = args.named.get("caption") || args.named.get("title") || "";
        const alt = args.named.get("alt") || caption;
        return `\n\n<img src="${escAttr(src)}" alt="${escAttr(alt)}">\n\n${caption === "" ? "" : `*${caption}*\n\n`}`;
      }
    }
    if (name === "youtube" || name === "vimeo") {
      const id = args.named.get("id") || first;
      if (/^[A-Za-z0-9_-]+$/.test(id)) return `\n\n<video-player source="${name === "youtube" ? "https://www.youtube.com/watch?v=" : "https://vimeo.com/"}${id}"></video-player>\n\n`;
    }
    if (name === "highlight" && closers.has(name)) return `\n\`\`\`${/^[A-Za-z0-9_+-]+$/.test(first) ? first : ""}\n`;
    if (name === "param" && typeof st.params[first] === "string" && Object.prototype.hasOwnProperty.call(st.params, first)) return st.params[first];
    bump(st, `shortcode:${name}`);
    return "";
  });
  // the code sits on its own lines between the highlight tags: no blank line inside the fence made for it
  return highlighted ? out.replace(/(\n```[A-Za-z0-9_+-]*\n)\n/g, "$1").replace(/\n(\n```\n)/g, "$1") : out;
}

/**
 * Hugo's additions to markdown, outside fenced code: the summary divider (<!--more-->) goes, {#id .class} attribute
 * blocks go, and shortcodes are replaced or removed (and counted).
 */
function prepare(body, node, st) {
  const out = [];
  let chunk = [];
  let fenced = false;
  const flush = () => { if (chunk.length) { out.push(shortcodes(chunk.join("\n"), node, st)); chunk = []; } };
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { flush(); out.push(line); fenced = !fenced; continue; }
    if (fenced) { out.push(line); continue; }
    const l = line.split("<!--more-->").join("");
    const cut = l.replace(/\{[.#][^{}]*\}[ \t]*$/, "");
    chunk.push(cut === l ? l : rtrim(cut, " \t"));
  }
  flush();
  return out.join("\n");
}

async function markdown(ctx, text) {
  if (text.trim() === "") return "";
  const r = await ctx.contracts.call("import.file", "convert", { name: "page.md", data: Buffer.from(`\n${text}`, "utf8").toString("base64") });
  if (!r || typeof r.html !== "string") throw new Error(`markdown could not be converted: ${(r && r.error) || "no result"}`);
  return r.html;
}

// ---- links and media ----

/** A reference as a path on the site ("/x/y") when it is written against the site's own address, else as written. */
function onSite(ref, st) {
  if (st.baseUrl !== "" && lower(ref).startsWith(st.baseUrl)) { const rest = ref.slice(st.baseUrl.length); return rest === "" || rest[0] === "/" ? (rest === "" ? "/" : rest) : ref; }
  return ref;
}
/** A site path without the folder the site is served from (baseURL https://example.org/docs/ -> /docs). */
function withoutBasePath(path, st) {
  return st.basePath !== "" && (path === `/${st.basePath}` || path.startsWith(`/${st.basePath}/`)) ? path.slice(st.basePath.length + 1) || "/" : path;
}

/** The file a page's reference points at, or null: beside the page (a bundle's resource), or under static/ or assets/. */
function mediaPath(ref, node, st) {
  const clean = decode(withoutQuery(onSite(ref, st)));
  if (clean === "" || isExternal(clean)) return null;
  const candidates = [];
  if (clean[0] === "/") {
    const path = withoutBasePath(clean, st).slice(1);
    candidates.push(`${st.dir}static/${path}`, `${st.dir}assets/${path}`, `${st.contentRoot}${path}`);
  } else {
    candidates.push(`${st.contentRoot}${node.resDir}/${clean}`);
    if (node.kind === "page") candidates.push(`${st.contentRoot}${node.key}/${clean}`);
    candidates.push(`${st.dir}static/${clean}`);
  }
  for (const c of candidates) { const n = normalizePath(c); if (st.src.paths.has(n)) return n; }
  return null;
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
function registerAsset(ref, node, st) {
  if (typeof ref !== "string" || ref === "") return null;
  const repoPath = mediaPath(ref, node, st);
  if (repoPath === null || !IMPORTABLE.test(repoPath)) return null;
  if (st.filesByPath.has(repoPath)) return st.filesByPath.get(repoPath);
  const path = `files/${uniqueFileName(repoPath, st)}`;
  st.media.push({ path, repoPath });
  st.filesByPath.set(repoPath, path);
  return path;
}

/** The imported page a link points at: by its address on the site, or by its content file, or null. */
function pageSlug(href, node, st) {
  const target = decode(withoutQuery(onSite(href, st)));
  if (target === "" || isExternal(target)) return null;
  const candidates = target[0] === "/" ? [withoutBasePath(target, st), target] : [`${node.url}/${target}`, `${node.resDir}/${target}`];
  for (const c of candidates) {
    const k = normKey(normalizePath(c));
    if (st.slugByKey.has(k)) return st.slugByKey.get(k);
  }
  return null;
}

/** Images become media-image, links between pages point at the imported slugs, files join the file list. */
function rewrite(html, node, st) {
  html = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\ssrc="([^"]*)"/i.exec(tag);
    if (!src || src[1] === "") return tag;
    const alt = /\salt="([^"]*)"/i.exec(tag);
    const file = registerAsset(src[1], node, st);
    const source = file !== null ? file : isExternal(src[1]) && IMAGE.test(withoutQuery(src[1])) ? src[1] : null;
    return source === null ? tag : `<media-image source="${escAttr(source)}" alt="${escAttr(alt ? alt[1] : "")}"></media-image>`;
  });
  return html.replace(/(<a\b[^>]*?\shref=")([^"]*)(")/gi, (m, pre, href, post) => {
    if (href === "" || href[0] === "#") return m;
    const slug = pageSlug(href, node, st);
    if (slug !== null) return `${pre}${slug}${href.includes("#") ? href.slice(href.indexOf("#")) : ""}${post}`;
    const file = registerAsset(href, node, st);
    return file === null ? m : `${pre}${escAttr(file)}${post}`;
  });
}

async function renderBody(ctx, node, st) {
  const html = node.ext === "html" ? shortcodes(node.body, node, st) : await markdown(ctx, prepare(node.body, node, st));
  return strip(rewrite(html, node, st)).trim();
}

// ---- the import ----

async function importSite(ctx, src) {
  const found = findSite(src.list);
  if (found === null) return { error: `no Hugo site found in ${src.repo || src.name} (expected hugo.toml, hugo.yaml or hugo.json, or config.* beside a content folder)` };
  const dir = found.dir;

  // configuration: the main file, plus params.* and languages.* when the site splits its config into config/_default
  const pickFirst = (stem) => ["toml", "yaml", "yml", "json"].map((e) => `${dir}config/_default/${stem}.${e}`).find((p) => src.paths.has(p));
  const extra = { params: pickFirst("params"), languages: pickFirst("languages") };
  const configPaths = [found.config, extra.params, extra.languages].filter((p) => typeof p === "string");
  const configTexts = await src.readMany(configPaths, false);
  const parsed = async (p) => {
    if (typeof p !== "string" || typeof configTexts.get(p) !== "string") return {};
    const r = await ctx.contracts.call("import-frontmatter.data", "parse", { format: formatOf(p), text: configTexts.get(p) });
    if (!r || (r.data === undefined && r.error === undefined)) throw new Error("front matter could not be read: import-frontmatter gave no result");
    return mapOf(r.data);
  };
  const config = await parsed(found.config);
  const params = extra.params ? await parsed(extra.params) : mapOf(config.params);
  const languages = extra.languages ? await parsed(extra.languages) : mapOf(config.languages);
  const defaultLang = stringOf(config.defaultContentLanguage) || "en";
  const langs = new Set([defaultLang, ...Object.keys(languages)]);
  const contentDir = trimSlashes(stringOf(mapOf(languages[defaultLang]).contentDir) || stringOf(config.contentDir) || "content");
  const contentRoot = `${dir}${contentDir}/`;
  const baseUrl = lower(rtrim(stringOf(config.baseURL), "/"));
  const basePath = /^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(.+)$/.exec(baseUrl);

  const nodes = readContent(src, contentRoot, langs, defaultLang);
  if (!nodes.size) return { error: `no pages found under ${contentRoot} in ${src.repo || src.name}` };

  // the first MAX_PAGES page files are read in one call, in path order, and their front matter split in one call
  const wanted = [];
  let truncated = false;
  for (const n of nodes.values()) {
    if (!n.file) continue;
    if (wanted.length >= MAX_PAGES) { n.capped = true; truncated = true; continue; }
    wanted.push(n);
  }
  const texts = await src.readMany(wanted.map((n) => n.file), false);
  const readable = wanted.filter((n) => typeof texts.get(n.file) === "string");
  const splitAll = readable.length ? await ctx.contracts.call("import-frontmatter.data", "split", { texts: readable.map((n) => texts.get(n.file)) }) : { results: [] };
  if (!splitAll || !Array.isArray(splitAll.results)) throw new Error(`front matter could not be read: ${(splitAll && splitAll.error) || "no result"}`);
  readable.forEach((n, i) => {
    const r = splitAll.results[i] || {};
    n.data = mapOf(r.data);
    let body = typeof r.body === "string" ? r.body : "";
    let title = stringOf(n.data.title);
    if (title === "" && n.ext !== "html") {
      // a page with no title in its front matter is titled by its first level-one heading
      const lines = body.split("\n");
      let at = 0;
      while (at < lines.length && lines[at].trim() === "") at++;
      const h = at < lines.length ? headingOne(lines[at]) : "";
      if (h !== "") { title = h; lines.splice(at, 1); body = lines.join("\n"); }
    }
    n.body = body;
    n.title = title;
    n.weight = intOf(n.data.weight);
    n.created = parseDate(stringOf(n.data.date));
  });
  const siteTitle = stringOf(config.title) || stringOf(mapOf(languages[defaultLang]).title) || src.name;
  for (const n of nodes.values()) if (n.title === "") n.title = n.key === "" ? siteTitle : titleFromName(n.name);

  const st = {
    src, dir, contentRoot, baseUrl, basePath: basePath ? trimSlashes(basePath[1]) : "", params,
    unmapped: new Map(), media: [], fileNames: new Set(), filesByPath: new Map(), slugByKey: new Map(), slugByName: new Map(),
  };
  const items = [];
  const outline = [];
  const used = new Set();
  let languageFiles = 0;
  const add = (n, parentItem, order, depth, parentUrl) => {
    const seg = stringOf(n.data.slug) || n.name;
    const own = n.key === "" ? titleSlug(n.title) : titleSlug(seg);
    let slug = parentItem ? `${parentItem.slug}/${own}` : own;
    for (let i = 2, s = slug; used.has(slug); i++) slug = `${s}-${i}`;
    used.add(slug);
    const metadata = { sourceType: "hugo", hugo: { path: n.file || `${contentRoot}${n.key}`, kind: n.key === "" ? "home" : n.kind } };
    if (isTrue(n.data.headless)) metadata.hideInMenu = true;
    if (isTrue(n.data.draft)) metadata.published = false;
    if (n.created !== null) metadata.created = n.created;
    const tags = stringList(n.data.tags);
    if (tags.length) metadata.tags = tags;
    const item = { id: `item-${items.length + 1}`, title: n.title, slug, parent: parentItem ? parentItem.id : null, order, indent: depth, content: "<p></p>", metadata };
    items.push(item);
    outline.push({ node: n, item });
    languageFiles += n.others;
    // links reach a page by its address (folders and slug, lower case), by url and aliases in its front matter, or by its content file
    n.url = n.key === "" ? "" : `${parentUrl}/${lower(seg).split(" ").join("-")}`;
    const keys = [n.key, n.url, stringOf(n.data.url), ...stringList(n.data.aliases)];
    for (const k of keys) if (k !== "" || n.key === "") { const nk = normKey(k); if (!st.slugByKey.has(nk)) st.slugByKey.set(nk, slug); }
    if (n.key !== "") { const nm = lower(n.name); st.slugByName.set(nm, st.slugByName.has(nm) ? null : slug); }
    return item;
  };
  const walk = (parentKey, parentItem, parentUrl, depth, first) => {
    const kids = [];
    for (const n of nodes.values()) if (n.parent === parentKey) kids.push(n);
    kids.sort(pageOrder);
    let order = first;
    for (const n of kids) {
      const item = add(n, parentItem, order++, depth, parentUrl);
      walk(n.key, item, n.url, depth + 1, 0);
    }
  };
  // the home page (content/_index.md) goes first, beside the top-level sections and pages
  const home = nodes.get("");
  if (home) add(home, null, 0, 0, "");
  walk("", null, "", 0, home ? 1 : 0);

  for (const { node, item } of outline) {
    const html = node.body === null ? "" : await renderBody(ctx, node, st);
    item.content = html === "" ? "<p></p>" : html;
  }

  // media: a repository's files are fetched by core from their URLs; a zip's are read here and handed over as data
  let files = [];
  if (src.rawUrl) files = st.media.map((f) => ({ path: f.path, url: src.rawUrl(f.repoPath) }));
  else if (st.media.length) {
    const data = await src.readMany(st.media.map((f) => f.repoPath), true);
    for (const f of st.media) if (typeof data.get(f.repoPath) === "string") files.push({ path: f.path, data: data.get(f.repoPath) });
  }

  // content in formats Hugo converts with outside tools is not read; it is counted, per format
  for (const p of src.list) { const m = p.startsWith(contentRoot) ? OTHER_FORMAT.exec(p) : null; if (m) bump(st, `format:${m[1]}`); }

  const out = { title: siteTitle, items, files };
  const description = stringOf(params.description);
  if (description !== "") out.site = { description };
  if (truncated) out.truncated = true;
  out.stats = { pages: items.length, media: files.length, languageFiles };
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
       * Reads a Hugo site from a GitHub repository (or an uploaded zip of one): one page per section, page bundle and
       * content file, in Hugo's own order (weight, then newest first), titled, dated and tagged from front matter in
       * YAML, TOML or JSON, with the built-in shortcodes that have a plain equivalent converted, links between pages
       * pointed at the imported slugs, and the images and files pages use listed for the new site. Templates, themes
       * and custom shortcodes are not run; what was left out is counted in stats.
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
            if (!/\.zip$/i.test(String(f.name || ""))) return { error: "expected a .zip of the Hugo site" };
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
