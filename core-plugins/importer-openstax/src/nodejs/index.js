// OpenStax importer (Node). Mirrored in src/php/Plugin.php; both return identical results.
// Port of core's convertOpenstaxToSite.js. The book is read through OpenStax's public archive API (the web reader is a
// client-rendered app whose table of contents is not in the served HTML):
//   /rex/release.json                          archive path and the version of each published book
//   /apps/cms/api/v2/pages/?slug=<slug>        book slug to content id
//   <archive>/contents/<id>@<ver>.json         title, license, page tree
//   <archive>/contents/<id>@<ver>:<page>.json  one page of XHTML
// Core's DOM work (node-html-parser) is done here with regular expressions, the same in both runtimes.
const MAX_PAGES = 500;
const MAX_IMAGES = 1000;
// archive images are extension-less hashes, so the type the archive serves names the file
const EXTENSION_BY_CONTENT_TYPE = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
const SITE_LICENSES = ["by", "by-sa", "by-nd", "by-nc", "by-nc-sa", "by-nc-nd"];
// attributes worth keeping, by tag; os-* classes, fs-id ids, data-type hooks and inline styles are dropped
const KEEP_ATTRIBUTES = {
  a: ["href"],
  img: ["src", "alt", "width", "height"],
  td: ["colspan", "rowspan", "headers"],
  th: ["colspan", "rowspan", "scope"],
  ol: ["start", "type"],
  math: ["display"],
  "media-image": ["source", "alt"],
};
const ATTR = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
const SPACE = /[\t\n\v\f\r \u00a0]+/g;

/** HAXCMS.cleanTitle from core. */
function cleanTitle(value) {
  let t = String(value).trim().replace("pages/", "").replace("/index.html", "");
  t = t.replace(/ /g, "-").toLowerCase().replace(/[^\w\-/]+/g, "-").replace(/--+/g, "-");
  return t === "" ? "blank" : t;
}

/** Section titles often end in punctuation ("What Is Finance?"), so trim the dashes cleanTitle leaves at the edges. */
function titleSlug(title) {
  const cleaned = cleanTitle(title);
  const trimmed = cleaned.replace(/^-+|-+$/g, "");
  return trimmed === "" ? cleaned : trimmed;
}

function decode(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function escapeAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/** Strip markup and collapse whitespace; tags become spaces first so adjacent title spans ("1.1", "Finance") do not run together. */
function plainText(value) {
  return decode(String(value ?? "").replace(/<[^>]+>/g, " ")).replace(SPACE, " ").trim();
}

/** Attributes of one start tag, in order: [[name, value|null]]. */
function attrs(tag) {
  const inner = tag.replace(/^<[^\s>/]+/, "").replace(/\/?>$/, "");
  return [...inner.matchAll(ATTR)].map((m) => [m[1], m[2] ?? m[3] ?? m[4] ?? null]);
}
const attr = (tag, name) => { const a = attrs(tag).find(([n]) => n.toLowerCase() === name); return a ? a[1] ?? "" : null; };
function buildTag(name, list, selfClosing) {
  const out = list.map(([n, v]) => (v === null ? ` ${n}` : ` ${n}="${String(v).replace(/"/g, "&quot;")}"`)).join("");
  return `<${name}${out}${selfClosing ? " /" : ""}>`;
}

/** Resolve a relative link against an absolute base URL (enough of the URL standard for archive links). */
function resolveUrl(base, rel) {
  const m = /^([a-z][a-z0-9+.-]*:)\/\/([^/?#]*)([^?#]*)/i.exec(base);
  if (rel.startsWith("//")) return `${m[1]}${rel}`;
  const origin = `${m[1]}//${m[2]}`;
  let path;
  if (rel.startsWith("/")) path = rel;
  else if (rel.startsWith("?")) path = `${m[3]}${rel}`;
  else path = `${m[3].replace(/[^/]*$/, "")}${rel}`;
  const q = /^([^?#]*)(.*)$/.exec(path);
  const segs = q[1].split("/");
  const out = [];
  segs.forEach((s, i) => {
    const last = i === segs.length - 1;
    if (s === "..") { if (out.length > 1) out.pop(); if (last) out.push(""); }
    else if (s === ".") { if (last) out.push(""); }
    else out.push(s);
  });
  return `${origin}${out.join("/")}${q[2]}`;
}

/** Map an OpenStax license record onto a site.license code, defaulting to by. */
function licenseCode(license) {
  const value = `${license.url || ""} ${license.name || ""}`.toLowerCase();
  for (const code of SITE_LICENSES) if (value.includes(`/licenses/${code}/`)) return code;
  const compact = value.replace(/[^a-z]/g, "");
  const nc = compact.includes("noncommercial"), nd = compact.includes("noderivatives"), sa = compact.includes("sharealike");
  if (nc && nd) return "by-nc-nd";
  if (nc && sa) return "by-nc-sa";
  if (nc) return "by-nc";
  if (nd) return "by-nd";
  if (sa) return "by-sa";
  return "by";
}

/** The book slug from a details or reader URL; throws with the message to return. */
export function bookSlugFromUrl(url) {
  const m = /^https?:\/\/([^/?#:]+)(?::\d+)?([^?#]*)/i.exec(String(url).trim());
  if (!m) throw new Error(`url is not a valid URL: ${url}`);
  const host = m[1].toLowerCase();
  if (host !== "openstax.org" && host !== "www.openstax.org") throw new Error(`url must be an openstax.org URL, got: ${m[1]}`);
  const segs = m[2].split("/").filter((s) => s !== "");
  const i = segs.indexOf("books");
  if (i === -1 || !segs[i + 1]) throw new Error("unable to read a book slug from url; expected /details/books/<slug> or /books/<slug>/pages/<page>");
  return { origin: `https://${host}`, slug: segs[i + 1] };
}

async function fetchJson(ctx, url, what) {
  let r;
  try { r = await ctx.fetch(url); } catch (e) { throw new Error(`unable to reach OpenStax for ${what}: ${e.message}`); }
  if (!r.ok) throw new Error(`OpenStax returned ${r.status} for ${what}`);
  try { return JSON.parse(await r.text()); } catch { throw new Error(`OpenStax returned unreadable data for ${what}`); }
}

/** Resolve a book slug to its content id, version, archive URL, title, license and page tree. */
async function resolveBook(ctx, origin, slug) {
  const release = await fetchJson(ctx, `${origin}/rex/release.json`, "the OpenStax release manifest");
  const archivePath = release && release.archiveUrl ? String(release.archiveUrl) : "";
  if (archivePath === "") throw new Error("the OpenStax release manifest did not name an archive");
  const lookup = await fetchJson(ctx, `${origin}/apps/cms/api/v2/pages/?type=books.Book&fields=title,cnx_id&slug=${encodeURIComponent(slug)}`, `the book "${slug}"`);
  const entries = lookup && Array.isArray(lookup.items) ? lookup.items : [];
  if (!entries.length || !entries[0].cnx_id) throw new Error(`OpenStax has no book with the slug "${slug}"`);
  const contentId = String(entries[0].cnx_id);
  const bookRelease = ((release && release.books) || {})[contentId];
  if (!bookRelease || !bookRelease.defaultVersion) throw new Error(`OpenStax is not currently publishing "${slug}"`);
  const archiveUrl = `${origin}${archivePath}`;
  const version = String(bookRelease.defaultVersion);
  const contents = await fetchJson(ctx, `${archiveUrl}/contents/${contentId}@${version}.json`, `the contents of "${slug}"`);
  if (!contents || !contents.tree || !Array.isArray(contents.tree.contents)) throw new Error(`OpenStax returned no table of contents for "${slug}"`);
  const license = contents.license && typeof contents.license === "object" && !Array.isArray(contents.license) ? contents.license : {};
  return { slug, contentId, version, archiveUrl, origin, title: plainText(contents.title || slug), license, tree: contents.tree };
}

/** The tree as a flat, ordered list; units and chapters keep their children so parent and indent follow the book. */
function flattenTree(tree) {
  const nodes = [];
  const walk = (branch, depth, parentIndex) => {
    let order = 0;
    for (const child of Array.isArray(branch.contents) ? branch.contents : []) {
      const title = plainText(child.title);
      if (title === "") continue;
      const hasChildren = Array.isArray(child.contents) && child.contents.length > 0;
      const index = nodes.length;
      // leaf nodes are pages; "<uuid>@<version>" needs the version trimmed
      nodes.push({ title, depth, order, parentIndex, pageId: hasChildren ? null : String(child.id || "").split("@")[0].toLowerCase(), sourceSlug: child.slug ? String(child.slug) : "" });
      order++;
      if (hasChildren) walk(child, depth + 1, index);
    }
  };
  walk(tree, 0, null);
  return nodes;
}

/** An archive-relative image src ("../resources/<name>") as "resources/<name>", or "". */
function resourcePath(src) {
  const v = String(src).trim();
  if (v === "" || /^(https?:)?\/\//i.test(v) || v.startsWith("data:")) return "";
  const m = /resources\/([A-Za-z0-9._-]+)$/.exec(v);
  return m ? `resources/${m[1]}` : "";
}

/** Ask the archive for an image's type (HEAD, nothing downloaded) and list it for core to fetch; null keeps the source URL. */
async function listImage(ctx, run, url, resource) {
  if (run.files.length >= MAX_IMAGES) return null;
  let r;
  try { r = await ctx.fetch(url, { method: "HEAD" }); } catch { return null; }
  if (!r.ok) return null;
  const type = String((r.headers && r.headers.get("content-type")) || "").split(";")[0].trim().toLowerCase();
  const ext = EXTENSION_BY_CONTENT_TYPE[type];
  if (!ext) return null;
  const path = `files/${resource.split("/").pop()}.${ext}`;
  run.files.push({ path, url });
  return path;
}

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

/** Turn one page of OpenStax XHTML into clean semantic HTML, with images as media-image and in-book links at the new pages. */
async function cleanPage(ctx, content, run) {
  if (typeof content !== "string" || content.trim() === "") return "<p></p>";
  const body = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(content);
  let html = body ? body[1] : content.replace(/<\?xml[^>]*\?>/gi, "").replace(/<!DOCTYPE[^>]*>/gi, "");
  html = cleanHtml(html, ["style", "script", "noscript", "head"], ["link", "meta"], false);
  // the archive wraps the page in <div data-type="page">; unwrap it
  const wrap = /^\s*<div\b([^>]*)>([\s\S]*)<\/div>\s*$/i.exec(html);
  if (wrap && /\bdata-type\s*=\s*["']page["']/i.test(wrap[1])) html = wrap[2];
  // the page title becomes the item title, so it does not repeat in the body
  html = html.replace(/<([a-z][a-z0-9]*)\b[^>]*\bdata-type\s*=\s*["']document-title["'][^>]*>[\s\S]*?<\/\1\s*>/i, "");

  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const resource = resourcePath(attr(m[0], "src") ?? "");
    if (resource && !Object.prototype.hasOwnProperty.call(run.images, resource)) run.images[resource] = await listImage(ctx, run, `${run.book.archiveUrl}/${resource}`, resource);
  }
  html = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const resource = resourcePath(attr(tag, "src") ?? "");
    if (!resource) return tag;
    const listed = run.images[resource];
    if (listed) return `<media-image source="${listed}" alt="${escapeAttr(decode(attr(tag, "alt") ?? ""))}"></media-image>`;
    return buildTag("img", attrs(tag).map(([n, v]) => (n.toLowerCase() === "src" ? [n, `${run.book.archiveUrl}/${resource}`] : [n, v])), /\/>$/.test(tag));
  });

  // in-book links point at the imported pages; other relative links become absolute
  html = html.replace(/<a\b[^>]*>/gi, (tag) => {
    const href = attr(tag, "href");
    if (href === null) return tag;
    const v = href.trim();
    if (v === "" || v.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(v)) return tag;
    const target = /\/contents\/([0-9a-f-]{36})/i.exec(v);
    const slug = target ? run.slugByPageId[target[1].toLowerCase()] : null;
    const next = slug ? `${slug}${v.includes("#") ? v.slice(v.indexOf("#")) : ""}` : resolveUrl(`${run.book.archiveUrl}/`, v);
    return buildTag("a", attrs(tag).map(([n, val]) => (n.toLowerCase() === "href" ? [n, next] : [n, val])), false);
  });

  // drop the styling layer but keep meaningful attributes; MathML is left as it is
  html = html.split(/(<math\b[\s\S]*?<\/math\s*>)/i).map((part, i) => (i % 2 ? part : part.replace(/<([a-zA-Z][a-zA-Z0-9-]*)(\s[^<>]*?)?(\/?)>/g, (tag, name, rest, slash) => {
    const keep = KEEP_ATTRIBUTES[name.toLowerCase()] || [];
    return buildTag(name, attrs(tag).filter(([n]) => keep.includes(n.toLowerCase())), slash === "/");
  }))).join("");
  html = cleanHtml(html, [], [], false);
  // collapse only the archive's pretty-printing between tags, never the inside of pre blocks
  html = html.replace(/>\s*\n\s*</g, "><").trim();
  return html === "" ? "<p></p>" : html;
}

function sourceFallback(source) {
  return source ? `<p>Read this page on <a href="${source}">OpenStax</a>.</p>` : "<p></p>";
}

export default {
  contracts: {
    "import.platform": {
      /**
       * Implements contract import.platform, operation convert (dispatch: chosen).
       *
       * Reads an OpenStax book through the public archive API and returns its units, chapters and pages as a tree,
       * with clean HTML, in-book links pointing at the new pages, and each image listed in files for core to fetch.
       * Pages past the 500-page cap link to their source instead of carrying a body.
       *
       * @param {object} ctx    Platform context (spec/13); ctx.fetch reaches only input.url's host (openstax.org).
       * @param {object} input  { url } of the book: https://openstax.org/details/books/<slug> or a reader page.
       * @returns {Promise<object>}  { title, items, files } or { error }.
       */
      async convert(ctx, input) {
        if (!input || !input.url) return { error: "url is required" };
        try {
          const { origin, slug } = bookSlugFromUrl(input.url);
          const book = await resolveBook(ctx, origin, slug);
          const nodes = flattenTree(book.tree);
          if (!nodes.length) return { error: `OpenStax returned an empty table of contents for "${slug}"` };
          const accessed = new Date(ctx.now()).toISOString();
          const run = { book, slugByPageId: {}, images: {}, files: [] };
          const items = [];
          // first pass: items and slugs, so page bodies can link to their siblings
          nodes.forEach((node, i) => {
            const parent = node.parentIndex === null ? null : items[node.parentIndex];
            const item = {
              id: `item-${i + 1}`,
              title: node.title,
              slug: parent ? `${parent.slug}/${titleSlug(node.title)}` : titleSlug(node.title),
              parent: parent ? parent.id : null,
              order: node.order,
              indent: node.depth,
              content: "<p></p>",
              metadata: { sourceType: "openstax", openstax: { bookSlug: book.slug, bookTitle: book.title, pageSlug: node.sourceSlug, license: book.license, licenseCode: licenseCode(book.license), publisher: "OpenStax / Rice University", accessed } },
            };
            if (node.pageId) {
              item.metadata.source = `${origin}/books/${book.slug}/pages/${node.sourceSlug}`;
              run.slugByPageId[node.pageId] = item.slug;
            }
            items.push(item);
          });
          // second pass: page bodies, up to the page cap
          let fetched = 0;
          for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const item = items[i];
            if (!node.pageId) continue;
            if (fetched >= MAX_PAGES) { item.content = sourceFallback(item.metadata.source); continue; }
            const page = await fetchJson(ctx, `${book.archiveUrl}/contents/${book.contentId}@${book.version}:${node.pageId}.json`, `the page "${node.title}"`);
            fetched++;
            item.content = await cleanPage(ctx, page && typeof page.content === "string" ? page.content : "", run);
            if (page && page.abstract) item.description = plainText(page.abstract).slice(0, 280);
          }
          return { title: book.title, items, files: run.files };
        } catch (e) {
          return { error: e.message };
        }
      },
    },
  },
};
