// Notion importer (Node). Mirrored in src/php/Plugin.php; both return identical results.
// Port of core's convertNotionToSite.js: a Notion export committed to GitHub, read through the GitHub API.
const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";

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

/** Drop script elements and inline event handlers; core sanitizes again on save. */
function strip(html) {
  return String(html)
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

/** owner, repo and optional branch from a github.com URL, or null. */
export function parseRepo(url) {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)(?:\/tree\/([^/?#]+))?/i.exec(String(url).trim());
  return m ? { owner: m[1], repo: m[2].replace(/\.git$/, ""), branch: m[3] || null } : null;
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
       * @param {object} ctx    Platform context (spec/13); ctx.fetch reaches only api.github.com and raw.githubusercontent.com.
       * @param {object} input  { url } of the repository (https://github.com/<owner>/<repo>, optionally /tree/<branch>).
       * @returns {Promise<object>}  { title, items, files } or { error }.
       */
      async convert(ctx, input) {
        if (!input || !input.url) return { error: "url is required" };
        const gh = parseRepo(input.url);
        if (!gh) return { error: "url must be a GitHub repository (https://github.com/<owner>/<repo>)" };
        const repoApi = `${API}/repos/${gh.owner}/${gh.repo}`;
        let branch = gh.branch;
        if (!branch) {
          try { const r = await ctx.fetch(repoApi); const d = r.ok ? await r.json() : {}; branch = (d && d.default_branch) || "main"; }
          catch { branch = "main"; }
        }
        let tree;
        try {
          const r = await ctx.fetch(`${repoApi}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const d = await r.json();
          tree = d && Array.isArray(d.tree) ? d.tree : [];
        } catch (e) { return { error: `unable to read the repository file list: ${e.message}` }; }
        const paths = tree.filter((f) => f && f.type !== "tree" && typeof f.path === "string").map((f) => f.path);
        if (!paths.some((p) => p.endsWith(".md"))) return { error: "the repository has no markdown pages" };

        // the database CSV names the folder the pages and their files sit in
        const csv = paths.find((p) => p.includes(".csv"));
        const base = csv ? csv.replace(".csv", "") : "";
        const rel = (p) => (base && p.startsWith(`${base}/`) ? p.slice(base.length + 1) : p);
        const raw = (p) => `${RAW}/${gh.owner}/${gh.repo}/${branch}/${encodeURI(p)}`;

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
        for (const p of paths) {
          if (p.includes(".csv") || !p.includes(".md")) continue;
          let md = "";
          try { const r = await ctx.fetch(raw(p)); md = r.ok ? await r.text() : ""; } catch { md = ""; }
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
        return { title: gh.repo, items, files: Object.entries(downloads).map(([path, url]) => ({ path, url })) };
      },
    },
  },
};
