// Drupal importer (Node). Mirrored in src/php/Plugin.php; identical output.
// Reads a Drupal 8+ site through JSON:API: node--page and node--book records become pages, file--file records are listed
// in `files` for core to fetch, media (<drupal-media> embeds and field_media references) become HAX media elements, and
// the outline follows the site's menu_link_content records, then book fields, then a flat list by creation date.
// Pages no menu reaches go under a hidden "additional pages" group, as core does today.
// Maps keep insertion order in both runtimes (a plain JS object would reorder numeric keys such as node ids).

const MAX_FILES = 2000;
// core's build.files pipeline only accepts these extensions, so nothing else is listed
const SAFE_EXT = /\.(jpg|jpeg|png|gif|webm|webp|mp4|mp3|mov|csv|ppt|pptx|xlsx|doc|xls|docx|pdf|rtf|txt|vtt|html|md|xml|ics|vcf|h5p)$/i;
// /sites/default/files/2024-06/x.jpg -> 2024-06/x.jpg (lands at files/2024-06/x.jpg)
const FILES_PATH = /^\/(?:sites\/[^/]+\/)?files\/(.+)$/i;
const MEDIA_KINDS = { image: "image", document: "document", video: "video", audio: "audio", remote_video: "remote-video" };
const MEDIA_FILE_FIELDS = { image: ["field_media_image", "thumbnail"], document: ["field_media_document"], video: ["field_media_video"], audio: ["field_media_audio"] };
const ACCEPT = { headers: { Accept: "application/vnd.api+json,application/json" } };
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const str = (x) => (typeof x === "string" ? x : "");

/** Removes script and style blocks and inline event handlers; core sanitizes again on save. */
export const strip = (html) => String(html).replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "").replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Core's HAXCMS.cleanTitle(value, false). */
export function cleanTitle(value) {
  const s = String(value).trim().replace(/ /g, "-").toLowerCase().replace(/[^\w\-/]+/g, "-").replace(/--+/g, "-");
  return s === "" ? "blank" : s;
}

/** Leading integer of a number or string (parseInt without hex or float surprises), else the fallback. */
export function num(v, fallback = 0) {
  if (typeof v === "number") return Number.isFinite(v) ? Math.trunc(v) : fallback;
  if (typeof v === "string") { const m = /^\s*([-+]?\d+)/.exec(v); return m ? Number(m[1]) : fallback; }
  return fallback;
}
// JavaScript truthiness, spelled out so PHP can match it ("0" is truthy here)
const truthy = (v) => v !== undefined && v !== null && v !== false && v !== 0 && v !== "" && !Number.isNaN(v);
const firstTruthy = (...vals) => { for (const v of vals) if (truthy(v)) return v; return null; };

async function json(ctx, url) {
  try { const r = await ctx.fetch(url, ACCEPT); return r.ok ? await r.json() : null; } catch { return null; }
}

function withLimit(url, n) {
  if (url.indexOf("page[limit]=") !== -1 || url.indexOf("page%5Blimit%5D=") !== -1) return url;
  return `${url}${url.indexOf("?") === -1 ? "?" : "&"}page[limit]=${n}`;
}

/** Every record of a JSON:API collection, following links.next (only on the named host; egress refuses others). */
async function collection(ctx, href, limit, maxPages) {
  const out = [];
  let url = href ? withLimit(href, limit) : null;
  for (let page = 0; url && page < maxPages; page++) {
    const payload = await json(ctx, url);
    if (!isObj(payload) || !Array.isArray(payload.data)) break;
    out.push(...payload.data);
    const next = isObj(payload.links) && isObj(payload.links.next) ? payload.links.next.href : null;
    url = typeof next === "string" && next !== "" ? next : null;
  }
  return out;
}

/** The JSON:API base: the given path, then each parent path, then the origin, whichever answers /jsonapi with links. */
async function discover(ctx, url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const origin = `${u.protocol}//${u.host}`;
  const parts = u.pathname.split("/").filter(Boolean);
  for (let i = parts.length; i >= 0; i--) {
    const base = i > 0 ? `${origin}/${parts.slice(0, i).join("/")}` : origin;
    const payload = await json(ctx, `${base}/jsonapi`);
    if (isObj(payload) && isObj(payload.links)) return { base, links: payload.links };
  }
  return null;
}

const nid = (r) => (isObj(r) && isObj(r.attributes) ? num(r.attributes.drupal_internal__nid, 0) : 0);
function nodeTitle(r) {
  const t = isObj(r) && isObj(r.attributes) && truthy(r.attributes.title) ? String(r.attributes.title).trim() : "";
  if (t !== "") return t;
  return nid(r) > 0 ? `Node ${nid(r)}` : "Node";
}
function nodeSegment(r) {
  const alias = isObj(r.attributes) && isObj(r.attributes.path) ? str(r.attributes.path.alias) : "";
  const parts = alias.split("/").filter(Boolean);
  if (parts.length) return cleanTitle(parts[parts.length - 1]);
  return cleanTitle(nodeTitle(r));
}
function uniqueSegment(segment, siblings, n) {
  if (!siblings[segment]) { siblings[segment] = true; return segment; }
  let c = `${segment}-${n}`;
  if (!siblings[c]) { siblings[c] = true; return c; }
  let i = 2;
  while (siblings[`${c}-${i}`]) i++;
  c = `${c}-${i}`;
  siblings[c] = true;
  return c;
}
function nodeMetadata(r, base, inOutline) {
  const n = nid(r);
  return { sourceType: "drupal-node", source: n > 0 ? `${base}/node/${n}` : null, published: !(isObj(r.attributes) && r.attributes.status === false), drupal: { nid: n, uuid: str(r.id) || null, type: str(r.type) || null, inOutline } };
}
function siteName(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length) {
      let last = decodeURIComponent(parts[parts.length - 1]);
      if (/^jsonapi$/i.test(last)) last = parts.length > 1 ? decodeURIComponent(parts[parts.length - 2]) : "";
      if (last !== "") { const c = cleanTitle(last); if (c !== "blank") return c; }
    }
    const h = cleanTitle(u.host);
    if (h !== "blank") return h;
  } catch { /* fall through */ }
  return "drupal-import";
}

// ---- files and media ----

const stripExtras = (v) => String(v).trim().split("#")[0].split("?")[0];
function pathOf(value) {
  const v = stripExtras(value);
  if (v === "" || v.indexOf("//") === 0) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) { try { return new URL(v).pathname; } catch { return null; } }
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) || v.charAt(0) !== "/") return null;
  return v;
}

function fileMap(records, base) {
  const files = [];
  const byKey = Object.create(null);
  const byUuid = Object.create(null);
  const byPath = Object.create(null);
  const origin = new URL(base).origin;
  for (const r of records) {
    if (!isObj(r) || !isObj(r.attributes) || r.attributes.status !== true) continue;
    const url = isObj(r.attributes.uri) ? str(r.attributes.uri.url) : "";
    const pathname = url !== "" ? pathOf(url) : null;
    if (pathname === null) continue;
    const m = FILES_PATH.exec(pathname);
    const key = m ? m[1] : pathname.replace(/^\//, "");
    if (key === "" || key.indexOf("..") !== -1 || key.indexOf("\0") !== -1 || !SAFE_EXT.test(key) || byKey[key] || files.length >= MAX_FILES) continue;
    const abs = /^https?:\/\//i.test(url) ? url : `${origin}${url.charAt(0) === "/" ? "" : "/"}${url}`;
    byKey[key] = true;
    files.push({ path: `files/${key}`, url: abs });
    byPath[pathname] = `files/${key}`;
    if (str(r.id) !== "") byUuid[r.id] = { key, ref: `files/${key}`, filename: str(r.attributes.filename) };
  }
  return { files, byUuid, byPath };
}

function firstRel(rel) {
  if (!isObj(rel)) return null;
  if (isObj(rel.data) && truthy(rel.data.id)) return rel.data;
  if (Array.isArray(rel.data) && isObj(rel.data[0]) && truthy(rel.data[0].id)) return rel.data[0];
  return null;
}

function mediaElement(kind, ref, alt, title) {
  if (kind === "image") return `<media-image source="${esc(ref)}" alt="${esc(alt)}"></media-image>`;
  if (kind === "video") return `<video-player source="${esc(ref)}" media-title="${esc(title)}"></video-player>`;
  if (kind === "audio") return `<media-playlist><audio-player source="${esc(ref)}" media-title="${esc(title)}"></audio-player></media-playlist>`;
  return `<a href="${esc(ref)}">${esc(title)}</a>`;
}

/** media--<bundle> record -> HAX element (media-image, video-player, audio-player, or a link), or null. */
function mediaFor(r, map) {
  const type = str(r.type);
  const bundle = type.indexOf("--") !== -1 ? type.split("--").pop() : "";
  const kind = has(MEDIA_KINDS, bundle) ? MEDIA_KINDS[bundle] : "file";
  const attrs = isObj(r.attributes) ? r.attributes : {};
  const rels = isObj(r.relationships) ? r.relationships : {};
  const name = str(attrs.name);
  if (kind === "remote-video") {
    const o = attrs.field_media_oembed_video;
    const url = typeof o === "string" ? o : isObj(o) ? str(o.value) : "";
    return url !== "" && /^https?:\/\//i.test(url) ? mediaElement("video", url, "", name || url) : null;
  }
  let data = null;
  for (const f of has(MEDIA_FILE_FIELDS, kind) ? MEDIA_FILE_FIELDS[kind] : []) { const d = firstRel(rels[f]); if (d && d.type === "file--file") { data = d; break; } }
  if (!data) for (const k of Object.keys(rels)) { const d = firstRel(rels[k]); if (d && d.type === "file--file") { data = d; break; } }
  const file = data ? byId(map.byUuid, data.id) : null;
  if (!file) return null;
  const meta = isObj(data.meta) ? data.meta : {};
  const title = str(meta.title) || name || file.filename || file.key;
  return mediaElement(kind, file.ref, str(meta.alt), title);
}
const byId = (o, k) => (typeof k === "string" && o[k] !== undefined ? o[k] : null);

// ---- page content ----

function fileRef(value, map) {
  const v = stripExtras(value);
  if (v === "" || v.indexOf("//") === 0) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) { try { return byId(map.byPath, new URL(v).pathname); } catch { return null; } }
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null;
  const p = v.replace(/^\/+/, "");
  return p === "" ? null : byId(map.byPath, `/${p}`);
}

/** Points src, href, poster, source and srcset values at known Drupal files to their files/... path. */
function rewriteFiles(html, map) {
  return html.replace(/(\s)(src|href|poster|source|srcset)(\s*=\s*)(?:"([^"]*)"|'([^']*)')/gi, (m, sp, attr, eq, dq, sq) => {
    const q = dq !== undefined ? '"' : "'";
    const value = dq !== undefined ? dq : sq;
    let out = value;
    if (attr.toLowerCase() === "srcset") {
      out = value.split(",").map((part) => part.trim()).filter((part) => part !== "").map((part) => { const pieces = part.split(/\s+/); const ref = fileRef(pieces[0], map); if (ref) pieces[0] = ref; return pieces.join(" "); }).join(", ");
    } else {
      const ref = fileRef(value, map);
      if (ref) out = ref;
    }
    return `${sp}${attr}${eq}${q}${out}${q}`;
  });
}

function pageContent(r, base, media, map) {
  const attrs = isObj(r.attributes) ? r.attributes : {};
  const raw = isObj(attrs.body) && typeof attrs.body.value === "string" ? attrs.body.value : str(attrs.body);
  let content = "";
  if (raw !== "") {
    content = strip(raw).replace(/<drupal-media\b([^>]*)>([\s\S]*?)<\/drupal-media\s*>|<drupal-media\b([^>]*)\/>/gi, (m, paired, inner, self) => {
      const a = paired !== undefined ? paired : self || "";
      const u = /data-entity-uuid\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(a);
      const id = u ? (u[1] !== undefined ? u[1] : u[2]) : "";
      return (id !== "" && byId(media, id)) || "";
    });
    content = rewriteFiles(content, map);
  }
  if (content === "") {
    const d = firstRel(isObj(r.relationships) ? r.relationships.field_media : null);
    content = (d && byId(media, d.id)) || "";
  }
  if (content === "") return "<p></p>";
  const origin = new URL(base).origin;
  return content.replace(/href="\//g, `href="${origin}/`).replace(/src="\//g, `src="${origin}/`).replace(/poster="\//g, `poster="${origin}/`).replace(/srcset="\//g, `srcset="${origin}/`);
}

// ---- outline ----

function menuNid(uri) {
  if (typeof uri !== "string") return 0;
  const u = uri.trim();
  const m = /^entity:node\/(\d+)$/i.exec(u) || /^internal:\/node\/(\d+)$/i.exec(u) || /\/node\/(\d+)/i.exec(u);
  return m ? num(m[1], 0) : 0;
}
function parentLinkId(r) {
  const attrs = isObj(r.attributes) ? r.attributes : {};
  const rels = isObj(r.relationships) ? r.relationships : {};
  if (typeof attrs.parent === "string" && attrs.parent.trim() !== "") { const p = attrs.parent.trim(); return p.indexOf(":") !== -1 ? p.split(":").pop() : p; }
  if (isObj(rels.parent) && isObj(rels.parent.data) && truthy(rels.parent.data.id)) return String(rels.parent.data.id);
  return "";
}
function addRelation(rel, n, parentNid, weight) {
  if (!rel.has(n)) rel.set(n, { parentNid, weight });
  else if (weight < rel.get(n).weight) rel.get(n).weight = weight;
}
function childrenOf(rel) {
  const buckets = new Map();
  for (const [n, r] of rel) { if (!buckets.has(r.parentNid)) buckets.set(r.parentNid, []); buckets.get(r.parentNid).push({ nid: n, weight: r.weight }); }
  const out = new Map();
  for (const [p, list] of buckets) out.set(p, list.sort((a, b) => a.weight - b.weight || a.nid - b.nid).map((e) => e.nid));
  return out;
}
// walk up parent links until one reaches a page; links to views or external pages are skipped
function ancestorNid(parentId, byPluginId, pages) {
  let cur = parentId;
  for (let hops = 0; cur && hops < 20; hops++) {
    const item = byPluginId.get(cur);
    if (!item) return 0;
    if (item.nid > 0 && pages.has(item.nid)) return item.nid;
    cur = item.parentId;
  }
  return 0;
}

/** menu_link_content -> tree: the main menu (or the one linking the most pages), other menus' pages appended. */
function forestFromMenuLinks(records, pages) {
  const groups = new Map();
  for (const r of records) {
    if (!isObj(r) || !isObj(r.attributes)) continue;
    const a = r.attributes;
    const menu = typeof a.menu_name === "string" && a.menu_name.trim() !== "" ? a.menu_name.trim() : "__default__";
    if (!groups.has(menu)) groups.set(menu, []);
    groups.get(menu).push({ id: str(r.id), nid: isObj(a.link) ? menuNid(a.link.uri) : 0, weight: num(a.weight, 0), parentId: parentLinkId(r) });
  }
  const linked = (e) => e.nid > 0 && pages.has(e.nid);
  let selected = null;
  if (groups.has("main") && groups.get("main").some(linked)) selected = "main";
  else { let best = 0; for (const [name, list] of groups) { const c = list.filter(linked).length; if (c > best) { best = c; selected = name; } } }
  if (selected === null) return null;
  const byPluginId = new Map();
  for (const e of groups.get(selected)) if (e.id !== "") byPluginId.set(e.id, e);
  const rel = new Map();
  for (const e of groups.get(selected)) if (linked(e)) addRelation(rel, e.nid, ancestorNid(e.parentId, byPluginId, pages), e.weight);
  if (!rel.size) return null;
  const children = childrenOf(rel);
  const others = [];
  const seen = new Set();
  for (const [name, list] of groups) {
    if (name === selected) continue;
    for (const e of list) if (linked(e) && !rel.has(e.nid) && !seen.has(e.nid)) { seen.add(e.nid); others.push(e); }
  }
  if (others.length) children.set(0, (children.get(0) || []).concat(others.sort((a, b) => a.weight - b.weight || a.nid - b.nid).map((e) => e.nid)));
  return children;
}

/** node--book book fields -> tree (book sites without menu links). */
function forestFromBooks(records, pages) {
  const rel = new Map();
  for (const r of records) {
    if (!isObj(r) || !isObj(r.attributes)) continue;
    const a = r.attributes;
    const n = nid(r);
    if (!n || !pages.has(n)) continue;
    if (isObj(a.book)) {
      const p = num(firstTruthy(a.book.pid, a.book.parent, a.book.parent_nid), 0);
      addRelation(rel, n, pages.has(p) ? p : 0, num(firstTruthy(a.book.weight, a.book.menu_order), 0));
      continue;
    }
    const p = num(firstTruthy(a.book_parent, a.book_parent_id, a.book_parent_nid, a.field_book_parent, a.field_book_parent_nid), 0);
    if (p || a.book_parent === 0 || a.book_parent_id === 0) addRelation(rel, n, pages.has(p) ? p : 0, num(firstTruthy(a.book_weight, a.book_order), 0));
  }
  return rel.size ? childrenOf(rel) : null;
}

const created = (r) => (isObj(r.attributes) ? str(r.attributes.created) : "");
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export default {
  contracts: {
    "import.platform": {
      /**
       * Implements contract import.platform, operation convert (dispatch: chosen).
       *
       * Finds the site's JSON:API, reads its pages, book pages, files, media and menu links, and builds the outline from
       * the menu (or book fields, or creation order), with media embeds turned into HAX elements and files listed for
       * core to fetch.
       *
       * @param {object} ctx    Platform context (spec/13); ctx.fetch reaches only input.url's host.
       * @param {object} input  { url } (any URL of the Drupal site).
       * @returns {Promise<object>}  { title, items, files } or { error }.
       */
      async convert(ctx, input) {
        if (!input || !input.url) return { error: "url is required" };
        const found = await discover(ctx, String(input.url).trim());
        if (!found) return { error: "no Drupal JSON:API found at this URL or its parents (expected <base>/jsonapi)" };
        const { base, links } = found;
        const href = (k) => (isObj(links[k]) && typeof links[k].href === "string" && links[k].href !== "" ? links[k].href : null);
        if (!href("node--page") && !href("node--book")) {
          const exposed = Object.keys(links).filter((k) => k.indexOf("node--") === 0);
          return { error: `Drupal JSON:API found, but it exposes neither node--page nor node--book${exposed.length ? ` (found: ${exposed.join(", ")})` : ""}` };
        }
        const pageRecords = await collection(ctx, href("node--page"), 50, 200);
        const bookRecords = await collection(ctx, href("node--book"), 50, 200);
        const records = new Map();
        for (const r of pageRecords.concat(bookRecords)) { const n = nid(r); if (n > 0 && !records.has(n)) records.set(n, r); }
        if (!records.size) return { error: "Drupal JSON:API found, but node--page and node--book have no readable records" };
        const map = fileMap(await collection(ctx, href("file--file"), 50, 400), base);
        const media = Object.create(null);
        for (const k of Object.keys(links)) {
          if (k.indexOf("media--") !== 0 || !href(k)) continue;
          for (const r of await collection(ctx, href(k), 50, 200)) if (isObj(r) && str(r.id) !== "") media[r.id] = mediaFor(r, map);
        }
        const menuLinks = await collection(ctx, href("menu_link_content--menu_link_content"), 100, 200);
        const contentCache = new Map();
        const content = (n) => { if (!contentCache.has(n)) contentCache.set(n, records.has(n) ? pageContent(records.get(n), base, media, map) : "<p></p>"); return contentCache.get(n); };
        const children = forestFromMenuLinks(menuLinks, records) || forestFromBooks(bookRecords, records)
          || new Map([[0, [...records.values()].sort((a, b) => cmp(created(a), created(b)) || nid(a) - nid(b)).map(nid)]]);
        const items = [];
        const consumed = new Set();
        const dropped = new Set();
        // a top-level page with no content but with children is structural: its children take its place
        const expand = (list) => list.flatMap((n) => { if (dropped.has(n)) return []; const kids = children.get(n) || []; if (content(n) === "<p></p>" && kids.length) { dropped.add(n); return expand(kids); } return [n]; });
        const walk = (list, parent, prefix, indent) => {
          const siblings = Object.create(null);
          let order = 0;
          for (const n of list) {
            const r = records.get(n);
            if (!r || consumed.has(n)) continue;
            const slug = (prefix !== "" ? `${prefix}/` : "") + uniqueSegment(nodeSegment(r), siblings, n);
            const item = { id: `item-${n}`, title: nodeTitle(r), slug, parent, order: order++, indent, content: content(n), metadata: nodeMetadata(r, base, true) };
            items.push(item);
            consumed.add(n);
            walk(children.get(n) || [], item.id, slug, indent + 1);
          }
        };
        walk(expand(children.get(0) || []), null, "", 0);
        const rest = [...records.values()].filter((r) => !consumed.has(nid(r)) && !dropped.has(nid(r)))
          .sort((a, b) => cmp(nodeTitle(a).toLowerCase(), nodeTitle(b).toLowerCase()) || nid(a) - nid(b));
        if (rest.length) {
          const top = Object.create(null);
          for (const it of items) if (it.parent === null) top[it.slug] = true;
          const count = Object.keys(top).length;
          const group = { id: "item-additional-pages", title: "additional pages", slug: uniqueSegment("additional-pages", top, "group"), parent: null, order: count, indent: 0, content: "<p></p>", metadata: { hideInMenu: true, sourceType: "drupal-additional-pages" } };
          items.push(group);
          const siblings = Object.create(null);
          rest.forEach((r, i) => {
            const n = nid(r);
            items.push({ id: `item-${n}`, title: nodeTitle(r), slug: `${group.slug}/${uniqueSegment(nodeSegment(r), siblings, n)}`, parent: group.id, order: i, indent: 1, content: content(n), metadata: nodeMetadata(r, base, false) });
          });
        }
        return { title: siteName(String(input.url).trim()), items, files: map.files };
      },
    },
  },
};
