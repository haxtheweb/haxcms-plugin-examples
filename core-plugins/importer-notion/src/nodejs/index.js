// Notion importer (Node). Mirrored in src/php/Plugin.php; both return identical results.
// Port of core's convertNotionToSite.js: a Notion export committed to GitHub, listed and read through import-source.

// Notion page properties ("# Title\n\nLesson: 1. Intro\nType: Reading\n\n") at the top of each exported page
const HEAD_MATTER = /#\s(.*?)\n\n?(.*?):\s(.*)\n(.*?):\s((.|\n)*?)\n\n/im;
const HEAD_TITLE = /(#\s)(.*?)\n/;
const HEAD_LINE = /(.*?)(:\s)(.*)/gim;
// Notion's page types, mapped to HAX page types (core's list; more come with the ontology)
const PAGE_TYPES = { "📙 Reading": "reading", "💬 Canvas Discussion": "discuss", "⚡️ Exercise": "activity", "🔎 Case Study": "connection" };

/** HAXCMS.cleanTitle from core: lowercase, spaces and anything outside [\w-/] become single dashes. */
export function cleanTitle(value) {
  let t = String(value).trim().replace("pages/", "").replace("/index.html", "");
  t = t.replace(/ /g, "-").toLowerCase().replace(/[^\w\-/]+/g, "-").replace(/--+/g, "-");
  return t === "" ? "blank" : t;
}

/** Leading integer of a string, or 0 (parseInt without NaN, written so PHP matches it exactly). */
function toInt(value) {
  const m = /^\s*([+-]?\d+)/.exec(String(value ?? ""));
  return m ? Number(m[1]) : 0;
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

/** Drop script elements and inline event handlers; core sanitizes again on save. */
function strip(html) {
  return cleanHtml(html, ["script"], [], false);
}

/** The site path core gives a non-markdown file (its odd percent clean-up kept so existing links still match). */
function fileKey(rel) {
  return encodeURI(`files/${rel}`).replaceAll("%20", "").replaceAll("%C", "").replaceAll("%", "");
}

/** Notion properties at the top of a page: { headMatter, title, values }. */
function readHeadMatter(md) {
  const m = HEAD_MATTER.exec(md);
  if (!m) return { headMatter: "", title: null, values: {} };
  const headMatter = m[0];
  const t = HEAD_TITLE.exec(headMatter);
  const values = {};
  for (const line of headMatter.match(HEAD_LINE) || []) {
    const parts = line.split(":");
    if (parts.length >= 2) values[parts[0].trim().toLowerCase()] = parts[1].trim();
  }
  return { headMatter, title: t ? t[2] : "", values };
}

export default {
  contracts: {
    "import.platform": {
      /**
       * Implements contract import.platform, operation convert (dispatch: chosen).
       *
       * Reads a Notion export from a GitHub repository: each markdown page becomes an item, grouped under a lesson
       * page made from its Lesson property, and every other file is listed for core to fetch into files/.
       * Markdown is converted by import.file (import-markdown); a page that cannot be read comes back empty.
       *
       * @param {object} ctx    Platform context (spec/13); the repository is read through import-source.tree, so nothing is fetched here.
       * @param {object} input  { url } of the repository (https://github.com/<owner>/<repo>, optionally /tree/<branch>).
       * @returns {Promise<object>}  { title, items, files } or { error }.
       */
      async convert(ctx, input) {
        if (!input || !input.url) return { error: "url is required" };
        // the repository's file list comes from import-source; a branch in the URL is used as given
        const listed = await ctx.contracts.call("import-source.tree", "list", { url: input.url });
        if (!listed || listed.error || !Array.isArray(listed.paths)) return { error: (listed && listed.error) || "the repository's files could not be listed" };
        const paths = listed.paths;
        if (!paths.some((p) => p.endsWith(".md"))) return { error: "the repository has no markdown pages" };

        // the database CSV names the folder the pages and their files sit in
        const csv = paths.find((p) => p.includes(".csv"));
        const base = csv ? csv.replace(".csv", "") : "";
        const rel = (p) => (base && p.startsWith(`${base}/`) ? p.slice(base.length + 1) : p);
        const raw = (p) => `${listed.rawBase}/${encodeURI(p)}`;

        // every other file is listed for core to fetch; page links to it are rewritten to its files/ path
        const downloads = {};
        const fileMap = {};
        for (const p of paths) {
          if (p.includes(".csv") || p.includes(".md") || !p.includes(".")) continue;
          const key = fileKey(rel(p));
          downloads[key] = raw(p);
          fileMap[key] = encodeURI(rel(p));
        }

        const items = [];
        const lessons = {};
        // every page is read in one call; one that cannot be read comes back empty
        const pages = paths.filter((p) => !p.includes(".csv") && p.includes(".md"));
        const got = await ctx.contracts.call("import-source.tree", "read", { repo: listed.repo, branch: listed.branch, paths: pages });
        const texts = {};
        for (const f of (got && Array.isArray(got.files) ? got.files : [])) texts[f.path] = f.data;
        for (const p of pages) {
          let md = typeof texts[p] === "string" ? texts[p] : "";
          md = md.replace(/\r\n?/g, "\n");
          const head = readHeadMatter(md);
          const v = head.values;
          if (v.lesson && !lessons[v.lesson]) {
            let parts = v.lesson.split(". ");
            if (parts.length === 1) parts = ["0", parts[0]];
            const slug = cleanTitle(parts[1].toLowerCase());
            const lesson = { id: `lesson-${slug}`, title: parts[1], slug, parent: null, order: toInt(parts[0]), indent: 0, content: "", metadata: { pageType: "lesson" } };
            items.push(lesson);
            lessons[v.lesson] = lesson;
          }
          md = md.replace(head.headMatter, "");
          for (const key of Object.keys(fileMap)) md = md.replaceAll(fileMap[key], key);
          let content = "";
          if (md.trim()) {
            const out = await ctx.contracts.call("import.file", "convert", { name: "page.md", data: Buffer.from(md, "utf8").toString("base64") });
            content = out && typeof out.html === "string" ? strip(out.html) : "";
          }
          const name = rel(p).replace(".md", "");
          const slug = cleanTitle(name);
          const metadata = PAGE_TYPES[v.type] ? { pageType: PAGE_TYPES[v.type] } : {};
          items.push({
            id: `page-${slug}`,
            title: head.title || name.split("/").pop().replace(/ [0-9a-f]{32}$/i, ""),
            slug,
            parent: lessons[v.lesson] ? lessons[v.lesson].id : null,
            order: v.id ? toInt(v.id.split(".").pop()) : 0,
            indent: 1,
            content,
            metadata,
          });
        }
        return { title: listed.name, items, files: Object.entries(downloads).map(([path, url]) => ({ path, url })) };
      },
    },
  },
};
