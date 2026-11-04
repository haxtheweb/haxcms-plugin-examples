// Outline logic shared by the route (Node); src/php/Plugin.php mirrors it.
// Checks an outline: unique ids, parents that exist in the outline, no cycles. Returns an error string or null.
export function check(items) {
  const ids = new Set();
  for (const it of items) { if (!it.id || !it.title) return "every item needs an id and a title"; if (ids.has(it.id)) return `duplicate id ${it.id}`; ids.add(it.id); }
  const parent = Object.fromEntries(items.map((it) => [it.id, it.parent || null]));
  for (const it of items) {
    if (it.parent && !ids.has(it.parent)) return `${it.id}: parent ${it.parent} is not in the outline`;
    let p = it.parent, steps = 0;
    while (p) { if (p === it.id || ++steps > items.length) return `${it.id}: parent chain loops`; p = parent[p]; }
  }
  return null;
}
export const slugify = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "page";
