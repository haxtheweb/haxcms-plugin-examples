// Quarto importer (Node). Mirrored in src/php/Plugin.php; both return identical results.
// Port of core's convertQuartoToSite.js, kept to the main path: _quarto.yml navigation, pages, front matter titles,
// code chunks, callouts and fenced divs. Markdown goes to import.file (import-markdown) through the platform.
const MAX_PAGES = 500;
const CONFIG = /(^|\/)_quarto\.ya?ml$/;
const PAGE = /\.(qmd|rmd|md)$/i;
const PAGE_EXTENSIONS = [".qmd", ".Rmd", ".rmd", ".md"];
const IMPORTABLE = /\.(jpg|jpeg|png|gif|webm|webp|mp4|mp3|mov|csv|ppt|pptx|xlsx|doc|xls|docx|pdf|rtf|txt|vtt|xml)$/i;
const IMAGE = /\.(jpg|jpeg|png|gif|webp)$/i;
// Quarto's five callout types onto the stop-note statuses HAX offers
const CALLOUTS = {
  note: { status: "info", title: "Note" },
  tip: { status: "success", title: "Tip" },
  important: { status: "stop", title: "Important" },
  warning: { status: "warning", title: "Warning" },
  caution: { status: "warning", title: "Caution" },
};
const SHORTCODE = /\{\{<\s*([A-Za-z0-9_-]+)\s*([\s\S]*?)\s*>\}\}/g;

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

// ---- reading the project: a GitHub repository or an uploaded zip of one, both through import-source ----

// what the importer needs out of a repository or a zip of one: pages and the YAML config
const SOURCE_MATCH = "\\.(qmd|Qmd|md|rmd|Rmd|yml|yaml)$";

/** The project's files through import-source (list, then read what is needed): { name, repo, branch, paths, read, readMany, rawUrl }. */
async function openSource(ctx, input) {
  const upload = Array.isArray(input.files) && input.files.length ? { files: input.files, match: SOURCE_MATCH } : null;
  const listed = await ctx.contracts.call("import-source.tree", "list", upload || { url: input.url });
  if (!listed || listed.error || !Array.isArray(listed.paths)) return { error: (listed && listed.error) || "the project's files could not be listed" };
  const paths = {};
  for (const p of listed.paths) paths[p] = true;
  const from = upload ? { ...upload, prefix: listed.prefix } : { repo: listed.repo, branch: listed.branch };
  const readMany = async (wanted) => {
    const out = {};
    if (!wanted.length) return out;
    const got = await ctx.contracts.call("import-source.tree", "read", { ...from, paths: wanted });
    for (const f of (got && Array.isArray(got.files) ? got.files : [])) out[f.path] = f.data;
    return out;
  };
  const read = async (p) => { const got = await readMany([p]); return typeof got[p] === "string" ? got[p] : null; };
  return { name: listed.name, repo: listed.repo, branch: listed.branch, paths, read, readMany, rawUrl: listed.rawBase ? (p) => `${listed.rawBase}/${encPath(p)}` : null };
}

// ---- the outline (port of core's book / sidebar / navbar / file tree readers) ----

function readConfig(data) {
  const project = isObject(data.project) ? data.project : {};
  const book = isObject(data.book) ? data.book : {};
  const website = isObject(data.website) ? data.website : {};
  let sidebar = null;
  for (const s of Array.isArray(website.sidebar) ? website.sidebar : [website.sidebar]) if (isObject(s) && Array.isArray(s.contents)) { sidebar = s.contents; break; }
  return {
    title: stringOf(book.title) || stringOf(website.title),
    siteUrl: stringOf(book["site-url"]) || stringOf(website["site-url"]),
    outputDir: stringOf(project["output-dir"]).replace(/^\.?\/|\/$/g, ""),
    render: Array.isArray(project.render) ? project.render.filter((e) => typeof e === "string") : null,
    chapters: Array.isArray(book.chapters) ? book.chapters : null,
    appendices: Array.isArray(book.appendices) ? book.appendices : null,
    sidebar,
    navbar: isObject(website.navbar) ? website.navbar : null,
  };
}

const rootPrefix = (src) => (src.root === "" ? "" : `${src.root}/`);

/** A glob over project-relative paths: * stays in a folder, ** crosses them. */
function globToRegExp(pattern) {
  let s = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") { s += ".*"; i++; }
    else if (c === "*") s += "[^/]*";
    else if (c === "?") s += "[^/]";
    else s += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${s}$`);
}

function isIgnored(rel, src) {
  const segs = rel.split("/");
  for (let i = 0; i < segs.length; i++) {
    if (segs[i][0] === "." || segs[i][0] === "_") return true;
    if (i < segs.length - 1 && (/^(node_modules|renv|venv|site-packages)$/.test(segs[i]) || /_(files|cache)$/.test(segs[i]))) return true;
  }
  const name = segs[segs.length - 1];
  if (/^readme\.(md|qmd|rmd|ipynb)$/i.test(name) || /^(agents|claude)\.md$/i.test(name)) return true;
  const out = src.config.outputDir;
  return out !== "" && (rel === out || rel.startsWith(`${out}/`));
}

function isRenderable(rel, src) {
  const render = src.config.render;
  if (!render || !render.length) return true;
  let included = !render.some((e) => e[0] !== "!");
  for (const e of render) {
    const neg = e[0] === "!";
    if (globToRegExp((neg ? e.slice(1) : e).replace(/^\.?\//, "")).test(rel)) included = !neg;
  }
  return included;
}

/** Every page Quarto would render under the project root, shallowest first, index first. */
function listPages(src) {
  const prefix = rootPrefix(src);
  const isIndex = (p) => (/(^|\/)index\.[a-z]+$/i.test(p) ? 0 : 1);
  return Object.keys(src.paths)
    .filter((p) => p.startsWith(prefix))
    .map((p) => p.slice(prefix.length))
    .filter((r) => PAGE.test(r) && !isIgnored(r, src) && isRenderable(r, src))
    .sort((a, b) => a.split("/").length - b.split("/").length || isIndex(a) - isIndex(b) || byText(a, b));
}

function resolvePagePath(ref, src) {
  const clean = String(ref).split("#")[0].split("?")[0].trim();
  if (clean === "" || !PAGE.test(clean)) return null;
  const p = normalizePath(`${rootPrefix(src)}${clean}`);
  return src.paths[p] ? p : null;
}

/** One outline entry in any of the shapes Quarto writes (path, href/text, part, section, menu, auto). */
function describeEntry(entry) {
  if (typeof entry === "string") return { target: entry.trim(), label: "", children: null, auto: null };
  if (!isObject(entry)) return null;
  let target = stringOf(entry.href) || stringOf(entry.file);
  let label = stringOf(entry.text);
  let children = null;
  if (typeof entry.part === "string") {
    if (PAGE.test(entry.part.trim())) target = target || entry.part.trim();
    else label = label || entry.part.trim();
    children = Array.isArray(entry.chapters) ? entry.chapters : [];
  } else if (typeof entry.section === "string") {
    label = entry.section.trim() || label;
    children = Array.isArray(entry.contents) ? entry.contents : [];
  } else if (Array.isArray(entry.menu)) children = entry.menu;
  else if (Array.isArray(entry.contents)) children = entry.contents;
  let auto = null;
  if (entry.auto === true || entry.auto === "true") auto = [];
  else if (typeof entry.auto === "string") auto = [entry.auto];
  else if (Array.isArray(entry.auto)) auto = entry.auto.filter((g) => typeof g === "string");
  return { target, label, children, auto };
}

function addNode(b, path, label, depth, parentIndex, order) {
  const relative = path === null ? null : path.slice(rootPrefix(b.src).length);
  b.nodes.push({ title: label || (relative ? titleFromPath(relative) : "Untitled"), explicit: label !== "", path, relative, depth, order, parentIndex });
  if (path !== null) b.used[path] = true;
  return b.nodes.length - 1;
}

function addGlobNodes(globs, depth, parentIndex, b, order) {
  for (const rel of listPages(b.src)) {
    if (globs.length && !globs.some((g) => globToRegExp(g.replace(/^\.?\//, "")).test(rel))) continue;
    const path = `${rootPrefix(b.src)}${rel}`;
    if (b.used[path]) continue;
    addNode(b, path, "", depth, parentIndex, order++);
  }
  return order;
}

/** Entries into flat nodes pointing at their parent by index; a group without a page becomes a landing page. */
function walkEntries(entries, depth, parentIndex, b, order) {
  for (const e of entries) {
    const info = describeEntry(e);
    if (!info) continue;
    if (/^-{3,}$/.test(info.target) || /^-{3,}$/.test(info.label)) continue;
    if (info.auto !== null) { order = addGlobNodes(info.auto, depth, parentIndex, b, order); continue; }
    if (info.target.includes("*")) { order = addGlobNodes([info.target], depth, parentIndex, b, order); continue; }
    const external = info.target !== "" && isExternal(info.target);
    if (external && info.children === null) continue;
    let path = external ? null : resolvePagePath(info.target, b.src);
    if (path !== null && b.used[path]) path = null;
    if (path === null && info.label === "" && info.children === null) continue;
    const node = addNode(b, path, info.label, depth, parentIndex, order++);
    if (info.children !== null) walkEntries(info.children, depth + 1, node, b, 0);
  }
  return order;
}

function buildOutline(src) {
  const c = src.config;
  const b = { src, nodes: [], used: {} };
  if (c.chapters || c.appendices) {
    const order = c.chapters ? walkEntries(c.chapters, 0, null, b, 0) : 0;
    if (c.appendices) walkEntries(c.appendices, 0, null, b, order);
  } else if (c.sidebar) walkEntries(c.sidebar, 0, null, b, 0);
  else if (c.navbar) {
    let order = 0;
    for (const side of ["left", "right"]) if (Array.isArray(c.navbar[side])) order = walkEntries(c.navbar[side], 0, null, b, order);
  }
  if (!b.nodes.length) addGlobNodes([], 0, null, b, 0);
  return b.nodes;
}

function titleFromPath(path) {
  const words = path.split("/").pop().replace(PAGE, "").replace(/[-_]+/g, " ").trim();
  return words === "" || words.toLowerCase() === "index" ? "Home" : ucfirst(words);
}

// ---- page bodies ----

/** #id, .class and key=value pairs out of a pandoc attribute block. */
function parseAttributes(text) {
  const out = { id: "", classes: [], values: {} };
  const re = /(?:#([^\s.#}"']+))|(?:\.([^\s.#}"']+))|([A-Za-z][A-Za-z0-9_:-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'}]+)))?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) out.id = m[1];
    else if (m[2] !== undefined) out.classes.push(m[2]);
    else if (m[3] !== undefined) out.values[m[3]] = m[4] ?? m[5] ?? m[6] ?? "true";
  }
  return out;
}

function headingText(text) {
  return text.replace(/\s*\{[^}]*\}\s*$/, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/`(.+?)`/g, "$1").trim();
}

/** A content-visible / content-hidden div applies to html output unless its formats say otherwise. */
function appliesToHtml(values) {
  const names = (v) => stringOf(v).toLowerCase().split(/[\s,]+/).filter((n) => n !== "");
  const when = names(values["when-format"]);
  const unless = names(values["unless-format"]);
  if (when.length && !when.includes("html")) return false;
  return !unless.includes("html");
}

/** A fenced block: code chunks lose their braces and #| options (hidden ones vanish); {=html} passes through. */
function codeBlock(info, code) {
  const raw = /^\{=([A-Za-z0-9_-]+)\}$/.exec(info);
  if (raw) return raw[1].toLowerCase() === "html" ? { html: code.join("\n") } : null;
  const chunk = /^\{\s*\.?([A-Za-z0-9_+-]+)\s*(?:,\s*|\s+)?([^}]*)\}$/.exec(info);
  let lang = "";
  if (chunk) {
    const options = {};
    while (code.length && /^\s*#\|/.test(code[0])) {
      const o = /^\s*#\|\s*([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(code.shift());
      if (o) options[o[1]] = o[2].trim().toLowerCase();
    }
    if (options.echo === "false" || options.include === "false" || /\b(echo|include)\s*=\s*(FALSE|F|false)\b/.test(chunk[2] || "")) return null;
    lang = chunk[1];
  } else lang = info.split(/\s+/)[0];
  return { lines: ["```" + lang.replace(/[^\w-]/g, ""), ...code, "```"] };
}

function outsideInlineCode(line, fn) {
  return line.split(/(`+[^`]*`+)/).map((piece, i) => (i % 2 === 1 ? piece : fn(piece))).join("");
}

/** Inline pandoc syntax the markdown converter does not know: attribute blocks, spans, cross-references. */
function transformInline(line) {
  let r = line.replace(/^(#{1,6}\s+.*?)\s+\{[^}]*\}\s*$/, "$1");
  r = r.replace(/^:\s+(.+?)\s*\{#tbl-[^}]*\}\s*$/, "*$1*");
  const before = r;
  r = r.replace(/!\[((?:[^\]`]|`[^`]*`)*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\{([^}]*)\}/g, (m, caption, src, attrs, offset) => {
    if ((before.slice(0, offset).match(/`/g) || []).length % 2 === 1) return m;
    return `![${parseAttributes(attrs).values["fig-alt"] || caption}](${src})`;
  });
  return outsideInlineCode(r, (piece) => piece
    .replace(/(\[[^\]]*\]\([^)]*\))\{[^}]*\}/g, "$1")
    .replace(/\[([^\]]+)\]\{([^}]*)\}/g, (m, content, attrs) => {
      const a = parseAttributes(attrs);
      return a.classes.length ? `<span class="${escAttr(a.classes.join(" "))}">${content}</span>` : content;
    })
    .replace(/(^|[^\w@])@((?:fig|tbl|sec|eq|lst|thm|lem|cor|prp|cnj|def|exm|exr)-[\w:.-]*[\w])/g, "$1$2"));
}

/** Shortcodes: video becomes a video-player; the rest are removed. Returns [text, html, text, ...]. */
function shortcodes(line, node, st) {
  const parts = [];
  let last = 0, m;
  const re = new RegExp(SHORTCODE.source, "g");
  while ((m = re.exec(line)) !== null) {
    parts.push(line.slice(last, m.index));
    last = m.index + m[0].length;
    let html = "";
    if (m[1].toLowerCase() === "video") {
      const a = /^(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(m[2]);
      const source = a ? (a[1] ?? a[2] ?? a[3]) : "";
      const title = /\btitle=(?:"([^"]*)"|'([^']*)'|(\S+))/.exec(m[2]);
      if (source !== "") {
        const resolved = isExternal(source) ? source : registerAsset(source, node, st) || absoluteSourceUrl(source, node, st);
        html = `<video-player source="${escAttr(resolved)}"${title ? ` media-title="${escAttr(title[1] ?? title[2] ?? title[3])}"` : ""}></video-player>`;
      }
    }
    parts.push(html);
  }
  parts.push(line.slice(last));
  return parts;
}

/** The page body as a tree of markdown runs, raw HTML and wrappers (callouts, divs), so markdown inside a wrapper still renders. */
function parseBody(body, node, st) {
  const lines = body.split("\n");
  const root = { kind: "root", children: [] };
  const stack = [root];
  let md = [];
  const top = () => stack[stack.length - 1];
  const dropping = () => stack.some((f) => f.kind === "drop");
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
      if (dropping()) continue;
      const block = codeBlock(open[2].trim(), code);
      if (block && block.html !== undefined) { flush(); top().children.push({ html: block.html }); }
      else if (block) md.push(...block.lines);
      continue;
    }
    const fence = /^\s{0,3}(:{3,})\s*(.*?)\s*$/.exec(line);
    if (fence) {
      const attrText = fence[2].replace(/\s*:+\s*$/, "").trim();
      if (attrText === "") {
        if (stack.length > 1) { flush(); stack.pop(); }
        continue;
      }
      flush();
      if (dropping()) { stack.push({ kind: "drop" }); continue; }
      const a = attrText[0] === "{" ? parseAttributes(attrText.replace(/^\{|\}$/g, "")) : { id: "", classes: attrText.split(/\s+/).filter((n) => n !== ""), values: {} };
      const callout = a.classes.map((c) => /^callout-(note|tip|important|warning|caution)$/.exec(c)).find(Boolean);
      let frame;
      if (callout) {
        let title = stringOf(a.values.title);
        if (title === "") {
          let n = i + 1;
          while (n < lines.length && lines[n].trim() === "") n++;
          const h = n < lines.length ? /^#{1,6}\s+(.+?)\s*$/.exec(lines[n]) : null;
          if (h) { title = headingText(h[1]); lines[n] = ""; }
        }
        const c = CALLOUTS[callout[1]];
        frame = { kind: "wrap", open: `<stop-note status="${escAttr(c.status)}" title="${escAttr(title || c.title)}"><div slot="message">`, close: "</div></stop-note>", children: [] };
      } else if (a.classes.includes("content-visible") || a.classes.includes("content-hidden")) {
        const applies = appliesToHtml(a.values);
        const keep = a.classes.includes("content-visible") ? applies : !applies;
        frame = keep ? { kind: "wrap", open: "", close: "", children: [] } : { kind: "drop" };
      } else {
        frame = { kind: "wrap", open: `<div${a.id ? ` id="${escAttr(a.id)}"` : ""}${a.classes.length ? ` class="${escAttr(a.classes.join(" "))}"` : ""}>`, close: "</div>", children: [] };
      }
      if (frame.kind === "wrap") top().children.push(frame);
      stack.push(frame);
      continue;
    }
    if (dropping()) continue;
    const parts = shortcodes(line, node, st);
    for (let k = 0; k < parts.length; k++) {
      if (k % 2 === 1) { if (parts[k] !== "") { flush(); top().children.push({ html: parts[k] }); } continue; }
      if (parts.length === 1 || parts[k].trim() !== "") md.push(transformInline(parts[k]));
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

function resolveAssetPath(ref, node, st) {
  const prefix = rootPrefix(st.src);
  const dir = node.path ? node.path.split("/").slice(0, -1).join("/") : prefix.replace(/\/$/, "");
  const candidate = ref[0] === "/" ? normalizePath(`${prefix}${ref}`) : normalizePath(`${dir}/${ref}`);
  return st.src.paths[candidate] ? candidate : null;
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
  const prefix = rootPrefix(st.src);
  const dir = node.path ? node.path.split("/").slice(0, -1).join("/") : prefix.replace(/\/$/, "");
  return st.src.rawUrl(clean[0] === "/" ? normalizePath(`${prefix}${clean}`) : normalizePath(`${dir}/${clean}`));
}

/** A link to the page that backs it, written against the rendered site (x.html) or the source (x.qmd). */
function resolveDocPath(link, node, st) {
  let target = String(link).split("#")[0].split("?")[0];
  if (target === "") return null;
  target = target.replace(/\.html$/i, "").replace(PAGE, "");
  const dir = node.path ? node.path.split("/").slice(0, -1).join("/") : "";
  const base = target[0] === "/" ? normalizePath(`${rootPrefix(st.src)}${target}`) : normalizePath(`${dir === "" ? rootPrefix(st.src) : dir}/${target}`);
  for (const c of [...PAGE_EXTENSIONS.map((e) => `${base}${e}`), ...PAGE_EXTENSIONS.map((e) => `${base}/index${e}`)]) if (st.src.paths[c]) return c;
  return null;
}

/** Images become media-image, in-project links point at the imported slugs, files join the file list. */
function rewrite(html, node, st) {
  html = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = /\ssrc="([^"]*)"/i.exec(tag);
    if (!src || src[1] === "") return tag;
    const alt = /\salt="([^"]*)"/i.exec(tag);
    const resolved = registerAsset(src[1], node, st) || absoluteSourceUrl(src[1], node, st);
    if (IMAGE.test(resolved) || resolved.startsWith("files/")) return `<media-image source="${escAttr(resolved)}" alt="${escAttr(alt ? alt[1] : "")}"></media-image>`;
    return tag.replace(src[0], () => ` src="${escAttr(resolved)}"`);
  });
  return html.replace(/(<a\b[^>]*?\shref=")([^"]*)(")/gi, (m, pre, href, post) => {
    if (href === "" || href[0] === "#" || isExternal(href)) return m;
    const doc = resolveDocPath(href, node, st);
    if (doc !== null && st.slugByPath[doc]) return `${pre}${st.slugByPath[doc]}${href.includes("#") ? href.slice(href.indexOf("#")) : ""}${post}`;
    return `${pre}${escAttr(registerAsset(href, node, st) || absoluteSourceUrl(href, node, st))}${post}`;
  });
}

/** Front matter and configuration are read by import-frontmatter.data; this is its result, or an error. */
async function frontMatterCall(ctx, op, input) {
  const r = await ctx.contracts.call("import-frontmatter.data", op, input);
  if (!r || (op === "split" ? !Array.isArray(r.results) : r.data === undefined && r.error === undefined)) throw new Error(`front matter could not be read: ${(r && r.error) || "no result"}`);
  return r;
}

async function renderPage(ctx, fm, node, st) {
  let body = fm.body;
  let title = stringOf(isObject(fm.data) ? fm.data.title : "");
  if (title === "") {
    // a chapter with no title in its front matter is titled by its first level-one heading
    const lines = body.split("\n");
    let i = 0;
    while (i < lines.length && lines[i].trim() === "") i++;
    const h = i < lines.length ? /^#\s+(.+?)\s*$/.exec(lines[i]) : null;
    if (h && headingText(h[1]) !== "") { title = headingText(h[1]); lines.splice(i, 1); body = lines.join("\n"); }
  }
  // an outline label is the title the navigation shows, so it wins
  if (title !== "" && !node.explicit) node.item.title = title;
  const html = strip(rewrite(await renderTree(ctx, parseBody(body, node, st)), node, st)).trim();
  return html === "" ? "<p></p>" : html;
}

const fallback = (source) => (source ? `<p>Read this page on <a href="${escAttr(source)}">the source site</a>.</p>` : "<p></p>");

async function importProject(ctx, src) {
  const configPath = Object.keys(src.paths).filter((p) => CONFIG.test(p)).sort((a, b) => a.split("/").length - b.split("/").length || byText(a, b))[0];
  if (!configPath) return { error: `no _quarto.yml found in ${src.repo || src.name}` };
  const configText = await src.read(configPath);
  if (configText === null) return { error: `unable to read ${configPath}` };
  src.root = configPath.includes("/") ? configPath.slice(0, configPath.lastIndexOf("/")) : "";
  const config = await frontMatterCall(ctx, "parse", { format: "yaml", text: configText });
  src.config = readConfig(isObject(config.data) ? config.data : {});
  const outline = buildOutline(src);
  if (!outline.length) return { error: "the Quarto project has no pages to import" };
  const st = { src, files: [], fileNames: {}, filesByPath: {}, slugByPath: {} };
  const items = [];
  const used = new Set();
  for (const node of outline) {
    const parent = node.parentIndex === null ? null : items[node.parentIndex];
    let slug = parent ? `${parent.slug}/${titleSlug(node.title)}` : titleSlug(node.title);
    for (let n = 2, s = slug; used.has(slug); n++) slug = `${s}-${n}`;
    used.add(slug);
    const metadata = { sourceType: "quarto", quarto: { repo: src.repo, branch: src.branch, path: node.path } };
    if (node.relative && src.config.siteUrl) metadata.source = `${src.config.siteUrl.replace(/\/$/, "")}/${node.relative.replace(PAGE, ".html")}`;
    const item = { id: `item-${items.length + 1}`, title: node.title, slug, parent: parent ? parent.id : null, order: node.order, indent: node.depth, content: "<p></p>", metadata };
    items.push(item);
    node.item = item;
    if (node.path) st.slugByPath[node.path] = slug;
  }
  // the first MAX_PAGES pages are read in one call, in outline order; the rest link to the source site
  const wanted = [];
  for (const node of outline) if (node.path && wanted.length < MAX_PAGES) { node.wanted = true; wanted.push(node.path); }
  const texts = await src.readMany(wanted);
  // and their front matter is split in one call
  const readable = outline.filter((node) => node.wanted && typeof texts[node.path] === "string");
  const split = readable.length ? (await frontMatterCall(ctx, "split", { texts: readable.map((node) => texts[node.path]) })).results : [];
  readable.forEach((node, i) => { node.fm = split[i] && typeof split[i].body === "string" ? split[i] : { data: {}, body: "" }; });
  for (const node of outline) {
    if (!node.path) continue;
    node.item.content = node.fm ? await renderPage(ctx, node.fm, node, st) : fallback(node.item.metadata.source);
  }
  return { title: src.config.title || src.name, items, files: st.files };
}

export default {
  contracts: {
    "import.platform": {
      /**
       * Implements contract import.platform, operation convert (dispatch: chosen).
       *
       * Reads a Quarto book or website from a GitHub repository (or an uploaded zip of one): the outline from
       * _quarto.yml (book chapters and parts, sidebar, navbar, else the file tree), then each page with its front
       * matter title, code chunks, callouts (as stop-note) and fenced divs. Markdown is converted by import.file, and
       * repository images and files the pages use are listed for core to fetch.
       *
       * @param {object} ctx    Platform context (spec/13); the repository or zip is read through import-source.tree, so nothing is fetched here.
       * @param {object} input  { url } of the repository (https://github.com/<owner>/<repo>, optionally /tree/<branch>), or { files: [{ name, data (base64) }] } with one .zip.
       * @returns {Promise<object>}  { title, items, files } or { error }.
       */
      async convert(ctx, input) {
        input = input || {};
        try {
          if (Array.isArray(input.files) && input.files.length) {
            const f = input.files[0] || {};
            if (!/\.zip$/i.test(String(f.name || ""))) return { error: "expected a .zip of the Quarto project" };
          } else if (!input.url) return { error: "url or files is required" };
          const src = await openSource(ctx, input);
          if (src.error) return src;
          return await importProject(ctx, src);
        } catch (e) {
          return { error: e.message };
        }
      },
    },
  },
};
