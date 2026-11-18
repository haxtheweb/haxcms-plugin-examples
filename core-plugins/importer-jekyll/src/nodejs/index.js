// Jekyll importer (Node). Mirrored in src/php/Plugin.php; both return identical results.
// Reads a Jekyll site as data: its pages, posts and collections, each page's front matter, _config.yml, the navigation
// the common themes keep in front matter (parent and nav_order, as Just the Docs does), and the Liquid tags that have a
// plain equivalent. Nothing of Jekyll runs: no layouts, no includes, no plugins. The repository or zip is listed and
// read through import-source.tree, front matter and configuration through import-frontmatter.data, markdown through
// import.file.
const MAX_PAGES = 500;
const IMPORTABLE = /\.(jpg|jpeg|png|gif|webm|webp|mp4|mp3|mov|csv|ppt|pptx|xlsx|doc|xls|docx|pdf|rtf|txt|vtt|xml)$/i;
const IMAGE = /\.(jpg|jpeg|png|gif|webp)$/i;
const PAGE_EXT = /\.(md|markdown|html)$/;
// a post's file name: its date and its title
const POST_NAME = /^(\d{4})-(\d{2})-(\d{2})-(.+)\.(md|markdown|html)$/;
// files GitHub Pages leaves out when they have no front matter (jekyll-optional-front-matter)
const NOT_PAGES = new Set(["readme", "license", "licence", "copying", "code_of_conduct", "contributing", "issue_template", "pull_request_template", "changelog", "security"]);
// what Jekyll leaves out by default, on top of names starting with _ . # or ending with ~
const DEFAULT_EXCLUDE = ["node_modules", "vendor", "gemfiles", "Gemfile", "Gemfile.lock", ".sass-cache", ".jekyll-cache"];
// what is read as text out of a zip: pages and configuration
const SOURCE_TEXT = "\\.(md|markdown|html|yml|yaml|toml)$";

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

// ---- Jekyll helpers ----

const isTrue = (v) => String(v ?? "").trim().toLowerCase() === "true";
const isFalse = (v) => String(v ?? "").trim().toLowerCase() === "false";
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
const pad2 = (n) => (n < 10 ? `0${n}` : String(n));
/** A list of non-empty strings out of a list, a single value, or (for tags and categories) words. */
function stringList(v, words) {
  const out = [];
  for (const x of Array.isArray(v) ? v : [v]) {
    if (typeof x !== "string") continue;
    for (const w of words ? x.split(/\s+/) : [x]) if (w.trim() !== "") out.push(w.trim());
  }
  return out;
}
function titleFromName(name) {
  const t = name.replace(/[-_]+/g, " ").trim();
  return t === "" ? name : ucfirst(t);
}
/** Jekyll's title for a post from its file name: every word capitalised. */
const titleize = (slug) => slug.split(/[-_ ]+/).filter((w) => w !== "").map((w) => ucfirst(w)).join(" ");
/** The text of a level-one heading line (# Title, # Title #), or "". */
function headingOne(line) {
  const h = /^#[ \t]+(.*)$/.exec(line);
  if (!h) return "";
  let t = rtrim(h[1], " \t");
  const u = rtrim(t, "#");
  if (u !== t && (u === "" || " \t".includes(u[u.length - 1]))) t = rtrim(u, " \t");
  return t;
}
/** A number written in front matter (nav_order: 2, 2.5, -1), or null. */
function numberOf(v) {
  const s = String(v ?? "").trim();
  return /^-?\d{1,9}(\.\d{1,9})?$/.test(s) ? Number(s) : null;
}

/**
 * Seconds since 1970 for a Jekyll date: 2026-03-09, 2026-03-09 14:30:00, 2026-03-09T14:30:00 -0500 or +02:00.
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
  if (k === "index") return "";
  if (k.endsWith("/index")) k = k.slice(0, -6);
  return trimSlashes(k);
}

/** A post's address from a permalink pattern (Jekyll's named styles or a pattern of :placeholders). */
export function postUrl(pattern, post) {
  const styles = {
    date: "/:categories/:year/:month/:day/:title:output_ext",
    pretty: "/:categories/:year/:month/:day/:title/",
    ordinal: "/:categories/:year/:y_day/:title:output_ext",
    weekdate: "/:categories/:year/W:week/:short_day/:title:output_ext",
    none: "/:categories/:title:output_ext",
  };
  const p = Object.prototype.hasOwnProperty.call(styles, pattern) ? styles[pattern] : pattern || styles.date;
  const values = {
    year: String(post.year), month: pad2(post.month), day: pad2(post.day), i_month: String(post.month), i_day: String(post.day),
    short_year: String(post.year).slice(2), title: post.slug, slug: post.slug, categories: post.categories.map((c) => lower(c).split(" ").join("-")).join("/"), output_ext: ".html",
  };
  const url = p.replace(/:([a-z_]+)/g, (all, name) => (Object.prototype.hasOwnProperty.call(values, name) ? values[name] : ""));
  return `/${url.split("/").filter((s) => s !== "").join("/")}${url.endsWith("/") ? "/" : ""}`;
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

/** The Jekyll site in the files: the shallowest folder holding _config.yml (or .yaml, .toml). { dir, config } or null. */
export function findSite(list) {
  let best = null;
  for (const p of list) {
    const m = /^((?:[^/]+\/)*)_config\.(yml|yaml|toml)$/.exec(p);
    if (!m) continue;
    const depth = m[1] === "" ? 0 : m[1].split("/").length - 1;
    const order = best === null ? -1 : depth - best.depth || (m[2] === "yml" ? 0 : 1) - (best.ext === "yml" ? 0 : 1) || byText(p, best.config);
    if (order < 0) best = { dir: m[1], config: p, depth, ext: m[2] };
  }
  return best === null ? null : { dir: best.dir, config: best.config };
}

const formatOf = (path) => { const ext = path.slice(path.lastIndexOf(".") + 1); return ext === "yml" ? "yaml" : ext; };

/** Whether Jekyll reads a path of the site (relative to its folder): not excluded, not hidden, not under _site. */
function readable(rel, st) {
  for (const x of st.exclude) if (rel === x || rel.startsWith(`${x}/`)) return false;
  if (st.include.has(rel)) return true;
  return rel.split("/").every((seg, i, all) => i === all.length - 1 ? !/^[.#]|~$/.test(seg) && (!seg.startsWith("_") || st.include.has(seg)) : !/^[.#]/.test(seg) && (!seg.startsWith("_") || st.include.has(seg)));
}

// ---- the documents: pages, posts and collection documents ----

/** Every document Jekyll would render: { file, rel, kind: page | post | doc, collection, ... }. */
function findDocs(src, st) {
  const docs = [];
  let drafts = 0;
  for (const p of src.list) {
    if (!p.startsWith(st.dir) || !PAGE_EXT.test(p)) continue;
    const rel = p.slice(st.dir.length);
    const segs = rel.split("/");
    // posts: <category folders>/_posts/<more folders>/YYYY-MM-DD-title.md
    const at = segs.indexOf("_posts");
    if (at !== -1) {
      const m = POST_NAME.exec(segs[segs.length - 1]);
      if (!m || !segs.slice(0, at).every((s) => !s.startsWith("_") && !s.startsWith("."))) continue;
      docs.push({ file: p, rel, kind: "post", collection: "posts", folderCategories: segs.slice(0, at), date: { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }, slug: m[4] });
      continue;
    }
    if (segs.includes("_drafts")) { drafts++; continue; }
    // collections: _<label>/<path>, under collections_dir
    const inColl = st.collectionsDir === "" || rel.startsWith(`${st.collectionsDir}/`) ? rel.slice(st.collectionsDir === "" ? 0 : st.collectionsDir.length + 1) : null;
    const label = inColl !== null && inColl.startsWith("_") && inColl.includes("/") ? inColl.slice(1, inColl.indexOf("/")) : null;
    if (label !== null && st.collections.has(label)) { docs.push({ file: p, rel, kind: "doc", collection: label, path: inColl.slice(label.length + 2) }); continue; }
    // the error page is the site's, not content
    if (readable(rel, st) && !/^404\.(md|markdown|html)$/.test(rel)) docs.push({ file: p, rel, kind: "page", collection: null });
  }
  return { docs, drafts };
}

// ---- Liquid: the tags with a plain equivalent are kept, the rest removed and counted ----

const bump = (st, key) => st.unmapped.set(key, (st.unmapped.get(key) || 0) + 1);
const BLOCK_ENDS = new Set(["else", "elsif", "when", "break", "continue"]);

/** A Liquid value: a quoted string, site.*, page.*, or (when unknown) null. */
function liquidValue(expr, doc, st) {
  const v = expr.trim();
  if (/^"[^"]*"$|^'[^']*'$/.test(v)) return v.slice(1, -1);
  if (v === "site.baseurl" || v === "site.url" || v === "site.github.url") return "";
  if (v.startsWith("site.") && /^[A-Za-z0-9_]+$/.test(v.slice(5)) && typeof st.config[v.slice(5)] === "string") return st.config[v.slice(5)];
  if (v === "page.title") return doc.title;
  if (v.startsWith("page.") && /^[A-Za-z0-9_]+$/.test(v.slice(5)) && typeof doc.data[v.slice(5)] === "string") return doc.data[v.slice(5)];
  return null;
}

/**
 * Liquid in a document, read by scanning (no template runs): {% raw %} keeps its text, {% comment %} goes,
 * {% highlight %} becomes a code fence, {% link %} and {% post_url %} become the address they name, {{ }} becomes a
 * known site or page value (site.baseurl is empty, so addresses start at the site's root), and every other tag is
 * removed, its block's text kept, and counted in stats.unmapped.
 */
function liquid(text, doc, st) {
  let out = "";
  let i = 0;
  let fenced = false;
  // the next {% tag %} from position p: { start, end, name, args } or null
  const nextTag = (p) => {
    for (let s = text.indexOf("{%", p); s !== -1; s = text.indexOf("{%", s + 2)) {
      const e = text.indexOf("%}", s + 2);
      if (e === -1) return null;
      const inner = ltrim(rtrim(text.slice(s + 2, e), " \t\n-"), " \t\n-");
      const name = /^[A-Za-z_]+/.exec(inner);
      return { start: s, end: e + 2, name: name ? name[0] : "", args: name ? inner.slice(name[0].length).trim() : "" };
    }
    return null;
  };
  // the closing {% end<name> %} after p, or null
  const closing = (p, name) => { for (let t = nextTag(p); t !== null; t = nextTag(t.end)) if (t.name === `end${name}`) return t; return null; };
  while (i < text.length) {
    const a = text.indexOf("{%", i);
    const b = text.indexOf("{{", i);
    const s = a === -1 ? b : b === -1 ? a : Math.min(a, b);
    if (s === -1) { out += text.slice(i); break; }
    out += text.slice(i, s);
    if (s === b) {
      const e = text.indexOf("}}", s + 2);
      if (e === -1) { out += text.slice(s); break; }
      const parts = text.slice(s + 2, e).split("|");
      const value = liquidValue(parts[0], doc, st);
      if (value === null) bump(st, "liquid:output");
      else out += value;
      i = e + 2;
      continue;
    }
    const t = nextTag(s);
    if (t === null) { out += text.slice(s); break; }
    i = t.end;
    if (t.name === "raw" || t.name === "comment" || t.name === "highlight") {
      const c = closing(t.end, t.name);
      const inner = c === null ? text.slice(t.end) : text.slice(t.end, c.start);
      i = c === null ? text.length : c.end;
      if (t.name === "raw") out += inner;
      else if (t.name === "highlight") {
        const lang = /^[A-Za-z0-9_+-]+/.exec(t.args);
        out += `\n\`\`\`${lang ? lang[0] : ""}\n${inner.replace(/^\n+|\n+$/g, "")}\n\`\`\`\n`;
        fenced = true;
      }
      continue;
    }
    if (t.name === "link" || t.name === "post_url") {
      const target = /^["']?([^"'\s]+)["']?/.exec(t.args);
      if (target) out += t.name === "link" ? `/${trimSlashes(target[1])}` : `/_posts/${trimSlashes(target[1])}`;
      continue;
    }
    if (t.name.startsWith("end") || BLOCK_ENDS.has(t.name)) continue;
    bump(st, `liquid:${t.name || "tag"}`);
  }
  // a highlight block's fence stands on its own lines
  return fenced ? out.replace(/\n{2,}(```)/g, "\n$1").replace(/(```[A-Za-z0-9_+-]*)\n{2,}/g, "$1\n") : out;
}

/** kramdown's additions, outside fenced code: {: attribute lists} and {::options} go, and so does a {:toc} list. */
function kramdown(body) {
  const out = [];
  let fenced = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) { out.push(line); fenced = !fenced; continue; }
    if (fenced) { out.push(line); continue; }
    const t = line.trim();
    if (/^\{:\s*\.?toc\s*\}$/.test(t)) { if (out.length && /^\s*([*+-]|\d+\.)\s/.test(out[out.length - 1])) out.pop(); continue; }
    if (/^\{::?[^{}]*\}$/.test(t)) continue;
    const cut = line.replace(/\{:[^{}\n]*\}/g, "");
    out.push(cut === line ? line : rtrim(cut, " \t"));
  }
  return out.join("\n");
}

async function markdown(ctx, text) {
  if (text.trim() === "") return "";
  const r = await ctx.contracts.call("import.file", "convert", { name: "page.md", data: Buffer.from(`\n${text}`, "utf8").toString("base64") });
  if (!r || typeof r.html !== "string") throw new Error(`markdown could not be converted: ${(r && r.error) || "no result"}`);
  return r.html;
}

// ---- links and media ----

/** A reference as a path on the site ("/x/y") when it is written against the site's own address or baseurl, else as written. */
function onSite(ref, st) {
  let r = ref;
  if (st.url !== "" && lower(r).startsWith(st.url)) { const rest = r.slice(st.url.length); r = rest === "" ? "/" : rest[0] === "/" ? rest : r; }
  if (st.baseurl !== "" && r[0] === "/" && (r === `/${st.baseurl}` || r.startsWith(`/${st.baseurl}/`))) r = r.slice(st.baseurl.length + 1) || "/";
  return r;
}

/** The file a document's reference points at, or null: from the site's root, or beside the document. */
function mediaPath(ref, doc, st) {
  const clean = decode(withoutQuery(onSite(ref, st)));
  if (clean === "" || isExternal(clean)) return null;
  const candidates = clean[0] === "/" ? [`${st.dir}${clean.slice(1)}`] : [`${st.dir}${dirOf(doc.rel)}/${clean}`, `${st.dir}${trimSlashes(dirOf(doc.url))}/${clean}`];
  for (const c of candidates) { const n = normalizePath(c); if (st.src.paths.has(n) && readable(n.slice(st.dir.length), st)) return n; }
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

/** A file of the site that a document uses, added to the list for the new site's files/ folder; its site path, or null. */
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

/** The imported page a link points at: by its address, by its file, or (from {% link %} / {% post_url %}) its source path. */
function pageSlug(href, doc, st) {
  const target = decode(withoutQuery(onSite(href, st)));
  if (target === "" || isExternal(target)) return null;
  const candidates = target[0] === "/" ? [target] : [`${dirOf(doc.url)}/${target}`, `${dirOf(doc.rel)}/${target}`];
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
  const text = liquid(doc.body, doc, st);
  const html = doc.ext === "html" ? text : await markdown(ctx, kramdown(text));
  return strip(rewrite(html, doc, st)).trim();
}

// ---- the outline ----

/** Siblings in navigation order: nav_order (numbers first, then text), then header_pages, then title, then path. */
function navOrder(a, b) {
  const na = a.nav;
  const nb = b.nav;
  if (na.kind !== nb.kind) return na.kind - nb.kind;
  if (na.kind === 0 && na.value !== nb.value) return na.value < nb.value ? -1 : 1;
  if (na.kind === 1 && na.value !== nb.value) return byText(na.value, nb.value);
  const t = byText(lower(a.title), lower(b.title));
  return t !== 0 ? t : byText(a.rel, b.rel);
}

/** Posts newest first, then by path. */
function postOrder(a, b) {
  const ca = a.created === null ? 0 : a.created;
  const cb = b.created === null ? 0 : b.created;
  return ca !== cb ? (ca > cb ? -1 : 1) : byText(b.rel, a.rel);
}

// ---- the import ----

async function frontMatterCall(ctx, op, input) {
  const r = await ctx.contracts.call("import-frontmatter.data", op, input);
  if (!r || (op === "split" ? !Array.isArray(r.results) : r.data === undefined && r.error === undefined)) throw new Error(`front matter could not be read: ${(r && r.error) || "no result"}`);
  return r;
}

async function importSite(ctx, src) {
  const found = findSite(src.list);
  if (found === null) return { error: `no Jekyll site found in ${src.repo || src.name} (expected a _config.yml)` };
  const configs = await src.readMany([found.config], false);
  const config = typeof configs.get(found.config) === "string" ? mapOf((await frontMatterCall(ctx, "parse", { format: formatOf(found.config), text: configs.get(found.config) })).data) : {};

  // collections: a map of labels or a list of them; posts are one of them
  const collections = new Map();
  const declared = config.collections;
  if (Array.isArray(declared)) { for (const c of stringList(declared)) collections.set(c, {}); }
  else for (const [k, v] of Object.entries(mapOf(declared))) collections.set(k, mapOf(v));
  collections.delete("posts");
  const st = {
    src, dir: found.dir, config, collections, collectionsDir: trimSlashes(stringOf(config.collections_dir)),
    exclude: [...DEFAULT_EXCLUDE, ...stringList(config.exclude).map((x) => trimSlashes(x))], include: new Set(stringList(config.include).map((x) => trimSlashes(x))),
    url: lower(rtrim(stringOf(config.url), "/")), baseurl: trimSlashes(stringOf(config.baseurl)),
    unmapped: new Map(), media: [], fileNames: new Set(), filesByPath: new Map(), slugByKey: new Map(),
  };
  const found2 = findDocs(src, st);
  let docs = found2.docs;

  // read every document (up to MAX_PAGES) in one call, and split their front matter in one call
  let truncated = false;
  if (docs.length > MAX_PAGES) { docs = docs.slice(0, MAX_PAGES); truncated = true; }
  const texts = await src.readMany(docs.map((d) => d.file), false);
  docs = docs.filter((d) => typeof texts.get(d.file) === "string");
  const split = docs.length ? (await frontMatterCall(ctx, "split", { texts: docs.map((d) => texts.get(d.file)) })).results : [];
  const kept = [];
  docs.forEach((d, i) => {
    const r = split[i] || {};
    d.data = mapOf(r.data);
    d.ext = d.file.slice(d.file.lastIndexOf(".") + 1);
    const hasFront = r.format !== undefined && r.format !== "none";
    // a page needs front matter, except markdown (GitHub Pages reads it without), and never the repository's README etc.
    if (d.kind === "page" && !hasFront && (d.ext === "html" || NOT_PAGES.has(lower(stem(baseOf(d.rel)))))) {
      if (!(lower(d.rel) === "readme.md" && !docs.some((o) => /^index\.(md|markdown|html)$/.test(o.rel)))) return;
      d.readmeHome = true;
    }
    let body = typeof r.body === "string" ? r.body : "";
    let title = stringOf(d.data.title);
    if (title === "" && d.ext !== "html") {
      // a document with no title in its front matter is titled by its first level-one heading
      const lines = body.split("\n");
      let at = 0;
      while (at < lines.length && lines[at].trim() === "") at++;
      const h = at < lines.length ? headingOne(lines[at]) : "";
      if (h !== "") { title = h; lines.splice(at, 1); body = lines.join("\n"); }
    }
    d.body = body;
    if (title === "") title = d.kind === "post" ? titleize(d.slug) : d.kind === "doc" ? titleFromName(stem(baseOf(d.path))) : titleFromName(stem(baseOf(d.rel)) === "index" ? baseOf(dirOf(d.rel)) || stringOf(config.title) || src.name : stem(baseOf(d.rel)));
    d.title = title;
    const nav = numberOf(d.data.nav_order);
    d.nav = nav !== null ? { kind: 0, value: nav } : stringOf(d.data.nav_order) !== "" ? { kind: 1, value: stringOf(d.data.nav_order) } : { kind: 2, value: 0 };
    // the address Jekyll gives it, and the keys links reach it by
    const permalink = stringOf(d.data.permalink);
    if (d.kind === "post") {
      d.categories = [...d.folderCategories, ...stringList(d.data.categories, true), ...stringList(d.data.category, true)];
      const date = parseDate(stringOf(d.data.date));
      d.created = date !== null ? date : Date.UTC(d.date.year, d.date.month - 1, d.date.day) / 1000;
      d.url = permalink || postUrl(stringOf(config.permalink), { ...d.date, slug: d.slug, categories: d.categories });
    } else {
      d.created = parseDate(stringOf(d.data.date));
      d.url = permalink || (d.kind === "doc" ? `/${d.collection}/${stem(d.path)}` : d.readmeHome ? "/" : `/${stem(d.rel)}`);
    }
    d.keys = [d.url, d.kind === "post" ? `/_posts/${stem(baseOf(d.rel))}` : "", `/${stem(d.rel)}`, ...stringList(d.data.redirect_from)].filter((k) => k !== "");
    kept.push(d);
  });
  docs = kept;
  if (!docs.length) return { error: `no pages found in ${src.repo || src.name}` };

  const siteTitle = stringOf(config.title) || src.name;
  const pages = docs.filter((d) => d.kind === "page");
  const posts = docs.filter((d) => d.kind === "post").sort(postOrder);
  const home = pages.find((d) => normKey(d.url) === "" ) || null;
  const header = stringList(config.header_pages);
  for (const d of pages) { const h = header.indexOf(d.rel); if (h !== -1 && d.nav.kind === 2) d.nav = { kind: 1, value: `~${String(h).padStart(4, "0")}` }; }

  // the parent of each page: by title (parent, grand_parent), as Just the Docs and its kin do; else by folder
  const byTitle = docs.some((d) => stringOf(d.data.parent) !== "");
  const parentOf = new Map();
  const nonPosts = docs.filter((d) => d.kind !== "post" && d !== home);
  if (byTitle) {
    for (const d of nonPosts) {
      const want = stringOf(d.data.parent);
      if (want === "") continue;
      const grand = stringOf(d.data.grand_parent);
      const cands = nonPosts.filter((o) => o !== d && o.title === want && (grand === "" || stringOf(o.data.parent) === grand));
      if (cands.length) parentOf.set(d, cands[0]);
    }
    // a parent chain that loops is cut where it loops
    for (const d of nonPosts) { const seen = new Set([d]); for (let p = parentOf.get(d); p; p = parentOf.get(p)) { if (seen.has(p)) { parentOf.delete(d); break; } seen.add(p); } }
  } else {
    const indexOf = new Map();
    for (const d of pages) if (stem(baseOf(d.rel)) === "index" && d !== home) indexOf.set(dirOf(d.rel), d);
    for (const d of pages) {
      if (d === home) continue;
      let dir = stem(baseOf(d.rel)) === "index" ? dirOf(dirOf(d.rel)) : dirOf(d.rel);
      if (stem(baseOf(d.rel)) === "index" && dirOf(d.rel) === "") continue;
      for (; dir !== ""; dir = dirOf(dir)) if (indexOf.has(dir)) { parentOf.set(d, indexOf.get(dir)); break; }
    }
  }

  // collections become a page each (unless their documents name a parent), posts go under one Posts page
  const items = [];
  const outline = [];
  const used = new Set();
  const add = (d, parentItem, order, depth, synthetic) => {
    const own = titleSlug(d.kind === "post" ? d.slug : synthetic ? synthetic : d === home ? d.title : stringOf(d.data.slug) || (stem(baseOf(d.rel)) === "index" ? baseOf(dirOf(d.rel)) || d.title : stem(baseOf(d.kind === "doc" ? d.path : d.rel))));
    let slug = parentItem ? `${parentItem.slug}/${own}` : own;
    for (let i = 2, s = slug; used.has(slug); i++) slug = `${s}-${i}`;
    used.add(slug);
    const metadata = { sourceType: "jekyll", jekyll: synthetic ? { kind: d.kind } : { path: d.file, kind: d.kind } };
    if (!synthetic) {
      if (isTrue(d.data.nav_exclude)) metadata.hideInMenu = true;
      if (isFalse(d.data.published)) metadata.published = false;
      if (d.created !== null) metadata.created = d.created;
      const tags = stringList(d.data.tags, true);
      if (tags.length) metadata.tags = tags;
    }
    const item = { id: `item-${items.length + 1}`, title: d.title, slug, parent: parentItem ? parentItem.id : null, order, indent: depth, content: "<p></p>", metadata };
    items.push(item);
    if (!synthetic) {
      outline.push({ doc: d, item });
      for (const k of d.keys) { const nk = normKey(k); if (!st.slugByKey.has(nk)) st.slugByKey.set(nk, slug); }
    }
    return item;
  };
  const childrenOf = (parent, pool) => pool.filter((d) => (parentOf.get(d) || null) === parent).sort(navOrder);
  const walk = (parent, parentItem, depth, pool) => {
    let order = 0;
    for (const d of childrenOf(parent, pool)) { const item = add(d, parentItem, order++, depth, null); walk(d, item, depth + 1, pool); }
  };
  let order = 0;
  if (home) add(home, null, order++, 0, null);
  const topPages = nonPosts.filter((d) => d.kind === "page" || parentOf.has(d));
  const tops = childrenOf(null, topPages);
  for (const d of tops) { const item = add(d, null, order++, 0, null); walk(d, item, 1, nonPosts); }
  for (const [label] of [...collections.entries()].sort((a, b) => byText(a[0], b[0]))) {
    const loose = nonPosts.filter((d) => d.kind === "doc" && d.collection === label && !parentOf.has(d));
    if (!loose.length) continue;
    const item = add({ kind: "collection", title: titleize(label), data: {} }, null, order++, 0, label);
    let o = 0;
    for (const d of loose.sort(navOrder)) { const child = add(d, item, o++, 1, null); walk(d, child, 2, nonPosts); }
  }
  if (posts.length) {
    // a top-level page at /blog/ or /posts/ holds them; else a Posts page is made
    const holder = outline.find((o) => o.doc.kind === "page" && o.item.parent === null && ["blog", "posts"].includes(normKey(o.doc.url)));
    const parentItem = holder ? holder.item : add({ kind: "posts", title: "Posts", data: {} }, null, order++, 0, "posts");
    const first = items.filter((it) => it.parent === parentItem.id).length;
    posts.forEach((d, i) => add(d, parentItem, first + i, parentItem.indent + 1, null));
  }

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

  const out = { title: siteTitle, items, files };
  const description = stringOf(config.description);
  if (description !== "") out.site = { description };
  if (truncated) out.truncated = true;
  out.stats = { pages: items.length, posts: posts.length, media: files.length, drafts: found2.drafts };
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
       * Reads a Jekyll site from a GitHub repository (or an uploaded zip of one): its pages (nested by the parent
       * front matter that Just the Docs and its kin use, else by folder), its collections, and its posts under one
       * Posts page, newest first; titled, dated and tagged from front matter, with the Liquid tags that have a plain
       * equivalent converted, links between pages pointed at the imported slugs, and the images and files pages use
       * listed for the new site. Layouts, includes and plugins are not run; what was left out is counted in stats.
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
            if (!/\.zip$/i.test(String(f.name || ""))) return { error: "expected a .zip of the Jekyll site" };
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
