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
  /**
   * Implements operation announcementsListLatest.
   *
   * Returns the update entries of the newest version the running HAXcms serves, with latestVersion and the types
   * map, translated when a locale overlay exists.
   *
   * @param {object} ctx  Platform context (spec/13); ctx.haxcms.version limits what is served.
   * @param {object} req  req.query.lang picks a locale overlay (English when missing).
   * @returns {Promise<object>}  { status: 200, body } with the latest entries.
   */
  async announcementsListLatest(ctx, req) {
    return ok(A.latest(await data(ctx), ctx.haxcms.version, await overlay(ctx, req.query.lang)));
  },
  /**
   * Implements operation announcementsListAll.
   *
   * Returns every served entry (no drafts, nothing newer than the running version), filtered and paged by the query;
   * the CLI uses filter[sinceVersion].
   *
   * @param {object} ctx  Platform context (spec/13); ctx.haxcms.version limits what is served.
   * @param {object} req  req.query: filter[...], page.limit, page.offset and lang.
   * @returns {Promise<object>}  { status: 200, body } with the matching entries.
   */
  async announcementsListAll(ctx, req) {
    return ok(A.list(await data(ctx), ctx.haxcms.version, req.query, await overlay(ctx, req.query.lang)));
  },
  /**
   * Implements operation announcementsListTips.
   *
   * Returns tips only: the same listing as announcementsListAll with filter[kind] fixed to tip.
   *
   * @param {object} ctx  Platform context (spec/13); ctx.haxcms.version limits what is served.
   * @param {object} req  req.query: filter[...], page.limit, page.offset and lang.
   * @returns {Promise<object>}  { status: 200, body } with the matching tips.
   */
  async announcementsListTips(ctx, req) {
    return ok(A.list(await data(ctx), ctx.haxcms.version, { ...req.query, "filter[kind]": "tip" }, await overlay(ctx, req.query.lang)));
  },
  /**
   * Implements operation announcementsGetDailyTip.
   *
   * Returns the tip of the day, the same for every caller on a UTC date, skipping the uuids in exclude.
   *
   * @param {object} ctx  Platform context (spec/13); ctx.haxcms.version limits what is served.
   * @param {object} req  req.query: exclude (comma-separated uuids), seed and lang.
   * @returns {Promise<object>}  { status: 200, body: tip }, or 404 when no tip is left.
   */
  async announcementsGetDailyTip(ctx, req) {
    const exclude = req.query.exclude ? String(req.query.exclude).split(",") : [];
    const tip = A.dailyTip(await data(ctx), ctx.haxcms.version, new Date(ctx.now()), { exclude, seed: req.query.seed || "" }, await overlay(ctx, req.query.lang));
    return tip ? ok(tip) : notFound();
  },
  /**
   * Implements operation announcementsGet.
   *
   * Returns one entry of either kind by uuid; drafts and entries for unreleased versions are 404.
   *
   * @param {object} ctx  Platform context (spec/13); ctx.haxcms.version limits what is served.
   * @param {object} req  req.params.uuid; req.query.lang.
   * @returns {Promise<object>}  { status: 200, body: entry } or 404.
   */
  async announcementsGet(ctx, req) {
    const e = A.getEntry(await data(ctx), ctx.haxcms.version, req.params.uuid, await overlay(ctx, req.query.lang));
    return e ? ok(e) : notFound();
  },
  /**
   * Implements operation announcementsGetVisual.
   *
   * Returns the image bytes of an entry's screenshot visual from data/visuals, cached privately for an hour.
   * Only plain file names are served.
   *
   * @param {object} ctx  Platform context (spec/13); ctx.haxcms.version limits what is served.
   * @param {object} req  req.params.uuid.
   * @returns {Promise<object>}  { status: 200, headers, body: bytes } or 404.
   */
  async announcementsGetVisual(ctx, req) {
    const file = A.visualFile(await data(ctx), ctx.haxcms.version, req.params.uuid);
    if (!file || !/^[A-Za-z0-9._-]+$/.test(file)) return notFound();
    const type = file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".png") ? "image/png" : "image/jpeg";
    return { status: 200, headers: { "content-type": type, "cache-control": "private, max-age=3600" }, body: await ctx.package.read(`data/visuals/${file}`, { binary: true }) };
  },
  /**
   * Implements operation announcementsListTypes.
   *
   * Returns the six announcement types, translated when a locale overlay exists.
   *
   * @param {object} ctx  Platform context (spec/13); ctx.haxcms.version limits what is served.
   * @param {object} req  req.query.lang.
   * @returns {Promise<object>}  { status: 200, body: { items } }.
   */
  async announcementsListTypes(ctx, req) {
    return ok({ items: Object.values(A.typesMap((await data(ctx)).types, await overlay(ctx, req.query.lang))) });
  },
  /**
   * Implements operation announcementsGetType.
   *
   * Returns one announcement type by uuid.
   *
   * @param {object} ctx  Platform context (spec/13); ctx.haxcms.version limits what is served.
   * @param {object} req  req.params.uuid; req.query.lang.
   * @returns {Promise<object>}  { status: 200, body: type } or 404.
   */
  async announcementsGetType(ctx, req) {
    const t = A.typesMap((await data(ctx)).types, await overlay(ctx, req.query.lang))[req.params.uuid];
    return t ? ok(t) : notFound();
  },
};

export const hooks = {
  /**
   * Implements hook plugin.before.enable.
   *
   * Refuses to enable when an entry points at a type that does not exist, so a bad release never shows a half-empty
   * dialog. It drops the cache first so the check reads the shipped data.
   *
   * @param {object} ctx  ctx.subject: { id, version, scope, siteId } of this plugin.
   * @returns {Promise<void>}  nothing, or a veto naming the broken entry.
   */
  "plugin.before.enable": async (ctx) => {
    cache = null;
    const d = await data(ctx);
    const typeIds = new Set(d.types.map((t) => t.uuid));
    const orphan = d.entries.find((e) => !typeIds.has(e.type));
    if (orphan) return ctx.veto(`announcement ${orphan.slug} points at an unknown type`);
  },
  /**
   * Implements hook plugin.after.upgrade.
   *
   * Drops the cached data so entries shipped with the new version are read on the next request, and logs the upgrade.
   *
   * @param {object} ctx  ctx.subject: { id, version, scope, siteId } of this plugin; ctx.previous: the version upgraded from.
   * @returns {Promise<void>}  nothing.
   */
  "plugin.after.upgrade": async (ctx) => {
    cache = null;
    ctx.log.info(`announcements upgraded from ${ctx.previous} to ${ctx.subject.version}`);
  },
};

export default { operations, hooks };
