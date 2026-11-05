// Answer guard (Node). Mirrored in src/php/Plugin.php.
// Question blocks such as <multiple-choice> keep their answers in light-DOM inputs (`data-correct`, legacy bare
// `correct`, plus per-choice feedback). This plugin indexes those answers into a server-only store when a page is
// saved, removes them from what learners receive, and grades choices on the server.
import { createHash } from "node:crypto";

export const NS = "answer-guard";
const EDITORS = ["admin", "editor"];
// a site whose license is one of these is treated as OER (open), so `auto` leaves its questions alone
const OPEN_LICENSE = /^(cc0|cc[- ]?by|by(-|$)|public[- ]?domain|pd$)/i;
const TAG = /^[a-z][a-z0-9]*(-[a-z0-9]+)+$/;
const VALUE = `(?:"[^"]*"|'[^']*'|[^\\s"'>]+)`;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const decode = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const isEditor = (user) => !!user && (user.roles || []).some((r) => EDITORS.includes(r));
const asMap = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const asList = (v) => (Array.isArray(v) ? v : []);

/** An attribute's decoded value from a tag's attribute text, or null when it is missing. */
export const attr = (attrs, name) => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, "i").exec(attrs);
  return m ? decode(m[1] ?? m[2] ?? m[3]) : null;
};
// data-correct is canonical (anything but "false" is correct); a bare legacy `correct` still counts (#3113)
const inputCorrect = (attrs) => {
  const dc = attr(attrs, "data-correct");
  if (dc !== null) return dc.toLowerCase() !== "false";
  return /(?:^|\s)correct(?=[\s=/>]|$)/i.test(attrs);
};
// an input tag with every attribute that gives an answer or its feedback away removed
const stripInput = (tag) => tag
  .replace(new RegExp(`\\s+data-correct(?:\\s*=\\s*${VALUE})?`, "gi"), "")
  .replace(new RegExp(`\\s+data-(?:un)?selected(?:\\s*=\\s*${VALUE})?`, "gi"), "")
  .replace(new RegExp(`\\s+correct(?:\\s*=\\s*${VALUE})?(?=[\\s/>])`, "gi"), "");

export const tagsFrom = (settings) => String(settings.elements || "multiple-choice").split(",").map((t) => t.trim().toLowerCase()).filter((t) => TAG.test(t));

/**
 * Finds the guarded question blocks in page HTML. Returns { content, keys }: keys maps each question key to
 * { tag, choices: [{ label, correct, selected?, unselected? }] }; content has the answers removed and each block
 * marked with data-answer-guard-key when strip is true. The key is the block's id, then its resource attribute, then a
 * fingerprint of its tag, text and choice labels; repeats on one page get -2, -3.
 */
export const scan = (html, tags, strip) => {
  const keys = {};
  if (!tags.length) return { content: String(html || ""), keys };
  const re = new RegExp(`<(${tags.join("|")})\\b([^>]*)>([\\s\\S]*?)<\\/\\1\\s*>`, "gi");
  const content = String(html || "").replace(re, (whole, tag, attrs, inner) => {
    const inputs = [...inner.matchAll(/<input\b([^>]*)>/gi)];
    if (!inputs.length) return whole;
    const choices = inputs.map((m) => {
      const c = { label: norm(attr(m[1], "value") ?? ""), correct: inputCorrect(m[1]) };
      const sel = attr(m[1], "data-selected");
      const unsel = attr(m[1], "data-unselected");
      if (sel !== null) c.selected = sel;
      if (unsel !== null) c.unselected = unsel;
      return c;
    });
    const text = norm(decode(inner.replace(/<input\b[^>]*>/gi, " ").replace(/<[^>]*>/g, " ")));
    const authored = attr(attrs, "id") || attr(attrs, "resource");
    let key = authored ? authored.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 200) : "";
    if (!key) key = `fp-${createHash("sha256").update(`${tag.toLowerCase()}\n${text}\n${choices.map((c) => c.label).join("\n")}`).digest("hex").slice(0, 16)}`;
    for (let n = 2, base = key; keys[key]; n++) key = `${base}-${n}`;
    keys[key] = { tag: tag.toLowerCase(), choices };
    if (!strip) return whole;
    const cleaned = inner.replace(/<input\b[^>]*>/gi, (t) => stripInput(t));
    return `<${tag}${attrs} data-answer-guard-key="${esc(key)}">${cleaned}</${tag}>`;
  });
  return { content, keys };
};

/** Whether questions on this site are guarded: the protect setting, and for auto, a site without an open license. */
const isProtected = async (ctx) => {
  const mode = ctx.settings.protect || "auto";
  if (mode === "never") return false;
  if (mode === "always") return true;
  const site = (await ctx.entities.get("site")) || {};
  const license = String(site.license || "");
  return !(license && OPEN_LICENSE.test(license));
};

const indexPage = async (ctx, page) => {
  const all = asMap(await ctx.storage.read("keys"));
  const { keys } = scan(page.content, tagsFrom(ctx.settings), false);
  if (Object.keys(keys).length) all[page.id] = keys;
  else delete all[page.id];
  await ctx.storage.write("keys", all);
  return Object.keys(keys).length;
};

const redact = (ctx, record) => (record && typeof record.content === "string" ? { ...record, content: scan(record.content, tagsFrom(ctx.settings), true).content } : record);

export default {
  hooks: {
    /**
     * Implements hook page.after.save.
     *
     * Indexes the answer keys of the guarded questions on the saved page into the server-only keys store, whatever the
     * protect setting, so turning protection on later needs no re-save.
     *
     * @param {object} ctx  ctx.subject: the page as written.
     * @returns {Promise<void>}
     */
    "page.after.save": async (ctx) => { await indexPage(ctx, ctx.subject); },
    /**
     * Implements hook page.after.delete.
     *
     * Drops the deleted page's answer keys. Learners' attempts and flags stay until core erases them with the user.
     *
     * @param {object} ctx  ctx.subject: the deleted page.
     * @returns {Promise<void>}
     */
    "page.after.delete": async (ctx) => {
      const all = asMap(await ctx.storage.read("keys"));
      if (!all[ctx.subject.id]) return;
      delete all[ctx.subject.id];
      await ctx.storage.write("keys", all);
    },
    /**
     * Implements hook plugin.after.enable.
     *
     * When this plugin is the one enabled, indexes every existing page, so questions written before it was enabled are
     * guarded straight away.
     *
     * @param {object} ctx  ctx.subject: the plugin that was enabled.
     * @returns {Promise<void>}
     */
    "plugin.after.enable": async (ctx) => {
      if (!ctx.subject || ctx.subject.id !== NS) return;
      const tags = tagsFrom(ctx.settings);
      const all = {};
      for (const page of await ctx.entities.list("page")) {
        const { keys } = scan(page.content, tags, false);
        if (Object.keys(keys).length) all[page.id] = keys;
      }
      await ctx.storage.write("keys", all);
      ctx.log.info(`indexed guarded questions on ${Object.keys(all).length} pages`);
    },
    /**
     * Implements hook entity.after.read.
     *
     * Removes answers from page content a learner loads through the API on a protected site. Editors and admins get
     * the page unchanged, because the editor needs the answers to edit the question.
     *
     * @param {object} ctx  ctx.subject: the page, or { items, total } for a list.
     * @returns {Promise<object|undefined>}  the redacted page or list, or nothing when it is left alone.
     */
    "entity.after.read": async (ctx) => {
      if (isEditor(ctx.user) || !ctx.subject || !(await isProtected(ctx))) return;
      if (Array.isArray(ctx.subject.items)) return { ...ctx.subject, items: ctx.subject.items.map((r) => redact(ctx, r)) };
      return redact(ctx, ctx.subject);
    },
    /**
     * Implements hook render.before.content.
     *
     * On a protected site, removes answers and choice feedback from served pages and marks each guarded question with
     * data-answer-guard-key. Static publishes and the editor preview are left alone (static copies have no server to
     * grade against).
     *
     * @param {object} ctx  ctx.subject: the render context (page, mode, content).
     * @returns {Promise<object|undefined>}  the render context with redacted content, or nothing.
     */
    "render.before.content": async (ctx) => {
      if (ctx.subject.mode !== "dynamic" || !(await isProtected(ctx))) return;
      ctx.subject.content = scan(ctx.subject.content, tagsFrom(ctx.settings), true).content;
      return ctx.subject;
    },
    /**
     * Implements hook render.after.body.
     *
     * Adds the answer-guard-monitor singleton, with its settings baked in, to pages that have guarded questions. It
     * filters scripted input, answers the questions' check requests from the plugin's check route and sends flags.
     *
     * @param {object} ctx  ctx.subject: the render context (page, content, body).
     * @returns {object|undefined}  the render context with the monitor added, or nothing.
     */
    "render.after.body": async (ctx) => {
      if (ctx.subject.mode !== "dynamic" || !String(ctx.subject.content || "").includes("data-answer-guard-key=")) return;
      const s = ctx.settings;
      const page = ctx.subject.page || {};
      ctx.subject.body.end.push(`<script type="module" src="${esc(ctx.assets.url("frontend/dist/answer-guard-monitor.js"))}"></script>`);
      ctx.subject.body.end.push(`<answer-guard-monitor page="${esc(page.id)}" endpoint="x/api/v1/plugins/${NS}/" min-answer-ms="${Number(s.minAnswerMs) || 0}"${s.blockUntrusted ? " block-untrusted" : ""} honor-prompt="${esc(s.honorPrompt || "")}"></answer-guard-monitor>`);
      return ctx.subject;
    },
  },
  operations: {
    /**
     * Implements operation answerGuardCheck.
     *
     * Grades the signed-in learner's choices for one guarded question against the stored key and says only whether
     * they are right, with the feedback the author wrote for the choices. Checks of the same question closer together
     * than minCheckIntervalMs get 429, which slows trying every option; every check is kept for the instructor report.
     *
     * @param {object} ctx
     * @param {object} req  req.body { pageId, key, choices: [labels] }.
     * @returns {Promise<object>}  { correct, attempts, feedback }, or a 404/429 response.
     */
    async answerGuardCheck(ctx, req) {
      const b = req.body || {};
      const q = (asMap(await ctx.storage.read("keys"))[b.pageId] || {})[b.key];
      if (!q) return { status: 404, body: { error: "not a guarded question" } };
      const attempts = asList(await ctx.storage.read("attempts"));
      const mine = attempts.filter((a) => a.userId === ctx.user.id && a.pageId === b.pageId && a.key === b.key);
      const gap = Number(ctx.settings.minCheckIntervalMs) || 0;
      const last = mine[mine.length - 1];
      if (last && ctx.now() - last.at < gap) return { status: 429, body: { error: "wait before checking again", retryAfterMs: gap - (ctx.now() - last.at) } };
      const chosen = [...new Set(asList(b.choices).map(norm))];
      const right = q.choices.filter((c) => c.correct).map((c) => c.label);
      const correct = chosen.length === right.length && right.every((l) => chosen.includes(l));
      const feedback = [];
      for (const c of q.choices) {
        const picked = chosen.includes(c.label);
        if (picked && c.selected) feedback.push(c.selected);
        if (!picked && c.unselected) feedback.push(c.unselected);
      }
      await ctx.storage.write("attempts", [...attempts, { userId: ctx.user.id, pageId: b.pageId, key: b.key, at: ctx.now(), correct }]);
      return { correct, attempts: mine.length + 1, feedback };
    },
    /**
     * Implements operation answerGuardSignal.
     *
     * Turns what the monitor saw while a learner answered one question into flags: scripted input, an automation flag
     * in the browser, no pointer or key input at all, or an answer faster than minAnswerMs. Only flagged answers are
     * stored. Keyboard-only answers are normal and never flagged for missing pointer movement.
     *
     * @param {object} ctx
     * @param {object} req  req.body { pageId, key, untrusted, msToFirstInput, inputKind, automation }.
     * @returns {Promise<object>}  { flagged: [reasons] }, or a 404 response.
     */
    async answerGuardSignal(ctx, req) {
      const b = req.body || {};
      if (!(asMap(await ctx.storage.read("keys"))[b.pageId] || {})[b.key]) return { status: 404, body: { error: "not a guarded question" } };
      const reasons = [];
      if (Number(b.untrusted) > 0) reasons.push("scripted-input");
      if (b.automation === true) reasons.push("automation");
      if (b.inputKind === "none") reasons.push("no-input");
      const min = Number(ctx.settings.minAnswerMs) || 0;
      if (b.msToFirstInput !== undefined && b.msToFirstInput !== null && Number(b.msToFirstInput) < min) reasons.push("fast-answer");
      if (!reasons.length) return { flagged: [] };
      const signals = asList(await ctx.storage.read("signals"));
      const name = ctx.user.displayName || ctx.user.name || ctx.user.id;
      await ctx.storage.write("signals", [...signals, { userId: ctx.user.id, name, pageId: b.pageId, key: b.key, reasons, at: ctx.now() }]);
      return { flagged: reasons };
    },
    /**
     * Implements operation answerGuardReport.
     *
     * Lists, for editors and admins, each learner with flags on this site: how many, which reasons, and how many checks
     * they made. Flags are prompts for a conversation, not proof.
     *
     * @param {object} ctx
     * @returns {Promise<object>}  { items: [{ id, name, flags, checks, summary }] }, or a 403 response.
     */
    async answerGuardReport(ctx) {
      if (!isEditor(ctx.user)) return { status: 403, body: { error: "only editors and admins can see the report" } };
      const signals = asList(await ctx.storage.read("signals"));
      const attempts = asList(await ctx.storage.read("attempts"));
      const by = {};
      for (const s of signals) {
        const u = (by[s.userId] = by[s.userId] || { id: s.userId, name: s.name || s.userId, flags: 0, reasons: {} });
        u.flags += 1;
        for (const r of s.reasons || []) u.reasons[r] = (u.reasons[r] || 0) + 1;
      }
      const items = Object.values(by).map((u) => {
        const checks = attempts.filter((a) => a.userId === u.id).length;
        const reasons = Object.keys(u.reasons).sort().map((r) => `${r} x${u.reasons[r]}`).join(", ");
        return { id: u.id, name: u.name, flags: u.flags, checks, summary: `${u.flags} flagged ${u.flags === 1 ? "answer" : "answers"} (${reasons}); ${checks} checks` };
      });
      items.sort((a, b) => b.flags - a.flags || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return { items };
    },
  },
};
