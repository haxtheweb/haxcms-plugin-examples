// Link checker (Node only). HEAD each distinct outside link once; 4xx/5xx or an unreachable host is broken.
export default {
  operations: {
    /**
     * Implements operation linkCheckerReport.
     *
     * Returns the report from the last weekly check.
     *
     * @param {object} ctx
     * @returns {Promise<object>}  { checkedAt, checked, broken }.
     */
    async linkCheckerReport(ctx) { return (await ctx.storage.read("report")) || { checkedAt: null, broken: [] }; },
  },
  contracts: {
    "insights.check": {
      /**
       * Implements contract insights.check, operation check.
       *
       * Gives the Insights screen the link.status result: the saved weekly report as findings, or a new check first
       * when the screen asks for fresh results.
       *
       * @param {object} ctx
       * @param {object} input  { provides?, pages?, fresh? }.
       * @returns {Promise<object>}  { results: { "link.status": { status, checkedAt, findings, summary } } }.
       */
      async check(ctx, input) {
        if (input && input.fresh) await checkLinks(ctx);
        const report = (await ctx.storage.read("report")) || { checkedAt: null, checked: 0, broken: [] };
        const only = input && Array.isArray(input.pages) && input.pages.length ? new Set(input.pages) : null;
        const findings = [];
        for (const b of report.broken) for (const pageId of b.pages) if (!only || only.has(pageId)) findings.push({ pageId, target: b.url, severity: "error", message: typeof b.status === "number" ? `Answers ${b.status}` : `Link is ${b.status}`, data: { status: b.status } });
        return { results: { "link.status": { status: report.checkedAt ? "ok" : "unavailable", checkedAt: report.checkedAt, findings, summary: { checked: report.checked || 0, broken: report.broken.length } } } };
      },
    },
  },
  // the weekly schedule handler, also run by insights.check when the screen asks for fresh results
  checkLinks,
};

/**
 * Implements schedule check.
 *
 * Sends one HEAD request to each distinct outside link on listed pages, every Monday, and stores a report of those
 * that answer 4xx/5xx, are unreachable or are refused as private addresses.
 *
 * @param {object} ctx
 * @returns {Promise<object>}  { checked, broken } counts.
 */
async function checkLinks(ctx) {
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
}
