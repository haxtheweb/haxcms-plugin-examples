// Plone importer (Node). Mirrored in src/php/Plugin.php; both return identical results.
// Port of core's convertPloneToSite.js: finds the plone.restapi endpoints from any URL inside the site, pages through
// @search, and turns page-like content into a tree by path. Images and files are listed for core to fetch.
const PAGE_TYPES = ["Document", "News Item", "Event", "Folder", "Collection", "Link", "Topic", "Listing"];
const BINARY_TYPES = ["Image", "File"];
const STOP_SEGMENTS = ["@site", "@search", "@types", "++api++"];
const MAX_ITEMS = 5000;
const MAX_SEARCH_PAGES = 500;
const BATCH = 100;
const METADATA_FIELDS = ["UID", "portal_type", "path", "is_folderish", "created", "modified", "review_state", "getObjPositionInParent"];
const JSON_HEADERS = { headers: { Accept: "application/json" } };

/** HAXCMS.cleanTitle(value, false) from core. */
function cleanTitle(value) {
  const t = String(value).trim().replace(/ /g, "-").toLowerCase().replace(/[^\w\-/]+/g, "-").replace(/--+/g, "-");
  return t === "" ? "blank" : t;
}

/** A positive integer, or the fallback (core's normalizePositiveInt; written so PHP matches it exactly). */
function positiveInt(value, fallback) {
  const m = /^\s*([+-]?\d+)/.exec(value === null || value === undefined ? "" : String(value));
  const n = m ? Number(m[1]) : NaN;
  return Number.isNaN(n) || n < 1 ? fallback : n;
}

const isObject = (v) => v !== null && typeof v === "object";
const isText = (v) => typeof v === "string" && v.trim() !== "";
const stripSlash = (v) => (v.endsWith("/") ? v.slice(0, -1) : v);

/** { scheme, host, path } of an absolute http(s) URL, or null. */
function parseUrl(url) {
  const m = /^(https?):\/\/([^/?#]+)([^?#]*)/i.exec(String(url));
  return m ? { scheme: m[1].toLowerCase(), host: m[2], path: m[3] || "/" } : null;
}

/** Resolve a link against an absolute base URL (enough of the URL standard for Plone download links). */
function resolveUrl(base, rel) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(rel)) return rel;
  const m = /^([a-z][a-z0-9+.-]*:)\/\/([^/?#]*)([^?#]*)/i.exec(base);
  if (!m) return rel;
  if (rel.startsWith("//")) return `${m[1]}${rel}`;
  let path;
  if (rel.startsWith("/")) path = rel;
  else if (rel.startsWith("?")) path = `${m[3]}${rel}`;
  else path = `${m[3].replace(/[^/]*$/, "") || "/"}${rel}`;
  const q = /^([^?#]*)(.*)$/.exec(path);
  const segs = q[1].split("/");
  const out = [];
  segs.forEach((s, i) => {
    const last = i === segs.length - 1;
    if (s === "..") { if (out.length > 1) out.pop(); if (last) out.push(""); }
    else if (s === ".") { if (last) out.push(""); }
    else out.push(s);
  });
  return `${m[1]}//${m[2]}${out.join("/")}${q[2]}`;
}

/** Drop script elements and inline event handlers; core sanitizes again on save. */
function strip(html) {
  return String(html)
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

/** GET as JSON, never throwing: { ok, status, data }. */
async function getJson(ctx, url) {
  try {
    const r = await ctx.fetch(url, JSON_HEADERS);
    let data = null;
    try { data = await r.json(); } catch { data = null; }
    return { ok: r.ok, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

function reason(res, fallback) {
  const d = res && res.data;
  if (isObject(d)) for (const k of ["reason", "message", "error", "error_type", "type"]) if (typeof d[k] === "string" && d[k] !== "") return d[k];
  return fallback || "Unknown error";
}
const restDenied = (res) => (res.status === 401 || res.status === 403) && reason(res, "").toLowerCase().includes("plone.restapi");

/** The URL and each parent of it, longest first, as candidate site roots. */
function candidates(u) {
  const origin = `${u.scheme}://${u.host}`;
  let parts = u.path.split("/").filter(Boolean);
  while (parts.length && STOP_SEGMENTS.includes(parts[parts.length - 1])) parts = parts.slice(0, -1);
  const out = [];
  for (let i = parts.length; i >= 0; i--) {
    const c = stripSlash(i > 0 ? `${origin}/${parts.slice(0, i).join("/")}` : origin);
    if (!out.includes(c)) out.push(c);
  }
  return out;
}

async function discover(ctx, u) {
  let blocked = null;
  for (const c of candidates(u)) {
    const site = await getJson(ctx, `${c}/@site`);
    if (site.ok && isObject(site.data)) return { base: c, site: site.data };
    if (restDenied(site)) blocked = { base: c, status: site.status };
    const api = await getJson(ctx, `${c}/++api++`);
    if (restDenied(api)) blocked = { base: c, status: api.status };
  }
  if (blocked) return { error: `Plone REST API detected at ${blocked.base} but access is denied (${blocked.status}). Enable "plone.restapi: Use REST API" permission for authenticated/anonymous access and retry.` };
  return { error: "Unable to discover Plone REST endpoints from url. Expected endpoints like /@site and /@search. Install/enable the plone.restapi add-on and expose REST access before importing." };
}

function searchUrl(base, start, full) {
  const q = [`b_start=${start}`, `b_size=${BATCH}`, "sort_on=path", "sort_order=ascending", ...METADATA_FIELDS.map((f) => `metadata_fields=${f}`)];
  if (full) q.push("fullobjects=1");
  return `${base}/@search?${q.join("&")}`;
}

/** Every search result, asking for full objects and falling back to summaries when the site refuses them. */
async function searchAll(ctx, base) {
  let start = 0, pages = 0, total = null, full = true;
  const all = [];
  while (pages < MAX_SEARCH_PAGES && all.length < MAX_ITEMS) {
    let res = await getJson(ctx, searchUrl(base, start, full));
    if (!res.ok && full) {
      const fallback = await getJson(ctx, searchUrl(base, start, false));
      if (fallback.ok) { res = fallback; full = false; }
    }
    if (!res.ok) {
      if (restDenied(res)) return { error: 'Plone REST search endpoint is not accessible. Enable "plone.restapi: Use REST API" permission and retry.' };
      if (res.status === 404) return { error: "Plone REST search endpoint /@search was not found. Enable/install plone.restapi and retry." };
      return { error: `Plone search failed at ${base}/@search (${res.status}): ${reason(res, "search request failed")}` };
    }
    const payload = isObject(res.data) ? res.data : {};
    const batch = Array.isArray(payload.items) ? payload.items : [];
    if (typeof payload.items_total === "number") total = payload.items_total;
    if (!batch.length) break;
    for (const it of batch) { all.push(it); if (all.length >= MAX_ITEMS) break; }
    start += batch.length;
    pages++;
    if ((total !== null && start >= total) || batch.length < BATCH) break;
  }
  return { items: all, full };
}

/** Path of an item below the site root, decoded, without slashes at the ends; "" for the root or a bad URL. */
function relativePath(itemUrl, basePath) {
  const u = parseUrl(itemUrl);
  if (!u) return "";
  let p = u.path;
  let b = basePath === "/" ? "" : stripSlash(basePath);
  if (b !== "" && p === b) return "";
  p = b !== "" && p.startsWith(`${b}/`) ? p.slice(b.length + 1) : p.replace(/^\/+/, "");
  p = p.replace(/\/+$/, "");
  try { p = decodeURIComponent(p); } catch { /* keep as is */ }
  return p;
}

function importAsPage(item, type) {
  if (!type || BINARY_TYPES.includes(type)) return false;
  if (PAGE_TYPES.includes(type) || item.is_folderish === true) return true;
  if (isObject(item.text) && isText(item.text.data)) return true;
  return isText(item.description);
}

/** Make root-relative href, src, poster and srcset values absolute on the Plone host. */
function absolutize(html, origin) {
  return html.replace(/href="\//g, `href="${origin}/`).replace(/src="\//g, `src="${origin}/`).replace(/poster="\//g, `poster="${origin}/`).replace(/srcset="\//g, `srcset="${origin}/`);
}

function contents(item, type, origin) {
  if (isObject(item.text) && isText(item.text.data)) return strip(absolutize(item.text.data, origin));
  if (type === "Link" && item.remoteUrl) return strip(`<p><a href="${item.remoteUrl}" target="_blank" rel="noopener noreferrer">${item.remoteUrl}</a></p>`);
  if (item.blocks && isObject(item.blocks_layout) && Array.isArray(item.blocks_layout.items) && item.blocks_layout.items.length) return "<p>This Plone item stores body content in blocks and requires a blocks-to-HTML transform for full fidelity import.</p>";
  if (isText(item.description)) return strip(`<p>${item.description.trim()}</p>`);
  return "<p></p>";
}

function record(item, type, rel, origin) {
  const parts = rel.split("/").filter(Boolean);
  if (!parts.length) return null;
  const hint = positiveInt(item.getObjPositionInParent, -1);
  return {
    relativePath: rel,
    parentPath: parts.length > 1 ? parts.slice(0, -1).join("/") : "",
    slug: parts.map(cleanTitle).join("/"),
    title: isText(item.title) ? item.title.trim() : parts[parts.length - 1],
    description: typeof item.description === "string" ? item.description : "",
    orderHint: hint >= 0 ? hint : null,
    content: contents(item, type, origin),
    metadata: {
      sourceType: "plone",
      source: item["@id"],
      plone: { uid: item.UID || "", type, reviewState: item.review_state || "", created: item.created || "", modified: item.modified || "" },
    },
  };
}
const score = (r) => (r.content !== "<p></p>" ? 2 : 0) + (r.description ? 1 : 0) + (r.orderHint !== null ? 1 : 0);

function sanitizeFilename(value) {
  const f = value.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^a-z0-9\-._/]+/g, "-").replace(/--+/g, "-");
  return f === "" ? "file" : f;
}

function uniqueKey(files, key) {
  if (!files[key]) return key;
  const parts = key.split("/");
  const name = parts.pop();
  const folder = parts.join("/");
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let i = 2;
  while (files[`${folder}/${stem}-${i}${ext}`]) i++;
  return `${folder}/${stem}-${i}${ext}`;
}

/** Images and files: listed for core to fetch into files/, never downloaded here. */
function registerBinary(item, files) {
  let filename = "", download = "";
  for (const field of ["file", "image"]) {
    const f = item[field];
    if (!isObject(f)) continue;
    if (!filename && typeof f.filename === "string") filename = f.filename;
    if (!download && typeof f.download === "string") download = resolveUrl(item["@id"], f.download);
  }
  if (!download && item["@type"] === "File") download = `${stripSlash(item["@id"])}/@@download/file`;
  if (!download && item["@type"] === "Image") download = `${stripSlash(item["@id"])}/@@images/image`;
  if (!filename) filename = String(item["@id"]).split("/").pop();
  if (!filename || !download) return;
  files[uniqueKey(files, `files/${sanitizeFilename(filename)}`)] = download;
}

function compare(a, b) {
  const ah = a.orderHint !== null, bh = b.orderHint !== null;
  if (ah && bh && a.orderHint !== b.orderHint) return a.orderHint - b.orderHint;
  if (ah && !bh) return -1;
  if (!ah && bh) return 1;
  return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
}

/** Records into a JOS tree: children follow their parent, a record whose parent was not imported goes to the top. */
function toItems(records) {
  const byPath = {};
  for (const r of records) byPath[r.relativePath] = r;
  const children = {};
  for (const r of records) {
    const parent = r.parentPath !== "" && byPath[r.parentPath] ? r.parentPath : "";
    (children[parent] = children[parent] || []).push(r);
  }
  for (const k of Object.keys(children)) children[k].sort(compare);
  const items = [];
  const seen = {};
  const walk = (parentPath, parentId, depth) => {
    (children[parentPath] || []).forEach((r, i) => {
      if (seen[r.relativePath]) return;
      seen[r.relativePath] = true;
      const id = `item-${items.length + 1}`;
      items.push({ id, title: r.title, slug: r.slug, parent: parentId, order: i, indent: depth, description: r.description, content: r.content, metadata: r.metadata });
      walk(r.relativePath, id, depth + 1);
    });
  };
  walk("", null, 0);
  return items;
}

export default {
  contracts: {
    "import.platform": {
      /**
       * Implements contract import.platform, operation convert (dispatch: chosen).
       *
       * Finds the Plone REST API from any URL inside the site, reads every item through @search, and returns
       * documents, folders, news, events and links as a page tree by path, with images and files listed for core to fetch.
       * Items whose body is in Volto blocks get a placeholder paragraph, as in core.
       *
       * @param {object} ctx    Platform context (spec/13); ctx.fetch reaches only input.url's host.
       * @param {object} input  { url } of the Plone site or any page in it.
       * @returns {Promise<object>}  { title, items, files } or { error }.
       */
      async convert(ctx, input) {
        if (!input || !isText(input.url)) return { error: "url is required" };
        // core needs the full URL to open its host for this call (egress { input: url }), so no scheme guessing here
        const u = parseUrl(input.url.trim());
        if (!u) return { error: "url is not a valid http(s) URL" };
        const found = await discover(ctx, u);
        if (found.error) return { error: found.error };
        const search = await searchAll(ctx, found.base);
        if (search.error) return { error: search.error };
        const baseUrl = parseUrl(found.base);
        const origin = `${baseUrl.scheme}://${baseUrl.host}`;
        const byPath = new Map(); // insertion order, as PHP arrays keep it (object keys like "2024" would sort first)
        const files = {};
        for (let item of search.items) {
          if (!search.full && isObject(item) && item["@id"]) {
            const full = await getJson(ctx, item["@id"]);
            if (full.ok && isObject(full.data)) item = Object.assign({}, item, full.data);
          }
          if (!isObject(item) || !item["@id"]) continue;
          const type = item["@type"] ? item["@type"] : item.portal_type;
          if (BINARY_TYPES.includes(type)) { registerBinary(item, files); continue; }
          if (!importAsPage(item, type)) continue;
          const rel = relativePath(item["@id"], baseUrl.path);
          if (!rel) continue;
          const r = record(item, type, rel, origin);
          if (r && (!byPath.has(rel) || score(r) > score(byPath.get(rel)))) byPath.set(rel, r);
        }
        const items = toItems([...byPath.values()]);
        if (!items.length) return { error: "Plone REST API is reachable but import produced no page-like content items" };
        const lastBit = baseUrl.path.split("/").filter(Boolean).pop();
        const title = isText(found.site.title) ? found.site.title.trim() : lastBit || "Plone site";
        return { title, items, files: Object.entries(files).map(([path, url]) => ({ path, url })) };
      },
    },
  },
};
