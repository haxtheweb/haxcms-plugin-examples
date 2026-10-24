// YouTube (Node). Mirrored in src/php/Plugin.php.
export default {
  operations: {
    async youtubeSearch(ctx, req) {
      const params = new URLSearchParams({ part: "snippet", type: "video", maxResults: "20", q: String(req.query.q || ""), key: ctx.settings.apiKey });
      if (req.query.pageToken) params.set("pageToken", String(req.query.pageToken));
      try {
        const res = await ctx.fetch(`https://www.googleapis.com/youtube/v3/search?${params}`);
        return { status: res.status, body: await res.json() };
      } catch (e) {
        ctx.log.warn(`YouTube search failed: ${e.message}`);
        return { status: 502, body: { error: "YouTube could not be reached" } };
      }
    },
  },
  hooks: {
    "plugin.before.requirements": async (ctx) =>
      ctx.settings.apiKey ? ctx.subject : [...ctx.subject, { key: "settings.apiKey", message: "Add a YouTube Data API key" }],
    // the key used to live in the core config (appStore.apiKeys.youtube); move it into this plugin's secret setting
    "plugin.after.install": async (ctx) => {
      const core = await ctx.entities.get("config", "core");
      const key = core && core.appStore && core.appStore.apiKeys && core.appStore.apiKeys.youtube;
      if (!key) return;
      if (!ctx.settings.apiKey) await ctx.config.save({ apiKey: key });
      const fresh = await ctx.entities.get("config", "core");
      delete fresh.appStore.apiKeys.youtube;
      await ctx.entities.save("config", fresh);
      ctx.log.info("moved the YouTube API key out of the core config");
    },
  },
};
