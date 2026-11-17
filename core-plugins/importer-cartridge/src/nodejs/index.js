// Common Cartridge importer (Node). Mirrored in src/php/Plugin.php; identical output.
// Reads an IMS Common Cartridge (.imscc, versions 1.0 to 1.3) through ctx.archive.read and returns its pages for a new
// site. Canvas exports are recognised by their course_settings/ folder, which adds the syllabus, assignment settings
// and the announcement flag. XML is read with the same regular expressions in both runtimes.
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

const KINDS = ["syllabus", "page", "assignment", "discussion", "announcement", "quiz", "link"];
const GROUPS = [["assignment", "Assignments"], ["discussion", "Discussions"], ["announcement", "Announcements"], ["quiz", "Quizzes"], ["link", "Links"]];
const MEDIA = "\\.(png|jpe?g|gif|webp|svg|pdf|mp3|m4a|mp4|webm|vtt|srt|docx?|pptx?|xlsx?|csv|txt)$";

const decode = (s) => String(s ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const tag = (xml, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(String(xml ?? "")); return m ? m[1].trim() : ""; };
const attr = (attrs, name) => { const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs); return m ? decode(m[1]) : ""; };
const text = (s) => decode(String(s ?? "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
const body = (html) => { const m = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html); return (m ? m[1] : html).trim(); };
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
// where a file of the cartridge lives in the new site: files/<path under web_resources>, each segment made safe
const sitePath = (p) => `files/${String(p).replace(/^web_resources\//, "").split("/").map((x) => x.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^\.+/, "")).filter(Boolean).join("/")}`;
const unescapePath = (p) => { try { return decodeURIComponent(p); } catch (e) { return p; } };
// Canvas writes links to course files as $IMS-CC-FILEBASE$/<path>; they become the file's place in the new site
const relink = (html) => html.replace(/(?:\$|%24)IMS-CC-FILEBASE(?:\$|%24)\/([^"'<>\s?#]+)(?:\?[^"'<>\s#]*)?/g, (m, p) => sitePath(unescapePath(p)));
const clean = (html) => relink(cleanHtml(body(String(html ?? "")), ["script", "style"], ["html", "head", "meta", "title", "body"], false)).trim();

/** The manifest's resources, in file order: { id, type, href, files, deps }. */
const readResources = (manifest) => [...manifest.matchAll(/<resource\b([^>]*?)(?:\/>|>([\s\S]*?)<\/resource>)/g)].map((m) => ({
  id: attr(m[1], "identifier"), type: attr(m[1], "type"), href: attr(m[1], "href"),
  files: [...String(m[2] ?? "").matchAll(/<file\b([^>]*?)\/?>/g)].map((f) => attr(f[1], "href")).filter(Boolean),
  deps: [...String(m[2] ?? "").matchAll(/<dependency\b([^>]*?)\/?>/g)].map((d) => attr(d[1], "identifierref")).filter(Boolean),
}));

/** The organization tree as a flat list in document order: { title, ref, depth }; the untitled root is left out. */
const readOutline = (manifest) => {
  const org = tag(manifest, "organizations");
  const out = [];
  let depth = 0;
  let open = null;
  for (const m of org.matchAll(/<item\b([^>]*?)(\/?)>|<\/item>|<title>([\s\S]*?)<\/title>/g)) {
    if (m[0] === "</item>") { depth--; open = null; continue; }
    if (m[3] !== undefined) { if (open) { open.title = text(m[3]); open = null; } continue; }
    const node = { title: "", ref: attr(m[1], "identifierref"), depth };
    out.push(node);
    if (m[2] === "/") continue;
    open = node;
    depth++;
  }
  return out.filter((n) => n.title !== "");
};

/** One entry per importable resource: { id, kind, title, content, published, position, seq }. */
const classify = (resources, texts) => {
  const byId = {};
  for (const r of resources) byId[r.id] = r;
  const entries = [];
  const skipped = { lti: 0 };
  resources.forEach((r, seq) => {
    const main = r.href || r.files[0] || "";
    const e = { id: r.id, kind: "", title: "", content: "", published: true, position: 0, seq };
    if (r.type.startsWith("imsdt_")) {
      const topic = texts[main] ?? "";
      e.kind = "discussion";
      e.title = text(tag(topic, "title"));
      e.content = clean(decode(tag(topic, "text")));
      for (const d of r.deps) {
        const meta = texts[(byId[d] && (byId[d].href || byId[d].files[0])) || ""] ?? "";
        if (!meta.includes("<topicMeta")) continue;
        if (tag(meta, "type") === "announcement") e.kind = "announcement";
        e.position = Number(tag(meta, "position")) || 0;
        if (tag(meta, "workflow_state") !== "" && tag(meta, "workflow_state") !== "active") e.published = false;
      }
    } else if (r.type.startsWith("imsqti_")) {
      const qti = texts[main] ?? "";
      const m = /<assessment\b([^>]*)>/.exec(qti);
      e.kind = "quiz";
      e.title = m ? attr(m[1], "title") : "";
      e.content = `<p>This quiz has ${[...qti.matchAll(/<item\b/g)].length} questions that were not converted. Rebuild it with question elements.</p>`;
    } else if (r.type.startsWith("imswl_")) {
      const wl = texts[main] ?? "";
      const m = /<url\b([^>]*)>/.exec(wl);
      const url = m ? attr(m[1], "href") : "";
      if (!/^https?:\/\//.test(url)) return;
      e.kind = "link";
      e.title = text(tag(wl, "title")) || url;
      e.content = `<p><a href="${url.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")}">${e.title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</a></p>`;
    } else if (r.type.startsWith("imsbasiclti_")) {
      skipped.lti++;
      return;
    } else {
      if (r.files.some((f) => f.startsWith("course_settings/"))) return; // Canvas course settings; the syllabus is read on its own
      const settings = r.files.find((f) => f.endsWith("/assignment_settings.xml"));
      const page = /\.html?$/i.test(main) ? main : r.files.find((f) => /\.html?$/i.test(f));
      if (!page) return; // a media file, a Canvas meta file, or a dependency of another resource
      const html = texts[page] ?? "";
      e.kind = settings ? "assignment" : "page";
      e.title = (settings ? text(tag(texts[settings] ?? "", "title")) : "") || text(tag(html, "title")).replace(/^Assignment: /, "") || page.split("/").pop().replace(/\.html?$/i, "");
      e.content = clean(html);
      if (settings) {
        e.position = Number(tag(texts[settings] ?? "", "position")) || 0;
        const state = tag(texts[settings] ?? "", "workflow_state");
        if (state !== "" && state !== "published") e.published = false;
      } else if (/<meta name="workflow_state" content="unpublished"/.test(html)) e.published = false;
    }
    if (e.title === "") e.title = "Untitled";
    entries.push(e);
  });
  return { entries, skipped };
};

/**
 * Turns the text entries of a cartridge into the import.platform result.
 *
 * @param {object} texts    { path: text } for the manifest and every .xml and .html entry.
 * @param {object} media    { path: base64 } for the media entries.
 * @param {string} name     The uploaded file's name.
 * @param {string[]} include  The kinds to bring over; empty means all.
 * @returns {object}  { title, items, files?, site, stats } or { error }.
 */
export function convert(texts, media, name, include) {
  const manifest = texts["imsmanifest.xml"];
  if (!manifest || !manifest.includes("<manifest")) return { error: "the file is not a Common Cartridge (no imsmanifest.xml)" };
  const want = (k) => include.length === 0 || include.includes(k);
  const canvas = Object.keys(texts).some((k) => k.startsWith("course_settings/"));
  const resources = readResources(manifest);
  const { entries, skipped } = classify(resources, texts);
  const byId = {};
  for (const e of entries) byId[e.id] = e;
  const items = [];
  const slugs = {};
  const counts = {};
  for (const k of KINDS) counts[k] = 0;
  const add = (title, content, parent, published, kind) => {
    let slug = slugify(title) || "page";
    if (slugs[slug]) { let n = 2; while (slugs[`${slug}-${n}`]) n++; slug = `${slug}-${n}`; }
    slugs[slug] = true;
    const item = { id: `item-${items.length + 1}`, title, slug, parent, order: items.length, content };
    if (!published) item.metadata = { published: false };
    items.push(item);
    if (kind) counts[kind]++;
    return item.id;
  };
  const syllabus = clean(texts["course_settings/syllabus.html"] ?? "");
  if (syllabus !== "" && want("syllabus")) add("Syllabus", syllabus, null, true, "syllabus");
  // the outline first: modules become parent pages, their items the pages under them
  const used = {};
  const parents = [];
  for (const n of readOutline(manifest)) {
    const parent = n.depth > 1 ? parents[n.depth - 1] ?? null : null;
    if (n.ref === "") { parents[n.depth] = add(n.title, "", parent, true, ""); continue; }
    const e = byId[n.ref];
    if (!e || used[e.id] || !want(e.kind)) continue;
    used[e.id] = true;
    parents[n.depth] = add(n.title || e.title, e.content, parent, e.published, e.kind);
  }
  // then whatever no module holds: pages at the top, the rest under one parent page per kind, in the course's order
  const rest = entries.filter((e) => !used[e.id] && want(e.kind)).sort((a, b) => a.position - b.position || a.seq - b.seq);
  for (const e of rest) if (e.kind === "page") add(e.title, e.content, null, e.published, e.kind);
  for (const [kind, label] of GROUPS) {
    const group = rest.filter((e) => e.kind === kind);
    if (!group.length) continue;
    const parent = add(label, "", null, true, "");
    for (const e of group) add(e.title, e.content, parent, e.published, e.kind);
  }
  const files = Object.keys(media).filter((p) => !p.startsWith("course_settings/")).sort().map((p) => ({ path: sitePath(p), data: media[p] }));
  const course = text(tag(tag(manifest, "lomimscc:title") || tag(manifest, "lom:title"), "lomimscc:string") || tag(tag(manifest, "lom:title"), "lom:string"));
  const title = String(name || "").replace(/\.(imscc|zip)$/i, "").trim() || course || "Imported course";
  const out = { title, items };
  if (files.length) out.files = files;
  if (course !== "") out.site = { description: course };
  out.stats = { flavor: canvas ? "canvas" : "ims", version: tag(manifest, "schemaversion"), kinds: counts, files: files.length, skipped };
  return out;
}

export default {
  contracts: {
    "import.platform": {
      /**
       * Implements contract import.platform, operation convert (dispatch: chosen).
       *
       * Turns a Common Cartridge (.imscc) into pages: the syllabus, the module outline, then pages, assignments, discussions, announcements, quizzes and links that no module holds, grouped by kind. Media goes to files for core to write.
       *
       * @param {object} ctx    Platform context (spec/13); archive.read unpacks the cartridge.
       * @param {object} input  { files: [{ name, data (base64) }], include?: [kinds] } with one .imscc.
       * @returns {Promise<object>}  { title, items, files?, site?, stats } or { error }.
       */
      async convert(ctx, input) {
        const f = input && Array.isArray(input.files) && input.files.length ? input.files[0] || {} : null;
        if (!f) return { error: "a Common Cartridge (.imscc) file is required" };
        let texts;
        let media;
        try {
          texts = await ctx.archive.read(String(f.data || ""), { match: "(^imsmanifest\\.xml|\\.xml|\\.html?)$" });
          media = await ctx.archive.read(String(f.data || ""), { match: MEDIA, binary: true });
        } catch (e) { return { error: "the file is not a zip archive" }; }
        const include = Array.isArray(input.include) ? input.include.filter((k) => KINDS.includes(k)) : [];
        return convert(texts, media, String(f.name || ""), include);
      },
    },
  },
};
