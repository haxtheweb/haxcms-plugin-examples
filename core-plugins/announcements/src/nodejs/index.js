// Announcements plugin (Node entry). The platform loads this module once and calls:
//   operations[operationId](ctx, request)  for each route in config/openapi.yaml
//   hooks[hookName](ctx)                   for each subscription in plugin.yaml
// ctx (provided by the loader, spec/06): ctx.storage.read(storeId) parses a store from config/datastores.yaml,
// ctx.package.read(path) reads a file under this plugin's data/ folder, ctx.haxcms.version is the running version,
// ctx.log writes to the unified log. Security (bearerAuth + userTokenHeader) is enforced by the platform from the
// OpenAPI contract before a handler runs, so handlers never see an unauthenticated request.
import * as A from "./announcements.js";

let cache = null; // the data is read-only (package store), so load it once per process

async function data(ctx) {
  if (!cache) cache = { entries: await ctx.storage.read("announcements"), types: await ctx.storage.read("types") };
  return cache;
}

// Locale overlays live in data/locales/<lang>.json; English is the source text. Only plain language tags are accepted.
async function overlay(ctx, lang) {
  if (!lang || lang === "en" || !/^[a-z]{2}(-[A-Z]{2})?$/.test(lang)) return {};
  try {
    return JSON.parse(await ctx.package.read(`data/locales/${lang}.json`));
  } catch {
    return {}; // no translation yet: fall back to English
  }
}

const ok = (body) => ({ status: 200, body });
const notFound = () => ({ status: 404, body: { error: "not found" } });

export const operations = {
  async announcementsListLatest(ctx, req) {
    return ok(A.latest(await data(ctx), ctx.haxcms.version, await overlay(ctx, req.query.lang)));
  },
  async announcementsListAll(ctx, req) {
    return ok(A.list(await data(ctx), ctx.haxcms.version, req.query, await overlay(ctx, req.query.lang)));
  },
  async announcementsListTips(ctx, req) {
    return ok(A.list(await data(ctx), ctx.haxcms.version, { ...req.query, "filter[kind]": "tip" }, await overlay(ctx, req.query.lang)));
  },
  async announcementsGetDailyTip(ctx, req) {
    const exclude = req.query.exclude ? String(req.query.exclude).split(",") : [];
    const tip = A.dailyTip(await data(ctx), ctx.haxcms.version, new Date(), { exclude, seed: req.query.seed || "" }, await overlay(ctx, req.query.lang));
    return tip ? ok(tip) : notFound();
  },
  async announcementsGet(ctx, req) {
    const e = A.getEntry(await data(ctx), ctx.haxcms.version, req.params.uuid, await overlay(ctx, req.query.lang));
    return e ? ok(e) : notFound();
  },
  async announcementsGetVisual(ctx, req) {
    const file = A.visualFile(await data(ctx), ctx.haxcms.version, req.params.uuid);
    if (!file || !/^[A-Za-z0-9._-]+$/.test(file)) return notFound();
    const type = file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".png") ? "image/png" : "image/jpeg";
    return { status: 200, headers: { "content-type": type, "cache-control": "private, max-age=3600" }, body: await ctx.package.read(`data/visuals/${file}`, { binary: true }) };
  },
  async announcementsListTypes(ctx, req) {
    return ok({ items: Object.values(A.typesMap((await data(ctx)).types, await overlay(ctx, req.query.lang))) });
  },
  async announcementsGetType(ctx, req) {
    const t = A.typesMap((await data(ctx)).types, await overlay(ctx, req.query.lang))[req.params.uuid];
    return t ? ok(t) : notFound();
  },
};

export const hooks = {
  // Refuse to enable if the shipped data is broken, so a bad release never shows a half-empty dialog.
  "plugin.before.enable": async (ctx) => {
    cache = null;
    const d = await data(ctx);
    const typeIds = new Set(d.types.map((t) => t.uuid));
    const orphan = d.entries.find((e) => !typeIds.has(e.type));
    if (orphan) return ctx.veto(`announcement ${orphan.slug} points at an unknown type`);
  },
  // A new plugin version ships new entries: drop the cache so they are read on the next request.
  "plugin.after.upgrade": async (ctx) => {
    cache = null;
    ctx.log.info(`announcements upgraded from ${ctx.previous} to ${ctx.subject.version}`);
  },
};

export default { operations, hooks };
