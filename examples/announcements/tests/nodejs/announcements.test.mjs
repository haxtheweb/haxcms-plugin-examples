// Node unit tests for the announcements logic (node --test). The same behavior is checked in PHP through the parity run.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as A from "../../src/nodejs/announcements.js";
import plugin from "../../src/nodejs/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (p) => readFileSync(join(root, p), "utf8");
const data = { entries: JSON.parse(read("data/announcements.json")), types: JSON.parse(read("data/types.json")) };
const RUN = "26.10.1";

// a minimal stand-in for the loader's ctx
function ctx(version = RUN) {
  return {
    haxcms: { version },
    storage: { read: async (id) => (id === "types" ? data.types : data.entries) },
    package: { read: async (p) => read(p) },
    veto: (m) => ({ veto: true, message: m }),
    log: { info() {} },
  };
}

test("versions compare numerically, not as strings", () => {
  assert.equal(A.compareVersions("26.10.1", "26.9.12"), 1);
  assert.equal(A.compareVersions("26.10", "26.10.0"), 0);
  assert.equal(A.compareVersions("26.1.1", "26.1.2"), -1);
});

test("drafts and future versions are never served", () => {
  const slugs = A.servable(data.entries, RUN).map((e) => e.slug);
  assert.ok(!slugs.includes("draft-template"));
  assert.ok(!slugs.includes("unreleased-theme"));
});

test("latestVersion ignores entries newer than the running version", () => {
  assert.equal(A.latestVersion(data.entries, RUN), "26.10.1");
  assert.equal(A.latestVersion(data.entries, "26.9.5"), "26.9.1");
  assert.equal(A.latestVersion(data.entries, "26.1.1"), null);
});

test("latest returns only that version's updates, without source-only fields", () => {
  const r = A.latest(data, RUN);
  assert.deepEqual(r.items.map((e) => e.slug).sort(), ["explosion-block", "faster-saves"]);
  for (const e of r.items) { assert.equal(e.status, undefined); assert.equal(e.notes, undefined); }
});

test("filters: kind, type by key, sinceVersion, paging", () => {
  assert.ok(A.list(data, RUN, { "filter[kind]": "tip" }).items.every((e) => e.kind === "tip"));
  assert.ok(A.list(data, RUN, { "filter[type]": "block" }).items.every((e) => e.type === "5b0e06db-a31a-4d78-844e-43ec30a66d16"));
  assert.deepEqual(A.list(data, RUN, { "filter[sinceVersion]": "26.9.1" }).items.map((e) => e.version), ["26.10.1", "26.10.1"]);
  const page = A.list(data, RUN, { "page.limit": "2", "page.offset": "1" });
  assert.equal(page.items.length, 2);
  assert.equal(page.total, 6);
});

test("the daily tip is the same all day and respects exclude", () => {
  const a = A.dailyTip(data, RUN, new Date("2026-10-24T00:00:01Z"));
  const b = A.dailyTip(data, RUN, new Date("2026-10-24T23:59:59Z"));
  assert.equal(a.uuid, b.uuid);
  const c = A.dailyTip(data, RUN, new Date("2026-10-24T12:00:00Z"), { exclude: [a.uuid] });
  assert.notEqual(c.uuid, a.uuid);
});

test("screenshot visuals expose a route, not the file name", () => {
  const e = A.getEntry(data, RUN, "b3235057-f7ed-4133-9623-88ffd1e3e03b");
  assert.equal(e.visual.file, undefined);
  assert.equal(e.visual.url, "b3235057-f7ed-4133-9623-88ffd1e3e03b/visual");
  assert.ok(e.visual.alt);
});

test("locale overlays translate and fall back to English", async () => {
  const r = await plugin.operations.announcementsListLatest(ctx(), { query: { lang: "es" } });
  assert.equal(r.status, 200);
  const tip = await plugin.operations.announcementsGet(ctx(), { params: { uuid: "cd32a5c1-fd1c-4121-b44c-820281410449" }, query: { lang: "es" } });
  assert.match(tip.body.label, /Merlin/);
  assert.notEqual(tip.body.label, data.entries.find((e) => e.slug === "merlin-everywhere").label);
  const fallback = await plugin.operations.announcementsGet(ctx(), { params: { uuid: "2a9dcbc6-3a0f-4dd5-b473-c53e8ce189f6" }, query: { lang: "es" } });
  assert.equal(fallback.body.label, "Drag blocks to reorder them");
  const bad = await plugin.operations.announcementsGet(ctx(), { params: { uuid: "2a9dcbc6-3a0f-4dd5-b473-c53e8ce189f6" }, query: { lang: "../../etc" } });
  assert.equal(bad.status, 200);
});

test("operations: 404 for unknown or unreleased ids, visual bytes for screenshots", async () => {
  assert.equal((await plugin.operations.announcementsGet(ctx(), { params: { uuid: "fc2c81aa-8ca1-47af-974a-eb9cf9fe2e28" }, query: {} })).status, 404);
  const v = await plugin.operations.announcementsGetVisual(ctx(), { params: { uuid: "b3235057-f7ed-4133-9623-88ffd1e3e03b" }, query: {} });
  assert.equal(v.status, 200);
  assert.equal(v.headers["content-type"], "image/svg+xml");
  assert.equal((await plugin.operations.announcementsGetVisual(ctx(), { params: { uuid: "40b0fb67-2ba8-4c81-ab62-0a198ecb7563" }, query: {} })).status, 404);
});

test("enable is vetoed when an entry points at an unknown type", async () => {
  const broken = ctx();
  broken.storage.read = async (id) => (id === "types" ? [] : data.entries);
  const r = await plugin.hooks["plugin.before.enable"](broken);
  assert.equal(r.veto, true);
  assert.equal(await plugin.hooks["plugin.before.enable"](ctx()), undefined);
});
