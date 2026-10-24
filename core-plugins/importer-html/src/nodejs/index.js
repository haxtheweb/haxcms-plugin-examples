// HTML importer (Node). Mirrored in src/php/Plugin.php.
// Splits the document at each <h2>; the <h1> (or <title>) becomes the site title. Scripts, styles and event
// handlers are dropped; core sanitizes page HTML again on save, as it does for every importer today.
const strip = (html) => String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/\son\w+="[^"]*"/gi, "");
const text = (html) => String(html).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
export const slug = (t) => text(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "page";

export function convert(html) {
  const clean = strip(html);
  const body = (clean.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [null, clean])[1];
  const title = text((body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || clean.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [null, "Imported site"])[1]);
  const rest = body.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, "");
  const parts = rest.split(/(?=<h2[^>]*>)/i).map((p) => p.trim()).filter(Boolean);
  const items = [];
  for (const part of parts) {
    const h = part.match(/^<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const pageTitle = h ? text(h[1]) : "Introduction";
    const content = (h ? part.slice(h[0].length) : part).trim();
    let s = slug(pageTitle), n = 2;
    while (items.some((i) => i.slug === s)) s = `${slug(pageTitle)}-${n++}`;
    items.push({ id: `item-${items.length + 1}`, title: pageTitle, slug: s, parent: null, order: items.length, content });
  }
  return { title, items };
}

export default {
  contracts: {
    "import.platform": {
      async convert(ctx, input) {
        if (!input || typeof input.html !== "string") return { error: "html is required" };
        return convert(input.html);
      },
    },
  },
};
