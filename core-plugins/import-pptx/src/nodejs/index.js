// PowerPoint import (Node). Mirrored in src/php/Plugin.php; both produce the same HTML.
// Slides are read in slide-number order (slide2 before slide10). Speaker notes and images are not carried over yet.
const PARTS = "^(ppt/slides/slide\\d+\\.xml|docProps/core\\.xml)$";
const texts = (xml) => [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => m[1]).join("");

/** Nested lists from paragraphs with levels: [{ text, level }] -> <ul>...</ul>. */
function lists(points) {
  let html = "", depth = -1;
  for (const { text, level } of points) {
    if (level > depth) { html += "<ul>".repeat(level - depth); depth = level; }
    else { html += "</li>"; while (depth > level) { html += "</ul></li>"; depth--; } }
    html += `<li>${text}`;
  }
  if (depth >= 0) { html += "</li>"; while (depth > 0) { html += "</ul></li>"; depth--; } html += "</ul>"; }
  return html;
}

export function slidesToHtml(parts) {
  const slides = Object.keys(parts).filter((k) => k.startsWith("ppt/slides/")).sort((a, b) => Number(/(\d+)\.xml$/.exec(a)[1]) - Number(/(\d+)\.xml$/.exec(b)[1]));
  if (!slides.length) return { error: "this .pptx has no slides" };
  const out = [];
  slides.forEach((name, i) => {
    let title = "";
    const points = [];
    for (const sp of parts[name].matchAll(/<p:sp\b[^>]*>([\s\S]*?)<\/p:sp>/g)) {
      const isTitle = /<p:ph\b[^>]*type="(title|ctrTitle)"/.test(sp[1]);
      for (const p of sp[1].matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)) {
        const text = texts(p[1]).trim();
        if (!text) continue;
        if (isTitle) title = title ? `${title} ${text}` : text;
        else points.push({ text, level: Number((/<a:pPr\b[^>]*lvl="(\d)"/.exec(p[1]) || [null, 0])[1]) });
      }
    }
    out.push(`<h2>${title || `Slide ${i + 1}`}</h2>${lists(points)}`);
  });
  const title = (/<dc:title>([\s\S]*?)<\/dc:title>/.exec(parts["docProps/core.xml"] || "") || [null, ""])[1].trim();
  return { html: out.join(""), ...(title ? { title } : {}) };
}

export default {
  contracts: {
    "import.file": {
      /**
       * Implements contract import.file, operation convert (dispatch: accepts .pptx).
       *
       * Each slide becomes an h2 section: the title placeholder as the heading, other text as nested lists by indent
       * level. Core turns the sections into pages (one per slide with the site method).
       *
       * @param {object} ctx    Platform context (spec/13); uses ctx.archive.read.
       * @param {object} input  { name, data (base64), method, type, parentId }.
       * @returns {Promise<object>}  { html, title? } or { error }.
       */
      async convert(ctx, input) {
        let parts;
        try { parts = await ctx.archive.read(input.data, { match: PARTS }); } catch (e) { return { error: `not a .pptx file (${e.message})` }; }
        return slidesToHtml(parts);
      },
    },
  },
};
