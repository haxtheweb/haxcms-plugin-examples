// Version control (Node). Mirrored in src/php/Plugin.php.
import { commit, history, run, BRANCH } from "./git.js";

const describe = (kind, s) => `${kind}: ${(s && (s.title || s.name || s.id)) || ""}`.trim();

// fire git.before.commit (others may adjust the message or veto), commit, fire git.after.commit
async function commitWithHooks(ctx, message) {
  const before = await ctx.hooks.fire("git.before.commit", { siteId: ctx.site.id, message, files: [], author: ctx.user ? ctx.user.name : "HAXcms" });
  if (before.veto) { ctx.log.info(`commit vetoed: ${before.veto.message}`); return null; }
  const hash = await commit(ctx.site.path, before.subject.message);
  if (!hash) return null;
  await ctx.hooks.fire("git.after.commit", { ...before.subject, hash });
  if (ctx.settings.autoPush && BRANCH.test(String(ctx.settings.branch || ""))) {
    await run(ctx.site.path, ["push", "origin", `HEAD:${ctx.settings.branch}`]).catch((e) => ctx.log.warn(`push failed: ${e.message}`));
  }
  return hash;
}

// a change: commit now, or mark it for the end of a bulk transaction
const changed = (kind) => async (ctx) => {
  const msg = describe(kind, ctx.subject);
  if (ctx.transaction.bulk) { ctx.transaction.marks["git.commit"] = [...(ctx.transaction.marks["git.commit"] || []), msg]; return; }
  await commitWithHooks(ctx, msg);
};

export default {
  operations: {
    /**
     * Implements operation gitHistory.
     *
     * Lists the site's most recent commits (hash and message), newest first; limit is clamped to 1-100, default 20.
     *
     * @param {object} ctx  Platform context (spec/13); ctx.site.path is the repository.
     * @param {object} req  req.query.limit.
     * @returns {Promise<object>}  { items: [{ hash, message }] }, empty when the site has no repository.
     */
    async gitHistory(ctx, req) {
      return { items: await history(ctx.site.path, Math.min(100, Math.max(1, Number(req.query.limit) || 20))) };
    },
  },
  hooks: {
    /**
     * Implements hook page.after.save.
     *
     * Commits the site after a page is saved, or marks the change for one commit at the end of a bulk transaction.
     * The commit fires git.before.commit and git.after.commit, and pushes when autoPush is on.
     *
     * @param {object} ctx  ctx.subject: the page as saved; ctx.previous: the page before the save.
     *                      ctx.transaction tells a bulk change apart.
     * @returns {Promise<void>}  nothing.
     */
    "page.after.save": changed("Page saved"),
    /**
     * Implements hook page.after.delete.
     *
     * Commits the site after a page is deleted, or marks the change for one commit at the end of a bulk transaction.
     * The commit fires git.before.commit and git.after.commit, and pushes when autoPush is on.
     *
     * @param {object} ctx  ctx.subject: the page that was deleted.
     *                      ctx.transaction tells a bulk change apart.
     * @returns {Promise<void>}  nothing.
     */
    "page.after.delete": changed("Page deleted"),
    /**
     * Implements hook manifest.after.save.
     *
     * Commits the site after site.json is saved, or marks the change for one commit at the end of a bulk transaction.
     * The commit fires git.before.commit and git.after.commit, and pushes when autoPush is on.
     *
     * @param {object} ctx  ctx.subject: the manifest as saved; ctx.previous: the manifest before the save.
     *                      ctx.transaction tells a bulk change apart.
     * @returns {Promise<void>}  nothing.
     */
    "manifest.after.save": changed("Site updated"),
    /**
     * Implements hook file.after.save.
     *
     * Commits the site after a file is saved, or marks the change for one commit at the end of a bulk transaction.
     * The commit fires git.before.commit and git.after.commit, and pushes when autoPush is on.
     *
     * @param {object} ctx  ctx.subject: the file record as stored; ctx.previous: the record before the update, on update.
     *                      ctx.transaction tells a bulk change apart.
     * @returns {Promise<void>}  nothing.
     */
    "file.after.save": changed("File saved"),
    /**
     * Implements hook file.after.delete.
     *
     * Commits the site after a file is deleted, or marks the change for one commit at the end of a bulk transaction.
     * The commit fires git.before.commit and git.after.commit, and pushes when autoPush is on.
     *
     * @param {object} ctx  ctx.subject: the file that was deleted.
     *                      ctx.transaction tells a bulk change apart.
     * @returns {Promise<void>}  nothing.
     */
    "file.after.delete": changed("File deleted"),
    /**
     * Implements hook transaction.before.end.
     *
     * Makes one commit for everything a bulk transaction changed, with a message that lists the first few changes.
     *
     * @param {object} ctx  ctx.subject: the transaction, with marks["git.commit"]
     *                      holding the messages queued by the other hooks.
     * @returns {Promise<void>}  nothing.
     */
    "transaction.before.end": async (ctx) => {
      const msgs = ctx.subject.marks["git.commit"];
      if (!msgs || !msgs.length) return;
      await commitWithHooks(ctx, msgs.length === 1 ? msgs[0] : `${msgs.length} changes: ${msgs.slice(0, 3).join("; ")}${msgs.length > 3 ? "; ..." : ""}`);
    },
  },
};
