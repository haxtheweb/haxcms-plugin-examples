// WordPress importer (Node). Mirrored in src/php/Plugin.php; identical output.
// Reads a WXR export (WordPress > Tools > Export) with regular expressions, as the other importers do, so both runtimes
// parse it the same way. Pages and posts become items; drafts are kept unpublished; attachments are listed in `files`
// for core to fetch (the contract's media slot), never downloaded here.
const tag = (xml, name) => { const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml); return m ? m[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1").trim() : ""; };
const strip = (html) => String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/\son\w+="[^"]*"/gi, "");
// WordPress keeps paragraphs as blank lines; wrap loose text in <p> as wpautop would
const autop = (s) => (/<(p|div|h[1-6]|ul|ol|figure|table|blockquote)\b/i.test(s) ? s : s.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${x}</p>`).join(""));

export function convert(xml) {
  const channel = tag(xml, "channel");
  const raw = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const posts = raw.map((x) => ({ id: tag(x, "wp:post_id"), type: tag(x, "wp:post_type"), status: tag(x, "wp:status"), title: tag(x, "title"), slug: tag(x, "wp:post_name"), parent: tag(x, "wp:post_parent"), order: Number(tag(x, "wp:menu_order")) || 0, content: tag(x, "content:encoded"), url: tag(x, "wp:attachment_url") }));
  const keep = posts.filter((p) => (p.type === "page" || p.type === "post") && p.status !== "trash");
  const ids = new Set(keep.map((p) => p.id));
  const items = keep
    .sort((a, b) => (a.type === b.type ? 0 : a.type === "page" ? -1 : 1) || a.order - b.order || Number(a.id) - Number(b.id))
    .map((p, i) => ({
      id: `item-${p.id}`, title: p.title || "Untitled", slug: p.slug || `item-${p.id}`,
      parent: p.parent && p.parent !== "0" && ids.has(p.parent) ? `item-${p.parent}` : null, order: i,
      content: autop(strip(p.content)), ...(p.status === "publish" ? {} : { metadata: { published: false } }),
    }));
  const files = posts.filter((p) => p.type === "attachment" && /^https?:\/\//.test(p.url)).map((p) => ({ path: `files/${p.url.split("/").pop().split("?")[0]}`, url: p.url }));
  return { title: tag(channel, "title") || "Imported site", items, ...(files.length ? { files } : {}) };
}

export default {
  contracts: {
    "import.platform": {
      /**
       * Implements contract import.platform, operation convert (dispatch: chosen).
       *
       * Turns a WordPress export (WXR) into pages: pages first, then posts, with parents kept, drafts unpublished and trashed items skipped. Attachments are listed in files for core to fetch, never downloaded here.
       *
       * @param {object} ctx    Platform context (spec/13); unused.
       * @param {object} input  { xml } (or { html } holding the same WXR text).
       * @returns {Promise<object>}  { title, items, files? } or { error }.
       */
      async convert(ctx, input) {
        const xml = input && typeof input.xml === "string" ? input.xml : input && typeof input.html === "string" ? input.html : null;
        if (!xml || !/<rss[\s>][\s\S]*xmlns:wp=/.test(xml)) return { error: "a WordPress export (WXR) file is required" };
        return convert(xml);
      },
    },
  },
};
