// Webhooks (Node only). Every message is signed so receivers can tell it came from this site.
import { createHmac } from "node:crypto";
const urls = (ctx) => String(ctx.settings.endpoints || "").split("\n").map((u) => u.trim()).filter(Boolean);

async function send(ctx, event, data) {
  const body = JSON.stringify({ event, site: ctx.site.id, at: new Date(ctx.now()).toISOString(), data });
  const sig = `sha256=${createHmac("sha256", String(ctx.settings.secret)).update(body).digest("hex")}`;
  for (const url of urls(ctx)) {
    try {
      const res = await ctx.fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-hax-event": event, "x-hax-signature": sig }, body });
      if (!res.ok) ctx.log.warn(`${new URL(url).hostname} answered ${res.status} for ${event}`);
    } catch (e) { ctx.log.warn(`${event} to ${new URL(url).hostname} failed: ${e.message}`); }
  }
}

export default {
  hooks: {
    /**
     * Implements hook config.before.save.
     *
     * Refuses endpoints that are not https URLs or that point at private addresses.
     *
     * @param {object} ctx  ctx.subject: the settings being saved (values); ctx.previous: the stored settings.
     * @returns {Promise<object>}  the settings, or a veto.
     */
    "config.before.save": async (ctx) => {
      for (const u of String(ctx.subject.values.endpoints || "").split("\n").map((x) => x.trim()).filter(Boolean)) {
        let url; try { url = new URL(u); } catch { return ctx.veto(`"${u}" is not a URL`, 422); }
        if (url.protocol !== "https:") return ctx.veto(`${u}: only https URLs`, 422);
        if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(url.hostname) || url.hostname.endsWith(".internal")) return ctx.veto(`${u}: private addresses are not allowed`, 422);
      }
      return ctx.subject;
    },
    /**
     * Implements hook page.after.save.
     *
     * Sends a signed page.created or page.updated message to every endpoint. Detached, so a slow receiver never holds
     * up a save.
     *
     * @param {object} ctx  ctx.subject: the saved page; ctx.previous: the page before the save (none for a new page).
     * @returns {Promise<undefined>}
     */
    "page.after.save": async (ctx) => send(ctx, ctx.previous ? "page.updated" : "page.created", { id: ctx.subject.id, title: ctx.subject.title, slug: ctx.subject.slug }),
    /**
     * Implements hook page.after.delete.
     *
     * Sends a signed page.deleted message to every endpoint. Detached.
     *
     * @param {object} ctx  ctx.subject: the deleted page.
     * @returns {Promise<undefined>}
     */
    "page.after.delete": async (ctx) => send(ctx, "page.deleted", { id: ctx.subject.id }),
    /**
     * Implements hook manifest.after.save.
     *
     * Sends a signed site.updated message to every endpoint when the site manifest changes. Detached.
     *
     * @param {object} ctx  ctx.subject: the saved manifest.
     * @returns {Promise<undefined>}
     */
    "manifest.after.save": async (ctx) => send(ctx, "site.updated", { title: ctx.subject.title }),
  },
};
