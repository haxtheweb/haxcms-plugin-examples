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
    async gitHistory(ctx, req) {
      return { items: await history(ctx.site.path, Math.min(100, Math.max(1, Number(req.query.limit) || 20))) };
    },
  },
  hooks: {
    "page.after.save": changed("Page saved"),
    "page.after.delete": changed("Page deleted"),
    "manifest.after.save": changed("Site updated"),
    "file.after.save": changed("File saved"),
    "file.after.delete": changed("File deleted"),
    "transaction.before.end": async (ctx) => {
      const msgs = ctx.subject.marks["git.commit"];
      if (!msgs || !msgs.length) return;
      await commitWithHooks(ctx, msgs.length === 1 ? msgs[0] : `${msgs.length} changes: ${msgs.slice(0, 3).join("; ")}${msgs.length > 3 ? "; ..." : ""}`);
    },
  },
};
