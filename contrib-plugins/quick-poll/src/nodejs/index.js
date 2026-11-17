// Quick poll (Node). Mirrored in src/php/Plugin.php; both return identical results.
// The server never trusts the browser about a poll: it reads the poll (question, options, when results show, when it
// closes, whether a vote may change) from the page's saved content. Identity comes only from ctx.user. A visitor who
// is not signed in is told apart by a random key the poll keeps in that browser, stored only as a hash. No IP address
// or user agent is read or stored anywhere in this file.
import { createHash } from "node:crypto";

const EDITORS = ["admin", "editor"];
const HOUR = 3600000;
const LATEST_ZONE = 12 * HOUR; // a closing time with no zone has passed everywhere 12 hours after it passed in UTC
const ROUTE = "x/api/v1/plugins/quick-poll/votes";
const MODES = ["after", "closed", "never"];
const POLL_RE = /<quick-poll\b([^>]*)>([\s\S]*?)<\/quick-poll\s*>/gi;
const OPEN_RE = /<quick-poll\b([^>]*)>/gi;
const ATTR_RE = /([^\s="'<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
const INPUT_RE = /<input\b([^>]*)>/gi;
const ENTITY_RE = /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|amp|lt|gt|quot|apos|nbsp);/g;
const SPACE_RE = /[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/g;
const CLOSES_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const VOTER_RE = /^[0-9a-f]{32}$/;
const CHOICE_RE = /^c-[0-9a-f]{8}(-[0-9]{1,3})?$/;

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const bad = (status, error) => ({ status, body: { error } });
const isEditor = (user) => !!user && (user.roles || []).some((r) => EDITORS.includes(r));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** A whole number from a setting (a number or a string of digits); otherwise the fallback. */
function int(v, fallback) {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^\d{1,9}$/.test(v)) return Number(v);
  return fallback;
}

/** The host part of an Origin header or of the site address, lower case, or "". */
function originHost(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(String(url));
  return m ? m[1].toLowerCase() : "";
}

/** Text of an attribute value: the character references HAX writes, decoded. */
function decode(s) {
  return String(s).replace(ENTITY_RE, (all, name) => {
    if (name === "amp") return "&";
    if (name === "lt") return "<";
    if (name === "gt") return ">";
    if (name === "quot") return '"';
    if (name === "apos") return "'";
    if (name === "nbsp") return "\u00a0";
    const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : all;
  });
}

/** The attributes of an opening tag: lower-case names, decoded values; a bare attribute is "". The first wins. */
function attributes(text) {
  const out = {};
  ATTR_RE.lastIndex = 0;
  let m;
  while ((m = ATTR_RE.exec(text)) !== null) {
    const name = m[1].toLowerCase();
    const raw = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : "";
    if (!Object.prototype.hasOwnProperty.call(out, name)) out[name] = decode(raw);
  }
  return out;
}

/** 32-bit FNV-1a over UTF-16 code units, as hex: the hash the element uses for ids (user-action xapi.js). */
function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Option text the way the element compares it: NFC, runs of white space as one space, trimmed. */
function optionText(s) {
  return String(s).normalize("NFC").replace(SPACE_RE, " ").replace(/^ /, "").replace(/ $/, "");
}

/** Option ids in order, unique within the poll (the element's componentIds). */
function optionIds(texts) {
  const ids = texts.map((t) => `c-${fnv(t).padStart(8, "0")}`);
  const groups = {};
  ids.forEach((id, i) => { (groups[id] = groups[id] || []).push(i); });
  for (const id of Object.keys(groups)) {
    const g = groups[id];
    if (g.length < 2) continue;
    g.slice().sort((a, b) => (texts[a] < texts[b] ? -1 : texts[a] > texts[b] ? 1 : a - b)).forEach((index, n) => {
      ids[index] = n === 0 ? id : `${id}-${n + 1}`;
    });
  }
  return ids;
}

/** encodeURIComponent, which the element applies to the key in its activity id. */
const encodeKey = (k) => encodeURIComponent(k);

/** Milliseconds when a closing time has passed everywhere, or null for none (or one that cannot be read). */
function closesAt(value) {
  const m = CLOSES_RE.exec(String(value).trim());
  if (!m) return null;
  const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  if (m[4] === undefined) return at; // a date alone is read as UTC midnight, as the browser does
  if (m[7] === undefined) return at + LATEST_ZONE;
  if (m[7] === "Z") return at;
  const sign = m[7][0] === "-" ? -1 : 1;
  return at - sign * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(4, 6))) * 60000;
}

/**
 * Every poll in a page's saved content, in order: { key, question, mode, closes, allowChange, options: [{ id, label }] }.
 * key is the element's activity key, URI-encoded as in its activity id: the author's id, else its tag plus a hash of
 * the question, with "-1", "-2" for repeats. (The poll does not key on a resource attribute, so neither does this.)
 */
function pollsIn(content) {
  const found = [];
  POLL_RE.lastIndex = 0;
  let m;
  while ((m = POLL_RE.exec(String(content || ""))) !== null) {
    const a = attributes(m[1]);
    const labels = [];
    INPUT_RE.lastIndex = 0;
    let im;
    while ((im = INPUT_RE.exec(m[2])) !== null) {
      const ia = attributes(im[1]);
      if (Object.prototype.hasOwnProperty.call(ia, "slot")) continue;
      labels.push(optionText(ia.value !== undefined ? ia.value : ""));
    }
    const question = a.question !== undefined ? a.question : "";
    found.push({
      id: a.id !== undefined ? a.id : "",
      base: `quick-poll-${fnv(`quick-poll\u0001quick-poll\u0001${question}`)}`,
      question,
      mode: MODES.includes(a["show-results"]) ? a["show-results"] : "after",
      closes: a.closes !== undefined ? a.closes : "",
      allowChange: Object.prototype.hasOwnProperty.call(a, "allow-change"), // a boolean attribute: present means on
      labels,
    });
  }
  const seen = {};
  return found.map((p) => {
    let key;
    if (p.id !== "") key = p.id;
    else {
      const n = seen[p.base] || 0;
      seen[p.base] = n + 1;
      key = n > 0 ? `${p.base}-${n}` : p.base;
    }
    const ids = optionIds(p.labels);
    return { key: encodeKey(key), question: p.question, mode: p.mode, closes: p.closes, allowChange: p.allowChange, options: p.labels.map((label, i) => ({ id: ids[i], label })) };
  });
}

/** The poll an activity id names on a page, or null. */
function findPoll(page, activity) {
  const at = activity.indexOf("#");
  if (at < 0) return null;
  const key = activity.slice(at + 1);
  return pollsIn(page.content).find((p) => p.key === key) || null;
}

const isClosed = (poll, now) => { const at = closesAt(poll.closes); return at !== null && now >= at; };

/** Whether this caller may see the counts: editors always; otherwise as the poll says. */
function visible(poll, user, now) {
  if (isEditor(user)) return true;
  if (poll.mode === "never") return false;
  if (poll.mode === "closed") return isClosed(poll, now);
  return true;
}

async function allBallots(ctx) {
  const list = await ctx.storage.read("ballots");
  return Array.isArray(list) ? list : [];
}

/** Counts for every option of a poll, in the poll's order, zeros included. */
function countsOf(poll, ballots, pageId) {
  const counts = {};
  for (const o of poll.options) counts[o.id] = 0;
  for (const b of ballots) {
    if (b.pageId === pageId && b.poll === poll.key && Object.prototype.hasOwnProperty.call(counts, b.choice)) counts[b.choice] += 1;
  }
  return counts;
}

const percent = (n, total) => (total > 0 ? Math.floor((n * 200 + total) / (2 * total)) : 0);

/** The page and poll a request names, or a response explaining why not. */
async function locate(ctx, pageId, activity) {
  if (typeof pageId !== "string" || pageId === "" || pageId.length > 200) return { error: bad(422, "pageId must name a page") };
  if (typeof activity !== "string" || activity === "" || activity.length > 2000) return { error: bad(422, "activityId must name a poll") };
  const page = await ctx.entities.get("page", pageId);
  if (!page) return { error: bad(404, "No such page") };
  const poll = findPoll(page, activity);
  if (!poll) return { error: bad(404, "That poll is not on this page") };
  return { page, poll };
}

export default {
  operations: {
    /**
     * Implements operation quickPollVote.
     *
     * Counts one vote: finds the poll in the page's saved content, checks the option is one of its own, refuses votes
     * after it closes, keeps one vote per person (a signed-in user, or a visitor's browser key stored only as a hash)
     * and changes a vote only when the poll allows it. Answers with the counts when this caller may see them.
     *
     * @param {object} ctx
     * @param {object} req  req.query.pageId; req.body { activityId, choice, voter }; req.headers.origin when a browser sent it.
     * @returns {Promise<object>}  { vote, counts } or { vote, counts: {}, hidden: true }, or a 403/404/409/422/429 response.
     */
    async quickPollVote(ctx, req) {
      const s = ctx.settings;
      const b = req.body;
      if (!isObj(b)) return bad(422, "Send activityId and choice");
      const origin = req.headers && typeof req.headers.origin === "string" ? req.headers.origin : "";
      if (origin !== "" && originHost(origin) !== originHost(ctx.site.url)) return bad(403, "Votes can only be sent from this site");
      const q = isObj(req.query) ? req.query : {};
      const found = await locate(ctx, q.pageId, b.activityId);
      if (found.error) return found.error;
      const { poll } = found;
      if (typeof b.choice !== "string" || !CHOICE_RE.test(b.choice) || !poll.options.some((o) => o.id === b.choice)) return bad(422, "That is not one of this poll's options");
      const now = ctx.now();
      if (isClosed(poll, now)) return bad(409, "This poll is closed");
      let voter;
      if (ctx.user) voter = `u:${ctx.user.id}`;
      else {
        if (s.anonymousVoting === false) return bad(403, "Sign in to vote in this poll");
        if (typeof b.voter !== "string" || !VOTER_RE.test(b.voter)) return bad(422, "Send the voter key the poll made");
        voter = `v:${createHash("sha256").update(`${q.pageId}\u0001${poll.key}\u0001${b.voter}`).digest("hex").slice(0, 32)}`;
      }
      const list = await allBallots(ctx);
      const mine = list.find((x) => x.pageId === q.pageId && x.poll === poll.key && x.voter === voter);
      if (mine && mine.choice !== b.choice && !poll.allowChange) return bad(409, "Your vote is already in");
      if (!mine || mine.choice !== b.choice) {
        // flood guard: a count per hour for the whole site, with nothing recorded about who sent what
        const stored = await ctx.storage.read("meta");
        const meta = { windowStart: int(isObj(stored) ? stored.windowStart : 0, 0), count: int(isObj(stored) ? stored.count : 0, 0) };
        if (now - meta.windowStart >= HOUR) { meta.windowStart = now; meta.count = 0; }
        const cap = int(s.maxPerHour, 0);
        if (cap > 0 && meta.count >= cap) return bad(429, "Too many votes in the last hour. Please try again later.");
        meta.count += 1;
        await ctx.storage.write("meta", meta);
        if (mine) {
          mine.choice = b.choice;
          mine.ts = now;
        } else {
          const row = { pageId: q.pageId, poll: poll.key, voter, choice: b.choice, ts: now };
          if (ctx.user) row.userId = ctx.user.id;
          list.push(row);
        }
        await ctx.storage.write("ballots", list);
      }
      if (!visible(poll, ctx.user, now)) return { vote: b.choice, counts: {}, hidden: true };
      return { vote: b.choice, counts: countsOf(poll, list, q.pageId) };
    },
    /**
     * Implements operation quickPollResults.
     *
     * The counts for one poll, when this caller may see them: everyone for "after", everyone once the poll has closed
     * for "closed", editors only for "never".
     *
     * @param {object} ctx
     * @param {object} req  req.query { pageId, activityId }.
     * @returns {Promise<object>}  { counts } or { counts: {}, hidden: true }, or a 404/422 response.
     */
    async quickPollResults(ctx, req) {
      const q = isObj(req.query) ? req.query : {};
      const found = await locate(ctx, q.pageId, q.activityId);
      if (found.error) return found.error;
      if (!visible(found.poll, ctx.user, ctx.now())) return { counts: {}, hidden: true };
      return { counts: countsOf(found.poll, await allBallots(ctx), q.pageId) };
    },
    /**
     * Implements operation quickPollList.
     *
     * Every poll that has votes, for site editors: its page, question, total and each option's count and share, the
     * most recently voted first. A poll that is no longer on its page is listed with its stored option ids so it can
     * still be cleared.
     *
     * @param {object} ctx
     * @returns {Promise<object>}  { items, total }, or a 403 response.
     */
    async quickPollList(ctx) {
      if (!isEditor(ctx.user)) return bad(403, "Only site editors can read poll results");
      const list = await allBallots(ctx);
      const groups = [];
      const byKey = {};
      for (const b of list) {
        const k = `${b.pageId}\u0001${b.poll}`;
        if (!byKey[k]) { byKey[k] = { pageId: b.pageId, poll: b.poll, ts: b.ts, ballots: [] }; groups.push(byKey[k]); }
        byKey[k].ballots.push(b);
        if (b.ts > byKey[k].ts) byKey[k].ts = b.ts;
      }
      const pages = {};
      const items = [];
      for (const g of groups) {
        if (!Object.prototype.hasOwnProperty.call(pages, g.pageId)) pages[g.pageId] = await ctx.entities.get("page", g.pageId);
        const page = pages[g.pageId];
        const poll = page ? pollsIn(page.content).find((p) => p.key === g.poll) : null;
        const options = poll ? poll.options.map((o) => ({ id: o.id, label: o.label, count: 0 })) : [];
        for (const b of g.ballots) {
          let o = options.find((x) => x.id === b.choice);
          if (!o) { o = { id: b.choice, label: b.choice, count: 0 }; options.push(o); }
          o.count += 1;
        }
        const total = g.ballots.length;
        for (const o of options) o.percent = percent(o.count, total);
        let top = null;
        for (const o of options) if (top === null || o.count > top.count) top = o;
        const question = poll ? (poll.question !== "" ? poll.question : "(no question)") : "(no longer on its page)";
        items.push({
          pageId: g.pageId,
          pageTitle: page && typeof page.title === "string" && page.title !== "" ? page.title : g.pageId,
          poll: g.poll,
          question,
          onPage: !!poll,
          showResults: poll ? poll.mode : null,
          total,
          options,
          ts: g.ts,
          description: `${total} ${total === 1 ? "vote" : "votes"}; most picked: ${top.label} (${top.percent}%)`,
        });
      }
      items.sort((a, b) => b.ts - a.ts || (a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0) || (a.poll < b.poll ? -1 : a.poll > b.poll ? 1 : 0));
      return { items, total: items.length };
    },
    /**
     * Implements operation quickPollClear.
     *
     * Clears votes for site editors: every poll on one page, or one poll when poll (its key from quickPollList) is
     * given. People can vote again afterwards.
     *
     * @param {object} ctx
     * @param {object} req  req.body { pageId, poll }.
     * @returns {Promise<object>}  { cleared } with the number of votes removed, or a 403/422 response.
     */
    async quickPollClear(ctx, req) {
      if (!isEditor(ctx.user)) return bad(403, "Only site editors can clear votes");
      const b = isObj(req.body) ? req.body : {};
      if (typeof b.pageId !== "string" || b.pageId === "" || b.pageId.length > 200) return bad(422, "Open Insights for one page, or send the pageId of the page whose polls to clear");
      if (b.poll !== undefined && b.poll !== null && (typeof b.poll !== "string" || b.poll === "" || b.poll.length > 2000)) return bad(422, "poll must be a poll key from the list");
      const one = typeof b.poll === "string" ? b.poll : null;
      const list = await allBallots(ctx);
      const keep = list.filter((x) => !(x.pageId === b.pageId && (one === null || x.poll === one)));
      const cleared = list.length - keep.length;
      if (cleared > 0) {
        await ctx.storage.write("ballots", keep);
        ctx.log.info(`cleared ${cleared} poll votes on page ${b.pageId}`);
      }
      return { cleared };
    },
  },
  hooks: {
    /**
     * Implements hook config.before.save.
     *
     * Refuses settings the poll cannot work with: a flood guard that is not a whole number from 0 to 100000, or
     * visitor voting that is not on or off.
     *
     * @param {object} ctx  subject: { plugin, scope, values }.
     * @returns {Promise<*>}  the subject unchanged, or a veto (422).
     */
    "config.before.save": async (ctx) => {
      const v = (ctx.subject && ctx.subject.values) || {};
      const n = int(v.maxPerHour, -1);
      if (n < 0 || n > 100000) return ctx.veto("Votes per hour must be a whole number from 0 to 100000", 422);
      if (typeof v.anonymousVoting !== "boolean") return ctx.veto("Voting without signing in must be on or off", 422);
      return ctx.subject;
    },
    /**
     * Implements hook render.after.content.
     *
     * Gives every placed poll that has no address of its own the address that counts its votes, with the page it is on.
     * Published static copies get no address, so the poll keeps the vote in the browser and shows no results.
     *
     * @param {object} ctx  subject: the render context (page, mode, content).
     * @returns {Promise<object|undefined>}  the context with the polls configured, or nothing to leave it alone.
     */
    "render.after.content": async (ctx) => {
      const c = ctx.subject;
      if (!c || !isObj(c.page) || typeof c.page.id !== "string" || c.mode === "publish") return;
      const content = String(c.content || "");
      OPEN_RE.lastIndex = 0;
      if (!OPEN_RE.test(content)) return;
      const endpoint = ` endpoint="${esc(`${ROUTE}?pageId=${encodeURIComponent(c.page.id)}`)}"`;
      OPEN_RE.lastIndex = 0;
      c.content = content.replace(OPEN_RE, (tag, attrs) => (Object.prototype.hasOwnProperty.call(attributes(attrs), "endpoint") ? tag : `<quick-poll${endpoint}${attrs}>`));
      return c;
    },
    /**
     * Implements hook page.after.delete.
     *
     * Removes the votes of a deleted page's polls.
     *
     * @param {object} ctx  subject: the deleted page.
     * @returns {Promise<undefined>}
     */
    "page.after.delete": async (ctx) => {
      const list = await allBallots(ctx);
      const keep = list.filter((x) => x.pageId !== ctx.subject.id);
      if (keep.length !== list.length) {
        await ctx.storage.write("ballots", keep);
        ctx.log.info(`removed ${list.length - keep.length} poll votes with page ${ctx.subject.id}`);
      }
    },
  },
};
