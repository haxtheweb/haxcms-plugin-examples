#!/usr/bin/env node
// Browser checks for the front-end half of a plugin (frontend/dist): the same
// kinds of gates the webcomponents repo runs on its elements, applied to the
// blocks, themes and Merlin programs a plugin ships.
//
// For every element a plugin registers (registries/elements/*.yaml and
// registries/themes/*.json with a path inside the plugin), rendered from the
// first entry of its haxProperties demoSchema when there is one:
//
//   load       the module loads with no uncaught error or console error, and
//              customElements has the tag
//   axe        no axe-core violations in the WCAG 2.0/2.1 A and AA rule sets
//              (includes color-contrast), in light AND in dark color scheme
//   aria refs  every id reference (aria-describedby, aria-labelledby,
//              aria-controls, aria-owns, aria-activedescendant,
//              aria-errormessage, aria-details, label for) resolves inside the
//              same root: an id cannot be referenced across a shadow boundary,
//              and axe does not look inside shadow roots for this
//   dark       an element that sets colors of its own changes them under
//              prefers-color-scheme: dark (or is a theme that declares a single
//              colorSchemes entry); same rule as webcomponents dark-motion-check
//   motion     with prefers-reduced-motion: reduce, no animation or transition
//              longer than 10 ms runs on it or inside its shadow root after load,
//              hover and focus
//
// Every other module under frontend/dist (Merlin programs, helpers) must import
// without an uncaught error. Elements that point at a package (for example
// @haxtheweb/micro-game-base/...) are skipped: their own repository tests them.
//
// Usage:
//   node harness/check/frontend.mjs [--json] <plugin folder> [...]
// Chrome: CHROME_PATH, else /usr/bin/google-chrome or chromium. Every request
// outside the local server is aborted, so nothing reaches the network.
import { createServer } from "node:http";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, extname, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { parse } from "yaml";

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const asJson = args.includes("--json");
const targets = args.filter((a) => !a.startsWith("--")).map((p) => resolve(p));
if (!targets.length) {
  console.error("usage: frontend.mjs [--json] <plugin folder> [...]");
  process.exit(2);
}

const MIME = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".css": "text/css", ".html": "text/html", ".png": "image/png" };
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const pages = new Map();

const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (pages.has(url.pathname)) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(pages.get(url.pathname));
  }
  const file = resolve(root, "." + decodeURIComponent(url.pathname));
  if ((file !== root && !file.startsWith(root + sep)) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream" });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;

const puppeteer = (await import("puppeteer-core")).default;
const executablePath = process.env.CHROME_PATH || ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((p) => existsSync(p));
if (!executablePath) {
  console.error("no Chrome found; set CHROME_PATH");
  process.exit(2);
}
const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-gpu", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-first-run", "--disable-default-apps"] });
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const results = [];
try {
  for (const dir of targets) results.push(await checkPlugin(dir));
} finally {
  await browser.close();
  server.close();
}

if (asJson) console.log(JSON.stringify(results, null, 2));
else {
  for (const r of results) {
    if (!r.checked.length && !r.errors.length) {
      console.log(`skip ${r.plugin}: no front-end code`);
      continue;
    }
    console.log(`${r.errors.length ? "FAIL" : "ok  "} ${r.plugin}: ${r.checked.join(", ")}`);
    for (const n of r.notes) console.log(`       ${n}`);
    for (const e of r.errors) console.log(`     ! ${e}`);
  }
}
process.exit(results.some((r) => r.errors.length) ? 1 : 0);

async function checkPlugin(dir) {
  const plugin = relative(process.cwd(), dir) || dir;
  const out = { plugin, checked: [], errors: [], notes: [] };
  const elements = [];
  const elDir = join(dir, "registries", "elements");
  if (existsSync(elDir)) {
    for (const f of readdirSync(elDir).filter((n) => /\.ya?ml$/.test(n)).sort()) {
      const e = parse(readFileSync(join(elDir, f), "utf8")) || {};
      elements.push({ tag: e.tag, path: e.path, haxProperties: e.haxProperties, theme: false });
    }
  }
  const themeDir = join(dir, "registries", "themes");
  if (existsSync(themeDir)) {
    for (const f of readdirSync(themeDir).filter((n) => n.endsWith(".json")).sort()) {
      const t = JSON.parse(readFileSync(join(themeDir, f), "utf8"));
      elements.push({ tag: t.element, path: t.path, theme: true, colorSchemes: t.colorSchemes });
    }
  }
  const covered = new Set();
  for (const el of elements) {
    if (!el.tag || !el.path) continue;
    if (!el.path.startsWith("frontend/")) {
      out.notes.push(`${el.tag}: from ${el.path.split("/").slice(0, 2).join("/")}, tested in its own repository`);
      continue;
    }
    covered.add(join(dir, el.path));
    out.checked.push(el.tag);
    const errs = await checkElement(dir, el);
    out.errors.push(...errs.map((e) => `${el.tag}: ${e}`));
  }
  // every other module must at least import cleanly
  const dist = join(dir, "frontend", "dist");
  if (existsSync(dist)) {
    for (const f of readdirSync(dist).filter((n) => /\.m?js$/.test(n)).sort()) {
      const file = join(dist, f);
      if (covered.has(file)) continue;
      out.checked.push(f);
      const errs = await importOnly(file);
      out.errors.push(...errs.map((e) => `${f}: ${e}`));
    }
  }
  return out;
}

function urlOf(file) {
  return "/" + relative(root, file).split(sep).map(encodeURIComponent).join("/");
}

function demoMarkup(dir, el) {
  let demo = null;
  if (el.haxProperties && !el.haxProperties.startsWith("@")) {
    const hp = join(dir, el.haxProperties);
    if (existsSync(hp)) {
      const json = JSON.parse(readFileSync(hp, "utf8"));
      demo = Array.isArray(json.demoSchema) ? json.demoSchema.find((d) => d && d.tag === el.tag) || null : null;
    }
  }
  const attrs = Object.entries((demo && demo.properties) || {})
    .map(([k, v]) => {
      const name = k.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
      const value = typeof v === "string" ? v : JSON.stringify(v);
      return ` ${name}="${String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`;
    })
    .join("");
  return `<${el.tag}${attrs}>${(demo && demo.content) || ""}</${el.tag}>`;
}

function pageHtml(moduleUrl, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>plugin check</title>
<style>:root{color-scheme:light dark}body{font-family:system-ui,sans-serif;margin:16px}</style></head>
<body><main><h1>Plugin check</h1>${body}</main><script type="module" src="${moduleUrl}"></script></body></html>`;
}

async function openPage(html, { scheme = "light" } = {}) {
  const path = `/__plugin-check__/${pages.size}.html`;
  pages.set(path, html);
  const page = await browser.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`uncaught error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource/.test(m.text())) problems.push(`console error: ${m.text()}`);
  });
  await page.setRequestInterception(true);
  page.on("request", (r) => (r.url().startsWith(origin) ? r.continue() : r.abort()));
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: scheme },
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  await page.goto(origin + path, { waitUntil: "load" });
  await new Promise((r) => setTimeout(r, 150));
  return { page, problems };
}

async function importOnly(file) {
  const { page, problems } = await openPage(pageHtml(urlOf(file), ""));
  await page.close();
  return problems;
}

async function checkElement(dir, el) {
  const errors = [];
  const html = pageHtml(urlOf(join(dir, el.path)), demoMarkup(dir, el));
  const snapshots = {};
  for (const scheme of ["light", "dark"]) {
    const { page, problems } = await openPage(html, { scheme });
    try {
      errors.push(...problems.map((p) => `[${scheme}] ${p}`));
      const defined = await page.evaluate((tag) => !!customElements.get(tag), el.tag);
      if (!defined) {
        errors.push(`[${scheme}] customElements has no ${el.tag} after loading ${el.path}`);
        continue;
      }
      // axe, scoped to the element
      await page.evaluate(axeSource);
      const violations = await page.evaluate(
        async (tag, tags) => {
          const node = document.querySelector(tag);
          if (!node) return [{ id: "missing", help: `no <${tag}> in the page` }];
          const r = await globalThis.axe.run(node, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
          return r.violations.map((v) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));
        },
        el.tag,
        AXE_TAGS,
      );
      for (const v of violations) errors.push(`[${scheme}] axe ${v.id}: ${v.help}${v.nodes ? ` (${v.nodes} node${v.nodes > 1 ? "s" : ""})` : ""}`);
      if (scheme === "light") for (const b of await page.evaluate(brokenIdRefs, el.tag)) errors.push(`aria refs: ${b}`);
      snapshots[scheme] = await page.evaluate(colorSnapshot, el.tag);
      if (scheme === "light") {
        const running = await page.evaluate(motionAfterInteraction, el.tag);
        for (const m of running) errors.push(`[reduced motion] ${m}`);
      }
    } finally {
      await page.close();
    }
  }
  // dark mode: an element that sets colors of its own must change them in dark
  const light = snapshots.light;
  const dark = snapshots.dark;
  if (light && dark && light.ownColors && light.key === dark.key) {
    const singleScheme = el.theme && Array.isArray(el.colorSchemes) && el.colorSchemes.length === 1;
    if (!singleScheme) errors.push("ignores dark mode: it sets its own colors and they are identical under prefers-color-scheme: dark");
  }
  return errors;
}

// id references in the element's light and shadow tree that do not resolve in their own root
function brokenIdRefs(tag) {
  const host = document.querySelector(tag);
  if (!host) return [];
  const attrs = ["aria-describedby", "aria-labelledby", "aria-controls", "aria-owns", "aria-activedescendant", "aria-errormessage", "aria-details", "for"];
  const out = [];
  const walk = (n, where) => {
    if (n.nodeType !== 1) return;
    const root = n.getRootNode();
    for (const a of attrs) {
      if (a === "for" && n.localName !== "label") continue;
      const v = n.getAttribute(a);
      if (!v) continue;
      for (const id of v.trim().split(/\s+/)) {
        if (!root.getElementById(id)) out.push(`${where}<${n.localName}> ${a}="${id}" points at no element in its own ${root === document ? "document" : "shadow root"}`);
      }
    }
    if (n.shadowRoot) for (const c of n.shadowRoot.children) walk(c, `${where}${n.localName} >> `);
    for (const c of n.children) walk(c, where);
  };
  walk(host, "");
  return out;
}

// the colors the element sets itself, in its light and shadow tree: a text color
// that differs from what it inherits, or a background that is not transparent.
// Inherited colors are left out (they follow the page into dark mode on their own).
function colorSnapshot(tag) {
  const host = document.querySelector(tag);
  if (!host) return null;
  const parts = [];
  const walk = (n, parentColor, path) => {
    if (n.nodeType !== 1) return;
    const s = getComputedStyle(n);
    const bg = s.backgroundColor;
    const here = `${path}>${n.localName}`;
    if (s.color !== parentColor) parts.push(`${here} color ${s.color}`);
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") parts.push(`${here} background ${bg}`);
    let i = 0;
    if (n.shadowRoot) for (const c of n.shadowRoot.children) walk(c, s.color, `${here}#shadow:${i++}`);
    i = 0;
    for (const c of n.children) walk(c, s.color, `${here}:${i++}`);
  };
  walk(host, getComputedStyle(host.parentElement || document.body).color, "");
  return { ownColors: parts.length > 0, key: parts.join(";") };
}

// animations still running after load, hover and focus with reduced motion on
async function motionAfterInteraction(tag) {
  const host = document.querySelector(tag);
  if (!host) return [];
  const targets = [host];
  const focusable = host.querySelector("a,button,input,select,textarea,[tabindex]") || (host.shadowRoot && host.shadowRoot.querySelector("a,button,input,select,textarea,[tabindex]"));
  if (focusable) targets.push(focusable);
  for (const t of targets) {
    t.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, composed: true }));
    t.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
    if (typeof t.focus === "function") t.focus();
  }
  await new Promise((r) => setTimeout(r, 120));
  const anims = new Set(host.getAnimations({ subtree: true }));
  if (host.shadowRoot) for (const a of host.shadowRoot.getAnimations()) anims.add(a);
  const out = [];
  for (const a of anims) {
    const t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : {};
    const duration = typeof t.duration === "number" ? t.duration : 0;
    if (a.playState === "running" && (duration > 10 || t.iterations === Infinity)) {
      const kind = a.constructor && a.constructor.name === "CSSTransition" ? "transition" : a.constructor && a.constructor.name === "CSSAnimation" ? "animation" : "script animation";
      out.push(`${kind} ${a.animationName || a.transitionProperty || a.id || ""} still runs (${Math.round(duration)} ms${t.iterations === Infinity ? ", infinite" : ""})`.replace(/\s+\(/, " ("));
    }
  }
  return out;
}
