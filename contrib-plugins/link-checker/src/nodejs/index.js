// Link checker (Node only). HEAD each distinct outside link once; 4xx/5xx or an unreachable host is broken.
export default {
  operations: {
    async linkCheckerReport(ctx) { return (await ctx.storage.read("report")) || { checkedAt: null, broken: [] }; },
  },
  async checkLinks(ctx) {
    const pages = await ctx.entities.list("page", { listed: true });
    const byUrl = new Map();
    for (const p of pages) for (const m of String(p.content || "").matchAll(/<a\b[^>]*\bhref="(https?:\/\/[^"#]+)/gi)) byUrl.set(m[1], [...(byUrl.get(m[1]) || []), p.id]);
    const broken = [];
    for (const [url, pageIds] of [...byUrl.entries()].sort()) {
      let status;
      try { status = (await ctx.fetch(url, { method: "HEAD" })).status; } catch (e) { status = e.message.includes("private address") ? "refused" : "unreachable"; }
      if (status === "refused" || status === "unreachable" || status >= 400) broken.push({ url, status, pages: [...new Set(pageIds)] });
    }
    const report = { checkedAt: new Date(ctx.now()).toISOString(), checked: byUrl.size, broken };
    await ctx.storage.write("report", report);
    if (broken.length) ctx.log.warn(`${broken.length} broken link(s) found`);
    return { checked: byUrl.size, broken: broken.length };
  },
};
