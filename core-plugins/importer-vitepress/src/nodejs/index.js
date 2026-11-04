// VitePress importer (Node). Mirrored in src/php/Plugin.php; both return identical results.
// Port of core's convertVitepressToSite.js, kept to the main path: the sidebar read out of .vitepress/config.* as data
// (never executed), pages, front matter titles, containers and Vue components. Markdown goes to import.file
// (import-markdown) through the platform.
const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
const MAX_PAGES = 500;
const CONFIG = /(^|\/)\.vitepress\/config\.(mjs|mts|js|ts)$/;
const IMPORTABLE = /\.(jpg|jpeg|png|gif|webm|webp|mp4|mp3|mov|csv|ppt|pptx|xlsx|doc|xls|docx|pdf|rtf|txt|vtt|xml)$/i;
const IMAGE = /\.(jpg|jpeg|png|gif|webp)$/i;
// The OER containers the VitePress OER plugin defines; each becomes an oer-schema element whose attributes become
// nested oer-schema properties under the names the plugin emits as itemprops (core's mapping)
const OER_CONTAINERS = {
  "learning-objective": { resource: "LearningObjective", properties: { skill: "skill", course: "forCourse" } },
  assessment: { resource: "Assessment", properties: { type: "additionalType", points: "gradingFormat", assessing: "assessing" } },
  practice: { resource: "Practice", properties: { action: "typeOfAction", material: "material" } },
  "learning-component": { resource: "LearningComponent", properties: { action: "typeOfAction", objective: "hasLearningObjective" } },
  "instructional-pattern": { resource: "InstructionalPattern", properties: { type: "additionalType", title: "name" } },
};
// VitePress's default custom containers onto stop-note statuses
const NOTES = { info: ["info", "Info"], tip: ["success", "Tip"], warning: ["warning", "Warning"], danger: ["stop", "Danger"] };

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
const escHtml = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const isExternal = (ref) => /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(ref);
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const encPath = (p) => p.split("/").map((s) => encodeURIComponent(s)).join("/");
const isSpace = (c) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === "\v" || c === "\f";

/** Drop script elements and inline event handlers; core sanitizes again on save. */
function strip(html) {
  return String(html)
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
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

/** owner, repo and optional branch from a github.com URL, or null. */
export function parseRepo(url) {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)(?:\/tree\/([^/?#]+))?/i.exec(String(url).trim());
  return m ? { owner: m[1], name: m[2].replace(/\.git$/i, ""), branch: m[3] || null } : null;
}

/** Front matter: only the top-level `key: value` lines (the title is all this importer needs). */
function frontMatter(md) {
  const m = /^---\n([\s\S]*?)\n---[ \t]*(\n|$)/.exec(md);
  if (!m) return { data: {}, body: md };
  const data = {};
  for (const line of m[1].split("\n")) {
    const k = /^([A-Za-z0-9_-]+):\s+(.*)$/.exec(line);
    if (!k) continue;
    const v = k[2].trim();
    const q = /^"((?:\\.|[^"\\])*)"|^'((?:''|[^'])*)'/.exec(v);
    data[k[1]] = q ? (q[1] !== undefined ? q[1].replace(/\\(.)/g, "$1") : q[2].replace(/''/g, "'")) : v.replace(/\s+#.*$/, "");
  }
  return { data, body: md.slice(m[0].length) };
}

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

/** One sidebar array, or a map of path prefix to arrays merged in order. */
function normalizeSidebar(sidebar) {
  if (Array.isArray(sidebar)) return sidebar;
  if (sidebar && typeof sidebar === "object") {
    const merged = [];
    for (const k of Object.keys(sidebar)) if (Array.isArray(sidebar[k])) merged.push(...sidebar[k]);
    return merged.length ? merged : null;
  }
  return null;
}

function readConfig(src) {
  let sidebar = null;
  const literal = literalValue(src, "sidebar");
  if (literal !== null) { try { sidebar = normalizeSidebar(parseJsLiteral(literal)); } catch { sidebar = null; } }
  return { sidebar, title: stringValue(src, "title"), base: stringValue(src, "base"), siteUrl: stringValue(src, "siteUrl") };
}

// ---- reading the site: GitHub (core's path) or an uploaded zip of the repository ----

async function fromGithub(ctx, url) {
  const gh = parseRepo(url);
  if (!gh) return { error: "url must be a GitHub repository (https://github.com/<owner>/<repo>)" };
  const getJson = async (u, what) => {
    let r;
    try { r = await ctx.fetch(u); } catch (e) { throw new Error(`unable to reach ${what}`); }
    if (!r.ok) throw new Error(`unable to read ${what} (HTTP ${r.status})`);
    return r.json();
  };
  const repo = `${gh.owner}/${gh.name}`;
  const info = await getJson(`${API}/repos/${repo}`, `the repository ${repo}`);
  const branch = gh.branch || (info && info.default_branch) || "main";
  const tree = await getJson(`${API}/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, `the file tree of ${repo}`);
  const paths = {};
  for (const t of (tree && Array.isArray(tree.tree) ? tree.tree : [])) if (t && t.type === "blob" && typeof t.path === "string") paths[t.path] = true;
  const rawUrl = (p) => `${RAW}/${repo}/${encPath(branch)}/${encPath(p)}`;
  const read = async (p) => { try { const r = await ctx.fetch(rawUrl(p)); return r.ok ? await r.text() : null; } catch { return null; } };
  return { name: gh.name, repo, branch, paths, read, rawUrl };
}

async function fromArchive(ctx, file) {
  let texts;
  try { texts = await ctx.archive.read(String(file.data || ""), { match: "(\\.md|\\.vitepress/config\\.(mjs|mts|js|ts))$" }); } catch (e) { return { error: "the file is not a zip archive" }; }
  const keys = Object.keys(texts || {}).sort(byText);
  // a GitHub download keeps everything under <repo>-<branch>/
  const first = keys.length ? keys[0].split("/")[0] + "/" : "";
  const cut = first !== "/" && keys.length && keys.every((k) => k.startsWith(first)) && keys.every((k) => k.length > first.length) ? first.length : 0;
  const files = {};
  for (const k of keys) files[k.slice(cut)] = texts[k];
  const paths = {};
  for (const k of Object.keys(files)) paths[k] = true;
  return { name: String(file.name || "site").replace(/\.zip$/i, ""), repo: null, branch: null, paths, read: async (p) => (p in files ? String(files[p]).replace(/\r\n?/g, "\n") : null), rawUrl: null };
}

// ---- the outline ----

const docsPrefix = (src) => (src.docsRoot === "" ? "" : `${src.docsRoot}/`);

/** The markdown file behind a link: site-absolute (after base) or relative to the page that carries it. */
function resolveDocPath(link, src, node) {
  let target = String(link).split("#")[0].split("?")[0];
  if (src.config.base && target.startsWith(src.config.base)) target = `/${target.slice(src.config.base.length)}`;
  target = target.replace(/\.(md|html)$/i, "").replace(/\/$/, "");
  const prefix = docsPrefix(src);
  let base;
  if (target.startsWith("/")) base = `${prefix}${target.replace(/^\//, "")}`;
  else if (node && node.path) base = normalizePath(`${node.path.split("/").slice(0, -1).join("/")}/${target}`);
  else base = `${prefix}${target}`;
  base = base.replace(/\/+$/, "");
  if (base === "" || base === prefix.replace(/\/$/, "")) return `${prefix}index.md`;
  if (src.paths[`${base}.md`]) return `${base}.md`;
  if (src.paths[`${base}/index.md`]) return `${base}/index.md`;
  return `${base}.md`;
}

/** Sidebar entries into flat nodes; a group with only items becomes a landing page. */
function outlineFromSidebar(sidebar, src) {
  const nodes = [];
  const walk = (entries, depth, parentIndex) => {
    let order = 0;
    for (const e of entries) {
      if (!e || typeof e !== "object" || Array.isArray(e) || typeof e.text !== "string") continue;
      const link = typeof e.link === "string" ? e.link : null;
      nodes.push({ title: e.text, path: link === null ? null : resolveDocPath(link, src), link, depth, order: order++, parentIndex });
      if (Array.isArray(e.items)) walk(e.items, depth + 1, nodes.length - 1);
    }
  };
  walk(sidebar, 0, null);
  return nodes;
}

function titleFromPath(path) {
  const words = path.split("/").pop().replace(/\.md$/i, "").replace(/[-_]+/g, " ").trim();
  return words === "" || words === "index" ? "Home" : ucfirst(words);
}

/** Every markdown page under the docs root, shallowest first, index first, when no sidebar can be read. */
function outlineFromTree(src) {
  const prefix = docsPrefix(src);
  const isIndex = (p) => (/(^|\/)index\.md$/i.test(p) ? 0 : 1);
  return Object.keys(src.paths)
    .filter((p) => p.startsWith(prefix) && /\.md$/i.test(p) && !p.includes("/.vitepress/") && !p.startsWith(".vitepress/") && !p.includes("node_modules/"))
    .sort((a, b) => a.split("/").length - b.split("/").length || isIndex(a) - isIndex(b) || byText(a, b))
    .map((path, order) => ({ title: titleFromPath(path), path, link: `/${path.slice(prefix.length).replace(/\.md$/i, "")}`, depth: 0, order, parentIndex: null }));
}

// ---- page bodies ----

/** name="value", name='value', name={value} and bare flags out of a tag or container info string. */
function parseAttributes(text) {
  const out = {};
  const re = /([A-Za-z][A-Za-z0-9_:-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|\{([^}]*)\}))?/g;
  let m;
  while ((m = re.exec(text)) !== null) out[m[1]] = m[2] === undefined ? "true" : String(m[3] ?? m[4] ?? m[5] ?? "").trim().replace(/^['"]|['"]$/g, "");
  return out;
}

/** VideoEmbed becomes a video-player (held aside as raw HTML); any other Vue component is unwrapped to its content. */
function mapVueComponents(md, node, st, held) {
  const body = md.replace(/<VideoEmbed\b([\s\S]*?)\/?>(?:\s*<\/VideoEmbed>)?/g, (m, raw) => {
    const a = parseAttributes(raw);
    const source = typeof a.src === "string" ? a.src : "";
    if (source === "") return "";
    const resolved = registerAsset(source, node, st) || absoluteSourceUrl(source, node, st);
    const title = a.title || a.caption;
    held.push(`<video-player source="${escAttr(resolved)}"${title ? ` media-title="${escAttr(title)}"` : ""}>${a.caption ? `<div slot="caption">${escHtml(a.caption)}</div>` : ""}</video-player>`);
    return `\n\u0001${held.length - 1}\u0001\n`;
  });
  return body.replace(/<\/?([A-Z][A-Za-z0-9]*)\b[^>]*>/g, "");
}

/** A ::: container: OER containers become oer-schema, the default ones stop-note or details; others are unwrapped. */
function container(name, rest) {
  const oer = OER_CONTAINERS[name];
  if (oer) {
    const a = parseAttributes(rest);
    let open = `<oer-schema typeof="${escAttr(oer.resource)}">`;
    for (const k of Object.keys(a)) if (oer.properties[k]) open += `<oer-schema oer-property="${escAttr(oer.properties[k])}" text="${escAttr(a[k])}"></oer-schema>`;
    return { open, close: "</oer-schema>" };
  }
  const title = rest.trim();
  if (NOTES[name]) return { open: `<stop-note status="${NOTES[name][0]}" title="${escAttr(title || NOTES[name][1])}"><div slot="message">`, close: "</div></stop-note>" };
  if (name === "details") return { open: `<details><summary>${escHtml(title || "Details")}</summary>`, close: "</details>" };
  return { open: "", close: "" };
}

/** The page body as a tree of markdown runs, raw HTML and container wrappers, so markdown inside a wrapper still renders. */
function parseBody(body, held) {
  const lines = body.split("\n");
  const root = { children: [] };
  const stack = [root];
  let md = [];
  const top = () => stack[stack.length - 1];
  const flush = () => { if (md.length) top().children.push({ md: md.join("\n") }); md = []; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const open = /^\s{0,3}(`{3,}|~{3,})\s*(.*)$/.exec(line);
    if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
      const code = [];
      let j = i + 1, closed = false;
      for (; j < lines.length; j++) {
        const c = /^\s{0,3}(`{3,}|~{3,})\s*$/.exec(lines[j]);
        if (c && c[1][0] === open[1][0] && c[1].length >= open[1].length) { closed = true; break; }
        code.push(lines[j]);
      }
      i = closed ? j : lines.length;
      md.push("```" + /^[\w-]*/.exec(open[2].trim())[0], ...code, "```");
      continue;
    }
    const fence = /^\s{0,3}:{3,}\s*([A-Za-z][\w-]*)?(.*)$/.exec(line);
    if (fence) {
      flush();
      if (fence[1] === undefined) { if (stack.length > 1) stack.pop(); continue; }
      const frame = { ...container(fence[1], fence[2]), children: [] };
      top().children.push(frame);
      stack.push(frame);
      continue;
    }
    const parts = line.split(/\u0001(\d+)\u0001/);
    for (let k = 0; k < parts.length; k++) {
      if (k % 2 === 1) { flush(); top().children.push({ html: held[Number(parts[k])] }); continue; }
      if (parts.length === 1 || parts[k].trim() !== "") md.push(parts[k]);
    }
  }
  flush();
  return root.children;
}

/** Markdown to HTML through the platform: import.file picks the .md implementer (import-markdown). */
async function markdown(ctx, text) {
  if (text.trim() === "") return "";
  const r = await ctx.contracts.call("import.file", "convert", { name: "page.md", data: Buffer.from(`\n${text}`, "utf8").toString("base64") });
  if (!r || typeof r.html !== "string") throw new Error(`markdown could not be converted: ${(r && r.error) || "no result"}`);
  return r.html;
}

async function renderTree(ctx, nodes) {
  let out = "";
  for (const n of nodes) {
    if (n.md !== undefined) out += await markdown(ctx, n.md);
    else if (n.html !== undefined) out += n.html;
    else out += n.open + (await renderTree(ctx, n.children)) + n.close;
  }
  return out;
}

// ---- links and assets ----

/** A repository path for an asset reference: public/ (served at the site root) first for absolute ones. */
function resolveAssetPath(ref, node, st) {
  const prefix = docsPrefix(st.src);
  let candidates;
  if (ref.startsWith("/")) {
    let target = ref.replace(/^\//, "");
    if (st.src.config.base) { const base = st.src.config.base.replace(/^\//, ""); if (target.startsWith(base)) target = target.slice(base.length); }
    candidates = [`${prefix}public/${target}`, `${prefix}${target}`, target];
  } else {
    const dir = node.path ? node.path.split("/").slice(0, -1).join("/") : prefix.replace(/\/$/, "");
    candidates = [normalizePath(`${dir}/${ref}`)];
  }
  for (const c of candidates) if (st.src.paths[c]) return c;
  return null;
}

function uniqueFileName(repoPath, st) {
  const base = repoPath.split("/").pop().replace(/[^A-Za-z0-9._-]+/g, "-");
  if (!st.fileNames[base]) { st.fileNames[base] = true; return base; }
  const dot = base.lastIndexOf(".");
  const stem = dot === -1 ? base : base.slice(0, dot);
  const ext = dot === -1 ? "" : base.slice(dot);
  let n = 1;
  while (st.fileNames[`${stem}-${n}${ext}`]) n++;
  st.fileNames[`${stem}-${n}${ext}`] = true;
  return `${stem}-${n}${ext}`;
}

/** A repository file the page references, added to files for core to fetch; its site path, or null. */
function registerAsset(ref, node, st) {
  if (!st.src.rawUrl || typeof ref !== "string" || ref === "" || isExternal(ref)) return null;
  const clean = ref.split("#")[0].split("?")[0];
  if (clean === "" || !IMPORTABLE.test(clean)) return null;
  const repoPath = resolveAssetPath(clean, node, st);
  if (repoPath === null) return null;
  if (st.filesByPath[repoPath]) return st.filesByPath[repoPath];
  const path = `files/${uniqueFileName(repoPath, st)}`;
  st.files.push({ path, url: st.src.rawUrl(repoPath) });
  st.filesByPath[repoPath] = path;
  return path;
}

/** Anything else relative points at the source repository, so the page still resolves (left as written for a zip). */
function absoluteSourceUrl(ref, node, st) {
  if (isExternal(ref) || !st.src.rawUrl) return ref;
  const clean = ref.split("#")[0].split("?")[0];
  const repoPath = resolveAssetPath(clean, node, st);
  if (repoPath !== null) return st.src.rawUrl(repoPath);
  const prefix = docsPrefix(st.src);
  if (clean.startsWith("/")) return st.src.rawUrl(`${prefix}${clean.replace(/^\//, "")}`);
  const dir = node.path ? node.path.split("/").slice(0, -1).join("/") : prefix.replace(/\/$/, "");
  return st.src.rawUrl(normalizePath(`${dir}/${clean}`));
}

/** Images become media-image, video sources resolve, in-site links point at the imported slugs, files join the list. */
function rewrite(html, node, st) {
  html = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\ssrc="([^"]*)"/i.exec(tag);
    if (!src || src[1] === "") return tag;
    const alt = /\salt="([^"]*)"/i.exec(tag);
    const resolved = registerAsset(src[1], node, st) || absoluteSourceUrl(src[1], node, st);
    if (IMAGE.test(resolved) || resolved.startsWith("files/")) return `<media-image source="${escAttr(resolved)}" alt="${escAttr(alt ? alt[1] : "")}"></media-image>`;
    return tag.replace(src[0], () => ` src="${escAttr(resolved)}"`);
  });
  html = html.replace(/(<video-player\b[^>]*?\ssource=")([^"]*)(")/gi, (m, pre, source, post) => {
    if (source === "" || source.startsWith("files/") || source.startsWith("http")) return m;
    return `${pre}${escAttr(registerAsset(source, node, st) || absoluteSourceUrl(source, node, st))}${post}`;
  });
  return html.replace(/(<a\b[^>]*?\shref=")([^"]*)(")/gi, (m, pre, href, post) => {
    if (href === "" || href[0] === "#" || isExternal(href)) return m;
    const doc = resolveDocPath(href.split("#")[0], st.src, node);
    if (st.slugByPath[doc]) return `${pre}${st.slugByPath[doc]}${href.includes("#") ? href.slice(href.indexOf("#")) : ""}${post}`;
    return `${pre}${escAttr(registerAsset(href, node, st) || absoluteSourceUrl(href, node, st))}${post}`;
  });
}

async function renderPage(ctx, text, node, st) {
  const fm = frontMatter(text.replace(/\r\n?/g, "\n"));
  if (typeof fm.data.title === "string" && fm.data.title.trim() !== "") node.item.title = fm.data.title.trim();
  const held = [];
  const body = mapVueComponents(fm.body, node, st, held);
  const html = strip(rewrite(await renderTree(ctx, parseBody(body, held)), node, st)).trim();
  return html === "" ? "<p></p>" : html;
}

const fallback = (source) => (source ? `<p>Read this page on <a href="${escAttr(source)}">the source site</a>.</p>` : "<p></p>");

/** The config that describes the site: docs/.vitepress first, then one at the root, then the shallowest left. */
function findConfig(paths) {
  const rank = (p) => (p.startsWith("docs/.vitepress/") ? 0 : p.startsWith(".vitepress/") ? 1 : 2);
  return Object.keys(paths).filter((p) => CONFIG.test(p)).sort((a, b) => rank(a) - rank(b) || a.split("/").length - b.split("/").length || byText(a, b))[0] || null;
}

async function importSite(ctx, src) {
  const configPath = findConfig(src.paths);
  if (!configPath) return { error: `no .vitepress/config file found in ${src.repo || src.name}` };
  const configText = await src.read(configPath);
  if (configText === null) return { error: `unable to read ${configPath}` };
  src.docsRoot = configPath.slice(0, configPath.indexOf(".vitepress/")).replace(/\/$/, "");
  src.config = readConfig(configText);
  const outline = src.config.sidebar ? outlineFromSidebar(src.config.sidebar, src) : outlineFromTree(src);
  if (!outline.length) return { error: "the VitePress site has no pages to import" };
  const st = { src, files: [], fileNames: {}, filesByPath: {}, slugByPath: {} };
  const items = [];
  const used = new Set();
  for (const node of outline) {
    const parent = node.parentIndex === null ? null : items[node.parentIndex];
    let slug = parent ? `${parent.slug}/${titleSlug(node.title)}` : titleSlug(node.title);
    for (let n = 2, s = slug; used.has(slug); n++) slug = `${s}-${n}`;
    used.add(slug);
    const metadata = { sourceType: "vitepress", vitepress: { repo: src.repo, branch: src.branch, path: node.path } };
    // a link already written with the base keeps it once
    const link = node.link && src.config.base && node.link.startsWith(src.config.base) ? `/${node.link.slice(src.config.base.length)}` : node.link;
    if (link && src.config.siteUrl) metadata.source = `${src.config.siteUrl.replace(/\/$/, "")}${src.config.base ? src.config.base.replace(/\/$/, "") : ""}${link}`;
    const item = { id: `item-${items.length + 1}`, title: node.title, slug, parent: parent ? parent.id : null, order: node.order, indent: node.depth, content: "<p></p>", metadata };
    items.push(item);
    node.item = item;
    if (node.path) st.slugByPath[node.path] = slug;
  }
  let read = 0;
  for (const node of outline) {
    if (!node.path) continue;
    if (read >= MAX_PAGES) { node.item.content = fallback(node.item.metadata.source); continue; }
    const text = await src.read(node.path);
    read++;
    node.item.content = text === null ? fallback(node.item.metadata.source) : await renderPage(ctx, text, node, st);
  }
  return { title: src.config.title || src.name, items, files: st.files };
}

export default {
  contracts: {
    "import.platform": {
      /**
       * Implements contract import.platform, operation convert (dispatch: chosen).
       *
       * Reads a VitePress site from a GitHub repository (or an uploaded zip of one): the sidebar out of
       * .vitepress/config.* as plain data (the config is never executed; without a readable sidebar, the markdown file
       * tree), then each page with its front matter title, containers and Vue components. Markdown is converted by
       * import.file, and repository images and files the pages use are listed for core to fetch.
       *
       * @param {object} ctx    Platform context (spec/13); ctx.fetch reaches only api.github.com and raw.githubusercontent.com.
       * @param {object} input  { url } of the repository (https://github.com/<owner>/<repo>, optionally /tree/<branch>), or { files: [{ name, data (base64) }] } with one .zip.
       * @returns {Promise<object>}  { title, items, files } or { error }.
       */
      async convert(ctx, input) {
        input = input || {};
        try {
          let src;
          if (Array.isArray(input.files) && input.files.length) {
            const f = input.files[0] || {};
            if (!/\.zip$/i.test(String(f.name || ""))) return { error: "expected a .zip of the VitePress site" };
            src = await fromArchive(ctx, f);
          } else if (input.url) src = await fromGithub(ctx, input.url);
          else return { error: "url or files is required" };
          if (src.error) return src;
          return await importSite(ctx, src);
        } catch (e) {
          return { error: e.message };
        }
      },
    },
  },
};
