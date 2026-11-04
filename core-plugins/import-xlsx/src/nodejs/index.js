// Spreadsheet import (Node). Mirrored in src/php/Plugin.php; same rows, same errors, same items.
const PARTS = "^(xl/workbook\\.xml|xl/_rels/workbook\\.xml\\.rels|xl/sharedStrings\\.xml|xl/worksheets/sheet\\d+\\.xml)$";
const unxml = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const col = (ref) => [...ref.replace(/\d+$/, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const slugOf = (s) => String(s || "").trim().toLowerCase().replace(/[^a-z0-9\-_]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");

/** The worksheet part for a sheet name (or the first sheet). */
function sheetPath(parts, wanted) {
  const sheets = [...(parts["xl/workbook.xml"] || "").matchAll(/<sheet\b[^>]*name="([^"]*)"[^>]*r:id="([^"]*)"/g)].map((m) => ({ name: unxml(m[1]), rid: m[2] }));
  const i = wanted ? sheets.findIndex((s) => s.name === wanted) : 0;
  if (wanted && i < 0) return null;
  const rel = sheets[i] && new RegExp(`<Relationship\\b[^>]*Id="${sheets[i].rid}"[^>]*Target="([^"]+)"`).exec(parts["xl/_rels/workbook.xml.rels"] || "");
  return rel ? `xl/${rel[1].replace(/^\/?xl\//, "")}` : `xl/worksheets/sheet${i + 1}.xml`;
}

/** Rows as arrays of strings. */
function rows(parts, path) {
  const shared = [...(parts["xl/sharedStrings.xml"] || "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml([...m[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")));
  return [...(parts[path] || "").matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)].map((r) => {
    const out = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = (/r="([A-Z]+\d+)"/.exec(c[1]) || [])[1];
      const type = (/t="([^"]+)"/.exec(c[1]) || [])[1];
      const v = (/<v>([\s\S]*?)<\/v>/.exec(c[2] || "") || [])[1];
      const inline = (/<is>[\s\S]*?<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/.exec(c[2] || "") || [])[1];
      out[ref ? col(ref) : out.length] = type === "s" ? shared[Number(v)] ?? "" : type === "inlineStr" ? unxml(inline || "") : unxml(v ?? "");
    }
    return Array.from(out, (x) => x ?? "");
  });
}

export function sheetToItems(parts, sheet) {
  const path = sheetPath(parts, sheet);
  if (!path || !parts[path]) return { error: sheet ? `no sheet named "${sheet}"` : "no sheets found in this file" };
  const all = rows(parts, path).filter((r) => r.some((c) => String(c).trim() !== ""));
  if (!all.length) return { error: "the spreadsheet is empty" };
  const head = {};
  all[0].forEach((h, i) => { const k = String(h).trim().toLowerCase().replace(/\s+/g, ""); if (["title", "slug", "parent", "content"].includes(k)) head[k] = i; });
  if (head.title === undefined || head.slug === undefined) return { error: "the first row must name the columns title and slug (parent and content are optional)" };
  const items = [], bySlug = {};
  for (let i = 1; i < all.length; i++) {
    const r = all[i], n = i + 1;
    const title = String(r[head.title] ?? "").trim(), slug = slugOf(r[head.slug]);
    if (!title) return { error: `row ${n}: title is required` };
    if (!slug) return { error: `row ${n}: slug is required` };
    if (bySlug[slug]) return { error: `row ${n}: duplicate slug "${slug}" (already used on row ${bySlug[slug].row})` };
    const item = { id: `item-${items.length + 1}`, title, slug, parent: null, order: items.length, indent: 0, content: head.content === undefined ? "" : String(r[head.content] ?? ""), parentSlug: slugOf(head.parent === undefined ? "" : r[head.parent]) };
    bySlug[slug] = { item, row: n };
    items.push(item);
  }
  for (const it of items) { if (it.parentSlug && bySlug[it.parentSlug]) { it.parent = bySlug[it.parentSlug].item.id; it.indent = 1; } delete it.parentSlug; }
  return { items };
}

export default {
  contracts: {
    "import.file": {
      /**
       * Implements contract import.file, operation convert (dispatch: accepts .xlsx).
       *
       * Reads one sheet (input.sheet, else the first) whose header row names title and slug (parent and content are
       * optional) and returns the page tree as items; parents are matched by slug. Stops at the first bad row with
       * its row number, as core does today.
       *
       * @param {object} ctx    Platform context (spec/13); uses ctx.archive.read.
       * @param {object} input  { name, data (base64), sheet? }.
       * @returns {Promise<object>}  { items } or { error }.
       */
      async convert(ctx, input) {
        let parts;
        try { parts = await ctx.archive.read(input.data, { match: PARTS }); } catch (e) { return { error: `not an .xlsx file (${e.message})` }; }
        return sheetToItems(parts, input.sheet);
      },
    },
  },
};
