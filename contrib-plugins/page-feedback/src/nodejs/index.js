// Page feedback (Node). Mirrored in src/php/Plugin.php; both return identical results.
// Identity comes only from the platform (ctx.user), never from the request, and is stored only when the site turned
// the anonymous setting off. No IP address is read or stored anywhere in this file.
const EDITORS = ["admin", "editor"];
const HOUR = 3600000;
const DAY = 86400000;
const ROUTE = "x/api/v1/plugins/page-feedback/";
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const PRINTABLE_RE = /^[\x21-\x7E]+$/;
const WEBHOOK_RE = /^https:\/\/([^\/?#@:]+)(:\d{1,5})?([\/?#].*)?$/;
const HOST_RE = /^[a-z0-9.-]+$/;
const HEADER_RE = /^[A-Za-z0-9-]+$/;
const PRIVATE_RE = /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/;
const FORBIDDEN_HEADERS = ["host", "content-length", "content-type", "connection", "transfer-encoding", "cookie"];
const NOTIFY = ["all", "negative", "comments"];
const TAG_RE = /<page-feedback(?=[\s>\/])/g;
const WEBHOOK_HELP = "The webhook address must be an https address with a host, such as https://example.edu/hooks/feedback";

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const bad = (status, error) => ({ status, body: { error } });
const isEditor = (user) => !!user && (user.roles || []).some((r) => EDITORS.includes(r));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const chars = (s) => Array.from(s).length;

/** A whole number from a setting or query value (a number or a string of digits); otherwise the fallback. */
function int(v, fallback) {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^\d{1,9}$/.test(v)) return Number(v);
  return fallback;
}

/** Trims spaces, tabs and line breaks from both ends without a regular expression. */
function trimAscii(s) {
  const ws = (c) => c === 32 || c === 9 || c === 10;
  let a = 0;
  let b = s.length;
  while (a < b && ws(s.charCodeAt(a))) a++;
  while (b > a && ws(s.charCodeAt(b - 1))) b--;
  return s.slice(a, b);
}

/** Plain text: one kind of line break, no control characters, trimmed. Markup is kept as the text it is. */
function cleanText(s) {
  return trimAscii(String(s).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ""));
}

/** The host of an acceptable webhook address (https, a host, no sign-in part), or "". */
function webhookHost(url) {
  const u = String(url);
  if (u.length > 2000 || !PRINTABLE_RE.test(u)) return "";
  const m = WEBHOOK_RE.exec(u);
  if (!m) return "";
  const host = m[1].toLowerCase();
  if (!HOST_RE.test(host) || host.startsWith(".") || host.endsWith(".") || host.startsWith("-")) return "";
  return host;
}
const isPrivateHost = (host) => PRIVATE_RE.test(host) || host.endsWith(".internal") || host.endsWith(".local");

/** The host part of an Origin header or of the site address, lower case, or "". */
function originHost(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^\/?#]*)/i.exec(String(url));
  return m ? m[1].toLowerCase() : "";
}

/** The configured reasons as [{ id, label }], leaving out anything malformed. */
function reasonsOf(settings) {
  const list = Array.isArray(settings.reasons) ? settings.reasons : [];
  const out = [];
  for (const r of list) {
    if (isObj(r) && typeof r.id === "string" && ID_RE.test(r.id) && typeof r.label === "string" && r.label !== "") out.push({ id: r.id, label: r.label });
  }
  return out;
}
const labelOf = (reasons, id) => { const r = reasons.find((x) => x.id === id); return r ? r.label : id; };
const maxLength = (settings) => Math.min(5000, Math.max(1, int(settings.commentMaxLength, 1000)));
const isoOf = (ms) => new Date(ms).toISOString();
const seqOf = (item) => int(String(item.id).slice(1), 0);

async function allFeedback(ctx) {
  const list = await ctx.storage.read("feedback");
  return Array.isArray(list) ? list : [];
}

/** Drops feedback older than retentionDays (0 keeps everything). */
function fresh(list, settings, now) {
  const days = int(settings.retentionDays, 0);
  if (days <= 0) return list;
  const cutoff = now - days * DAY;
  return list.filter((x) => int(x.ts, 0) >= cutoff);
}

/** What editors see for one response: the stored row plus the words a card shows. */
function view(item, reasons) {
  const label = item.reasons.length ? labelOf(reasons, item.reasons[0]) : item.helpful ? "Helpful" : "Not helpful";
  return {
    ...item,
    title: item.pageTitle,
    label,
    summary: item.comment !== "" ? item.comment : "(no comment)",
    chip: { label, icon: item.helpful ? "icons:thumb-up" : "icons:thumb-down", color: item.helpful ? "green" : "orange" },
  };
}

/** A filter value from either spelling of the list conventions: filter[key]=v or a nested filter object. */
function param(query, group, key) {
  const flat = query[`${group}[${key}]`];
  if (flat !== undefined && flat !== null) return flat;
  const nested = query[group];
  return isObj(nested) && nested[key] !== undefined && nested[key] !== null ? nested[key] : null;
}
/** true, false, null (not given) or "invalid". */
function boolParam(v) {
  if (v === null) return null;
  if (v === true || v === "true") return true;
  if (v === false || v === "false") return false;
  return "invalid";
}
/** Milliseconds at the start of a YYYY-MM-DD day (UTC), null when not given, "invalid" otherwise. */
function dayParam(v) {
  if (v === null) return null;
  const m = DAY_RE.exec(String(v));
  if (!m || Number(m[1]) < 1970) return "invalid";
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

const percent = (yes, n) => (n > 0 ? Math.floor((yes * 200 + n) / (2 * n)) : 0);
const matchesNotify = (settings, item) => (settings.notifyOn === "negative" ? !item.helpful : settings.notifyOn === "comments" ? item.comment !== "" : true);
const pageUrl = (ctx, page) => (typeof page.slug === "string" && page.slug !== "" ? `${ctx.site.url}${page.slug}` : null);
const rolesOf = (settings) => String(settings.notifyRoles || "").split(",").map((r) => trimAscii(r)).filter((r) => r !== "");

/** Posts the summary to the site's webhook. The secret travels only in its header, only to that address. */
async function deliver(ctx, summary) {
  const s = ctx.settings;
  const url = trimAscii(String(s.webhookUrl || ""));
  if (s.webhookEnabled !== true || url === "") return;
  const body = JSON.stringify({
    event: "page-feedback.submitted",
    site: { id: ctx.site.id, name: ctx.site.name, url: ctx.site.url },
    page: { id: summary.pageId, title: summary.pageTitle, url: summary.pageUrl },
    helpful: summary.helpful,
    reasons: summary.reasons,
    comment: s.webhookIncludeComment === false ? null : summary.comment,
    hasComment: summary.comment !== "",
    at: summary.at,
  });
  const headers = { "content-type": "application/json" };
  const secret = String(s.webhookSecret || "");
  if (secret !== "") headers[String(s.webhookSecretHeader || "x-page-feedback-secret").toLowerCase()] = secret;
  try {
    const res = await ctx.fetch(url, { method: "POST", headers, body });
    if (!res.ok) ctx.log.warn(`the feedback webhook answered ${res.status}`);
  } catch (e) {
    ctx.log.warn(`the feedback webhook could not be reached: ${e.message}`);
  }
}

export default {
  operations: {
    /**
     * Implements operation pageFeedbackSubmit.
     *
     * Takes one visitor's answer for a page: checks the rating, the reasons against the site's list and the comment
     * as plain text, refuses cross-site posts and floods, then stores it for editors and passes a summary to the
     * webhook and to page-feedback.after.submit. Nothing about the sender is read from the request, and the signed-in
     * user is stored only when the anonymous setting is off.
     *
     * @param {object} ctx
     * @param {object} req  req.body { pageId, helpful, reasons, comment }; req.headers.origin when a browser sent it.
     * @returns {Promise<object>}  { received: true }, or a 403/404/422/429 response.
     */
    async pageFeedbackSubmit(ctx, req) {
      const s = ctx.settings;
      const b = req.body;
      if (!isObj(b)) return bad(422, "Send pageId and helpful");
      // a browser on another site may not post here with this site's sign-in
      const origin = req.headers && typeof req.headers.origin === "string" ? req.headers.origin : "";
      if (origin !== "" && originHost(origin) !== originHost(ctx.site.url)) return bad(403, "Feedback can only be sent from this site");
      if (typeof b.helpful !== "boolean") return bad(422, "helpful must be true or false");
      if (typeof b.pageId !== "string" || b.pageId === "" || b.pageId.length > 200) return bad(422, "pageId must name a page");
      const page = await ctx.entities.get("page", b.pageId);
      if (!page) return bad(404, "No such page");
      const reasons = reasonsOf(s);
      const given = b.reasons === undefined || b.reasons === null ? [] : b.reasons;
      if (!Array.isArray(given) || given.length > 12) return bad(422, "reasons must be a short list");
      const picked = [];
      for (const id of given) {
        if (typeof id !== "string" || !reasons.some((r) => r.id === id)) return bad(422, "That reason is not one this site offers");
        if (!picked.includes(id)) picked.push(id);
      }
      const raw = b.comment === undefined || b.comment === null ? "" : b.comment;
      if (typeof raw !== "string" || raw.length > 20000) return bad(422, "comment must be text");
      const max = maxLength(s);
      let comment = s.allowComments === false ? "" : cleanText(raw);
      if (chars(comment) > max) return bad(422, `A comment can be up to ${max} characters`);
      // flood guard: a count per hour for the whole site, with nothing recorded about who sent what
      const now = ctx.now();
      const stored = await ctx.storage.read("meta");
      const meta = { seq: int(isObj(stored) ? stored.seq : 0, 0), windowStart: int(isObj(stored) ? stored.windowStart : 0, 0), count: int(isObj(stored) ? stored.count : 0, 0) };
      if (now - meta.windowStart >= HOUR) { meta.windowStart = now; meta.count = 0; }
      const cap = int(s.maxPerHour, 0);
      if (cap > 0 && meta.count >= cap) return bad(429, "Too much feedback was sent in the last hour. Please try again later.");
      const pageTitle = typeof page.title === "string" && page.title !== "" ? page.title : b.pageId;
      const draft = { pageId: b.pageId, pageTitle, helpful: b.helpful, reasons: b.helpful ? [] : picked, comment };
      // other plugins may refuse it or change the comment (a spam filter, a redactor)
      const before = await ctx.hooks.fire("page-feedback.before.submit", draft);
      if (before.veto) return bad(before.veto.status || 422, before.veto.message);
      if (isObj(before.subject) && typeof before.subject.comment === "string") {
        const changed = cleanText(before.subject.comment);
        if (chars(changed) <= max) comment = changed;
      }
      meta.seq += 1;
      meta.count += 1;
      await ctx.storage.write("meta", meta);
      const item = { id: `f${meta.seq}`, pageId: draft.pageId, pageTitle, helpful: draft.helpful, reasons: draft.reasons, comment, at: isoOf(now), ts: now, handled: false };
      if (s.anonymous === false && ctx.user) {
        item.userId = ctx.user.id;
        item.userName = ctx.user.displayName || ctx.user.name;
      }
      if (s.inbox !== false) {
        const list = fresh(await allFeedback(ctx), s, now);
        list.push(item);
        await ctx.storage.write("feedback", list);
      }
      const summary = { id: item.id, pageId: item.pageId, pageTitle, pageUrl: pageUrl(ctx, page), helpful: item.helpful, reasons: item.reasons.map((id) => ({ id, label: labelOf(reasons, id) })), comment, at: item.at, notifyRoles: rolesOf(s) };
      if (matchesNotify(s, item)) {
        await deliver(ctx, summary);
        await ctx.hooks.fire("page-feedback.after.submit", summary);
      }
      return { received: true };
    },
    /**
     * Implements operation pageFeedbackList.
     *
     * Lists feedback for site editors, newest first, filtered by page, rating, handled state, whether a comment was
     * left and a range of days, one page at a time.
     *
     * @param {object} ctx
     * @param {object} req  req.query: filter[pageId|helpful|handled|hasComment|from|to], page[limit|offset].
     * @returns {Promise<object>}  { items, total, limit, offset }, or a 403/422 response.
     */
    async pageFeedbackList(ctx, req) {
      if (!isEditor(ctx.user)) return bad(403, "Only site editors can read feedback");
      const q = isObj(req.query) ? req.query : {};
      const pageId = param(q, "filter", "pageId");
      const helpful = boolParam(param(q, "filter", "helpful"));
      const handled = boolParam(param(q, "filter", "handled"));
      const hasComment = boolParam(param(q, "filter", "hasComment"));
      const from = dayParam(param(q, "filter", "from"));
      const to = dayParam(param(q, "filter", "to"));
      if (helpful === "invalid" || handled === "invalid" || hasComment === "invalid") return bad(422, "A true or false filter must be true or false");
      if (from === "invalid" || to === "invalid") return bad(422, "Dates are written YYYY-MM-DD");
      const limit = Math.min(200, Math.max(1, int(param(q, "page", "limit"), 25)));
      const offset = Math.max(0, int(param(q, "page", "offset"), 0));
      const reasons = reasonsOf(ctx.settings);
      const found = (await allFeedback(ctx)).filter((x) =>
        (pageId === null || x.pageId === String(pageId))
        && (helpful === null || x.helpful === helpful)
        && (handled === null || x.handled === handled)
        && (hasComment === null || (x.comment !== "") === hasComment)
        && (from === null || x.ts >= from)
        && (to === null || x.ts < to + DAY));
      found.sort((a, b) => b.ts - a.ts || seqOf(b) - seqOf(a));
      return { items: found.slice(offset, offset + limit).map((x) => view(x, reasons)), total: found.length, limit, offset };
    },
    /**
     * Implements operation pageFeedbackHandle.
     *
     * Marks one response handled (or not handled again) so the team can tell what still needs attention.
     *
     * @param {object} ctx
     * @param {object} req  req.params.id; req.body { handled }.
     * @returns {Promise<object>}  { id, handled }, or a 403/404/422 response.
     */
    async pageFeedbackHandle(ctx, req) {
      if (!isEditor(ctx.user)) return bad(403, "Only site editors can change feedback");
      if (!isObj(req.body) || typeof req.body.handled !== "boolean") return bad(422, "handled must be true or false");
      const list = await allFeedback(ctx);
      const item = list.find((x) => x.id === req.params.id);
      if (!item) return bad(404, "Not found");
      item.handled = req.body.handled;
      await ctx.storage.write("feedback", list);
      return { id: item.id, handled: item.handled };
    },
    /**
     * Implements operation pageFeedbackDelete.
     *
     * Deletes one response for good.
     *
     * @param {object} ctx
     * @param {object} req  req.params.id.
     * @returns {Promise<object>}  { deleted: id }, or a 403/404 response.
     */
    async pageFeedbackDelete(ctx, req) {
      if (!isEditor(ctx.user)) return bad(403, "Only site editors can delete feedback");
      const list = await allFeedback(ctx);
      const item = list.find((x) => x.id === req.params.id);
      if (!item) return bad(404, "Not found");
      await ctx.storage.write("feedback", list.filter((x) => x.id !== item.id));
      return { deleted: item.id };
    },
    /**
     * Implements operation pageFeedbackSummary.
     *
     * Adds feedback up per page for site editors: the share of helpful answers, the number of responses and the most
     * picked reason, with the pages that helped least first.
     *
     * @param {object} ctx
     * @returns {Promise<object>}  { items, totals }, or a 403 response.
     */
    async pageFeedbackSummary(ctx) {
      if (!isEditor(ctx.user)) return bad(403, "Only site editors can read feedback");
      const reasons = reasonsOf(ctx.settings);
      const list = await allFeedback(ctx);
      const order = [];
      const pages = {};
      let yes = 0;
      let open = 0;
      for (const x of list) {
        if (!pages[x.pageId]) { pages[x.pageId] = { pageId: x.pageId, title: x.pageTitle, ts: x.ts, responses: 0, helpful: 0, comments: 0, counts: {} }; order.push(x.pageId); }
        const p = pages[x.pageId];
        p.responses += 1;
        if (x.helpful) { p.helpful += 1; yes += 1; }
        if (x.comment !== "") p.comments += 1;
        if (!x.handled) open += 1;
        if (x.ts >= p.ts) { p.ts = x.ts; p.title = x.pageTitle; }
        for (const id of x.reasons) p.counts[id] = (p.counts[id] || 0) + 1;
      }
      const items = order.map((id) => {
        const p = pages[id];
        // the most picked reason; a tie goes to the one listed first in settings, then to the id
        const ids = Object.keys(p.counts);
        const rank = (rid) => { const i = reasons.findIndex((r) => r.id === rid); return i < 0 ? reasons.length : i; };
        ids.sort((a, b) => p.counts[b] - p.counts[a] || rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
        const top = ids.length ? ids[0] : null;
        const helpfulPercent = percent(p.helpful, p.responses);
        const topReason = top === null ? null : labelOf(reasons, top);
        return {
          pageId: p.pageId, title: p.title, responses: p.responses, helpful: p.helpful, helpfulPercent, comments: p.comments, topReasonId: top, topReason,
          description: `${helpfulPercent}% helpful, ${p.responses} ${p.responses === 1 ? "response" : "responses"}, top reason: ${topReason === null ? "none" : topReason}`,
        };
      });
      items.sort((a, b) => a.helpfulPercent - b.helpfulPercent || b.responses - a.responses || (a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0));
      return { items, totals: { responses: list.length, helpful: yes, helpfulPercent: percent(yes, list.length), unhandled: open } };
    },
  },
  hooks: {
    /**
     * Implements hook config.before.save.
     *
     * Refuses settings that would break the prompt or send feedback somewhere unsafe: empty labels, malformed or
     * repeated reason ids, out-of-range numbers, and a webhook address that is not https, has no host, carries a
     * sign-in or points at a private address. Warns when no destination is left on.
     *
     * @param {object} ctx  subject: { plugin, scope, values }.
     * @returns {Promise<*>}  the subject unchanged, or a veto (422).
     */
    "config.before.save": async (ctx) => {
      const v = (ctx.subject && ctx.subject.values) || {};
      for (const [key, name, max] of [["question", "The question", 200], ["yesLabel", "The Yes label", 40], ["noLabel", "The No label", 40]]) {
        if (typeof v[key] !== "string" || trimAscii(v[key]) === "" || chars(v[key]) > max) return ctx.veto(`${name} needs 1 to ${max} characters`, 422);
      }
      if (!Array.isArray(v.reasons) || v.reasons.length > 12) return ctx.veto("Reasons must be a list of up to 12", 422);
      const seen = [];
      for (const r of v.reasons) {
        if (!isObj(r) || typeof r.id !== "string" || r.id.length > 40 || !ID_RE.test(r.id)) return ctx.veto("A reason id uses lower-case letters, numbers and dashes, up to 40 characters", 422);
        if (typeof r.label !== "string" || trimAscii(r.label) === "" || chars(r.label) > 80) return ctx.veto(`The reason "${r.id}" needs a label of 1 to 80 characters`, 422);
        if (seen.includes(r.id)) return ctx.veto(`The reason id "${r.id}" is used twice`, 422);
        seen.push(r.id);
      }
      for (const [key, name, min, max] of [["commentMaxLength", "The longest comment", 1, 5000], ["retentionDays", "Days to keep feedback", 0, 3650], ["maxPerHour", "Responses per hour", 0, 100000]]) {
        const n = int(v[key], -1);
        if (n < min || n > max) return ctx.veto(`${name} must be a whole number from ${min} to ${max}`, 422);
      }
      if (!NOTIFY.includes(v.notifyOn)) return ctx.veto("Choose which responses are sent on: all, negative or comments", 422);
      for (const role of rolesOf(v)) if (role.length > 40 || !ID_RE.test(role)) return ctx.veto("Roles to notify are names such as admin or editor, separated by commas", 422);
      const url = trimAscii(typeof v.webhookUrl === "string" ? v.webhookUrl : "");
      const secret = typeof v.webhookSecret === "string" ? v.webhookSecret : "";
      if (url !== "") {
        const host = webhookHost(url);
        if (host === "") return ctx.veto(WEBHOOK_HELP, 422);
        if (isPrivateHost(host)) return ctx.veto("The webhook address cannot be a private or local address", 422);
      } else if (v.webhookEnabled === true) return ctx.veto(`The webhook is on but has no address. ${WEBHOOK_HELP}`, 422);
      else if (secret !== "") return ctx.veto("A webhook secret needs a webhook address to belong to", 422);
      const header = typeof v.webhookSecretHeader === "string" ? v.webhookSecretHeader : "";
      if (header.length > 64 || !HEADER_RE.test(header) || FORBIDDEN_HEADERS.includes(header.toLowerCase())) return ctx.veto("The webhook secret header must be a header name of your own, such as x-page-feedback-secret", 422);
      if (v.inbox === false && v.webhookEnabled !== true) ctx.warn("No destination is on: feedback is only passed to other plugins and is not kept");
      return ctx.subject;
    },
    /**
     * Implements hook render.after.content.
     *
     * Hands the site's question, labels, reasons and the address to post to every placed page-feedback block, and
     * adds the block at the end of the page when the site shows it everywhere and the page did not opt out. Published
     * static copies get no address, so the block thanks the reader and only fires its events.
     *
     * @param {object} ctx  subject: the render context (page, mode, content).
     * @returns {Promise<object|undefined>}  the context with the block configured, or nothing to leave it alone.
     */
    "render.after.content": async (ctx) => {
      const c = ctx.subject;
      if (!c || !isObj(c.page) || typeof c.page.id !== "string") return;
      const s = ctx.settings;
      const content = String(c.content || "");
      TAG_RE.lastIndex = 0;
      const placed = TAG_RE.test(content);
      const own = isObj(c.page.metadata) && isObj(c.page.metadata.plugins) && isObj(c.page.metadata.plugins["page-feedback"]) ? c.page.metadata.plugins["page-feedback"] : {};
      const everywhere = s.showOnEveryPage === true && own.hide !== true;
      if (!placed && !everywhere) return;
      const config = {
        endpoint: c.mode === "publish" ? null : `${ROUTE}feedback`,
        pageId: c.page.id,
        question: String(s.question || ""),
        yesLabel: String(s.yesLabel || ""),
        noLabel: String(s.noLabel || ""),
        reasons: reasonsOf(s),
        allowComments: s.allowComments !== false,
        commentMaxLength: maxLength(s),
        anonymous: s.anonymous !== false,
      };
      const attr = ` data-config="${esc(JSON.stringify(config))}"`;
      c.content = placed ? content.replace(TAG_RE, () => `<page-feedback${attr}`) : `${content}<page-feedback${attr}></page-feedback>`;
      return c;
    },
    /**
     * Implements hook page.after.delete.
     *
     * Removes the feedback of a deleted page so nothing is left pointing at a page that no longer exists.
     *
     * @param {object} ctx  subject: the deleted page.
     * @returns {Promise<undefined>}
     */
    "page.after.delete": async (ctx) => {
      const list = await allFeedback(ctx);
      const keep = list.filter((x) => x.pageId !== ctx.subject.id);
      if (keep.length !== list.length) {
        await ctx.storage.write("feedback", keep);
        ctx.log.info(`removed ${list.length - keep.length} feedback responses with page ${ctx.subject.id}`);
      }
    },
  },
  /**
   * Implements schedule prune.
   *
   * Deletes feedback older than the retentionDays setting; does nothing while it is 0.
   *
   * @param {object} ctx
   * @returns {Promise<object>}  { removed } with the number of responses deleted.
   */
  async prune(ctx) {
    const list = await allFeedback(ctx);
    const keep = fresh(list, ctx.settings, ctx.now());
    if (keep.length !== list.length) await ctx.storage.write("feedback", keep);
    return { removed: list.length - keep.length };
  },
};
