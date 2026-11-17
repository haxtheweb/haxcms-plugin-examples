// ELMS:LN importer (Node). Mirrored in src/php/Plugin.php; identical output.
// ELMS:LN course sites publish a JSON Outline Schema site.json. Page locations may carry the site's own name as a
// prefix (/<name>/pages/...), which is dropped before fetching. A page that cannot be read gets a link to its source
// instead of failing the import, as core does today.

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

/** Removes script and style blocks and inline event handlers; core sanitizes again on save. */
export const strip = (html) => cleanHtml(html, ["script", "style"], [], false);

async function text(ctx, url) {
  try { const r = await ctx.fetch(url); return r.ok ? await r.text() : null; } catch { return null; }
}

export default {
  contracts: {
    "import.platform": {
      /**
       * Implements contract import.platform, operation convert (dispatch: chosen).
       *
       * Reads the course's site.json, then each page's HTML from its location, keeping ids, tree, order and metadata;
       * lists the files pages reference for core to fetch. A page that cannot be read links to its source instead.
       *
       * @param {object} ctx    Platform context (spec/13); ctx.fetch reaches only input.url's host.
       * @param {object} input  { url } (the site root or its site.json).
       * @returns {Promise<object>}  { title, items, files } or { error }.
       */
      async convert(ctx, input) {
        if (!input || !input.url) return { error: "url is required" };
        let u;
        try { u = new URL(String(input.url).trim().replace(/\/site\.json$/, "").replace(/\/+$/, "")); } catch { return { error: "url is not a URL" }; }
        const base = `${u.protocol}//${u.host}${u.pathname}`.replace(/\/+$/, "");
        let site = null;
        try { const r = await ctx.fetch(`${base}/site.json`); if (r.ok) site = await r.json(); } catch { site = null; }
        if (!site || typeof site !== "object" || !Array.isArray(site.items)) return { error: `no site.json with items at ${base}; this does not look like an ELMS:LN site` };
        const name = (site.metadata && site.metadata.site && site.metadata.site.name) || base.split("/").pop() || u.host;
        const items = [];
        const files = [];
        const seen = Object.create(null);
        for (const it of site.items) {
          if (!it || typeof it !== "object") continue;
          const location = typeof it.location === "string" ? it.location : "";
          let content = "";
          if (location !== "") {
            const path = location.indexOf(`/${name}/`) === 0 ? location.slice(name.length + 2) : location.replace(/^\/+/, "");
            const url = `${base}/${path}`;
            const t = await text(ctx, url);
            content = t !== null ? strip(t) : `<p>get source from <a href="${url}">${url}</a></p>`;
          }
          const item = { id: it.id, title: it.title || "Page", slug: it.slug || it.id, parent: it.parent || null, order: it.order ?? items.length, indent: it.indent ?? 0, content };
          if (it.metadata && typeof it.metadata === "object" && !Array.isArray(it.metadata) && Object.keys(it.metadata).length) item.metadata = it.metadata;
          items.push(item);
          for (const f of (it.metadata && Array.isArray(it.metadata.files) ? it.metadata.files : [])) {
            if (f && typeof f.url === "string" && f.url !== "" && !seen[f.url]) { seen[f.url] = true; files.push({ path: f.url, url: `${base}/${f.url}` }); }
          }
        }
        return { title: site.title || name, items, files };
      },
    },
  },
};
