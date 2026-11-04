// GitBook importer (Node). Mirrored in src/php/Plugin.php; identical output.
// A GitBook is a SUMMARY.md table of contents (a nested Markdown list of links) plus the Markdown pages it links to.
// The list nesting becomes the page tree; each page's Markdown is converted by whichever plugin implements import.file
// for .md (import-markdown), through ctx.contracts.call, so this plugin has no Markdown parser of its own.
// Images and other files the pages reference are listed in `files` for core to fetch; this plugin downloads nothing.

/** Removes script and style blocks and inline event handlers; core sanitizes again on save. */
export const strip = (html) => String(html).replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "").replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, "");

/** Core's HAXCMS.cleanTitle(value, false): lower case, spaces and other characters to dashes, "/" kept. */
export function cleanTitle(value) {
  const s = String(value).trim().replace(/ /g, "-").toLowerCase().replace(/[^\w\-/]+/g, "-").replace(/--+/g, "-");
  return s === "" ? "blank" : s;
}

const enc = (p) => p.replace(/ /g, "%20");

/** A book-relative path with "." and ".." resolved; null when it climbs above the book's root. */
export function normalize(path) {
  const out = [];
  for (const seg of String(path).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { if (!out.length) return null; out.pop(); } else out.push(seg);
  }
  return out.join("/");
}

/**
 * Where the book lives, from whatever the person pasted. A github.com repository URL is read through github.com's own
 * /raw/ paths (same host, so egress { input: url } allows it), trying main then master when no branch is named; any
 * other URL (raw.githubusercontent.com, a docs host) is the book's folder or its SUMMARY.md.
 */
export function sourceOf(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const origin = `${u.protocol}//${u.host}`;
  const parts = u.pathname.split("/").filter(Boolean);
  let summary = "SUMMARY.md";
  if (parts.length && /\.md$/i.test(parts[parts.length - 1])) summary = parts.pop();
  if (u.hostname === "github.com") {
    if (parts.length < 2) return null;
    let branches = ["main", "master"];
    let dir = [];
    if (["blob", "tree", "raw"].includes(parts[2]) && parts[3]) { branches = [parts[3]]; dir = parts.slice(4); }
    return { roots: branches.map((b) => [origin, parts[0], parts[1], "raw", b, ...dir].join("/")), summary, title: parts[1] };
  }
  const title = u.hostname === "raw.githubusercontent.com" && parts.length > 1 ? parts[1] : parts.length ? parts[parts.length - 1] : u.hostname;
  return { roots: [[origin, ...parts].join("/")], summary, title };
}

/**
 * SUMMARY.md list entries in order: { title, path, depth, parent } where parent is the index of the nearest linked
 * ancestor (an unlinked line's children attach to the line above it, as core does). External links are skipped.
 */
export function parseSummary(md) {
  const out = [];
  const stack = [];
  for (const line of String(md).replace(/\r\n?/g, "\n").split("\n")) {
    const m = /^([ \t]*)[*+-][ \t]+(.*)$/.exec(line);
    if (!m) continue;
    const width = m[1].replace(/\t/g, "    ").length;
    while (stack.length && stack[stack.length - 1].width >= width) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].owner : null;
    const link = /^\[([^\]]*)\]\(\s*<?([^)\s>]*)>?(?:\s+"[^"]*")?\s*\)/.exec(m[2].trim());
    const href = link ? link[2].split("#")[0] : "";
    const path = href !== "" && !/^[a-z][a-z0-9+.-]*:/i.test(href) && href.indexOf("//") !== 0 ? normalize(href) : null;
    let owner = parent;
    if (path) { out.push({ title: link[1].trim() || path, path, depth: stack.length, parent }); owner = out.length - 1; }
    stack.push({ width, owner });
  }
  return out;
}

/** Points src/href values at files the book holds to files/<path>, and lists each once for core to fetch. */
export function rewriteFiles(html, pagePath, root, files, seen) {
  const dir = pagePath.indexOf("/") !== -1 ? pagePath.slice(0, pagePath.lastIndexOf("/")) : "";
  return html.replace(/(\s(?:src|href)=")([^"]*)"/gi, (m, pre, value) => {
    const v = value.split("#")[0].split("?")[0];
    if (v === "" || /^[a-z][a-z0-9+.-]*:/i.test(v) || v.indexOf("//") === 0 || /\.md$/i.test(v) || !/\.[a-z0-9]+$/i.test(v.split("/").pop())) return m;
    const p = normalize(v.charAt(0) === "/" ? v : `${dir}/${v}`);
    if (!p) return m;
    const path = `files/${p}`;
    if (!seen[path]) { seen[path] = true; files.push({ path, url: `${root}/${enc(p)}` }); }
    return `${pre}${path}"`;
  });
}

async function text(ctx, url) {
  try { const r = await ctx.fetch(url); return r.ok ? await r.text() : null; } catch { return null; }
}

export default {
  contracts: {
    "import.platform": {
      /**
       * Implements contract import.platform, operation convert (dispatch: chosen).
       *
       * Reads SUMMARY.md, turns its nested list into the page tree, and converts each linked Markdown page to HTML
       * through the import.file contract (import-markdown); files the pages reference are listed for core to fetch.
       *
       * @param {object} ctx    Platform context (spec/13); ctx.fetch reaches only input.url's host.
       * @param {object} input  { url } (a github.com repository, the book's folder, or its SUMMARY.md).
       * @returns {Promise<object>}  { title, items, files } or { error }.
       */
      async convert(ctx, input) {
        if (!input || !input.url) return { error: "url is required" };
        const src = sourceOf(input.url);
        if (!src) return { error: "url is not a GitBook or GitHub repository URL" };
        let root = null;
        let md = null;
        for (const r of src.roots) {
          const t = await text(ctx, `${r}/${enc(src.summary)}`);
          if (t !== null && t.trim() !== "") { root = r; md = t; break; }
        }
        if (md === null) return { error: `no ${src.summary} found at ${src.roots[0]}; this does not look like a GitBook` };
        const entries = parseSummary(md);
        if (!entries.length) return { error: `${src.summary} lists no pages; this does not look like a GitBook` };
        const items = [];
        const files = [];
        const seen = Object.create(null);
        const slugs = Object.create(null);
        const orders = Object.create(null);
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          const parent = e.parent === null ? null : `item-${e.parent + 1}`;
          const key = parent === null ? "" : parent;
          orders[key] = key in orders ? orders[key] + 1 : 0;
          const bare = e.path.replace(/\.md$/i, "").replace(/(^|\/)readme$/i, "");
          let slug = cleanTitle(bare !== "" ? bare : e.title);
          if (slugs[slug]) { let n = 2; while (slugs[`${slug}-${n}`]) n++; slug = `${slug}-${n}`; }
          slugs[slug] = true;
          let content = "";
          const t = await text(ctx, `${root}/${enc(e.path)}`);
          if (t !== null && t.trim() !== "") {
            const r = await ctx.contracts.call("import.file", "convert", { name: "page.md", data: Buffer.from(t, "utf8").toString("base64") });
            if (r && typeof r.html === "string") content = rewriteFiles(strip(r.html), e.path, root, files, seen);
          }
          items.push({ id: `item-${i + 1}`, title: e.title, slug, parent, order: orders[key], indent: e.depth, content });
        }
        return { title: src.title, items, files };
      },
    },
  },
};
