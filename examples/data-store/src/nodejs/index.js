// Data store example (Node). Shows each writable store scope, an upgrade step that moves data out of site.json,
// and a personal-data store core can export and erase. The PHP entry mirrors it (src/php/Plugin.php).

// 0.1.0 kept votes in site.json at metadata.plugins.data-store.votes; 0.2.0 keeps them in the `votes` site store.
async function legacyVotes(ctx) {
  const site = await ctx.entities.get("site");
  return (site && site.metadata && site.metadata.plugins && site.metadata.plugins["data-store"] && site.metadata.plugins["data-store"].votes) || null;
}

export default {
  operations: {
    async dataStoreListVotes(ctx) {
      // read fallback: a site whose upgrade has not run still shows its votes
      return (await ctx.storage.read("votes")) || (await legacyVotes(ctx)) || {};
    },
    async dataStoreVote(ctx, req) {
      const votes = (await ctx.storage.read("votes")) || {};
      votes[req.params.pageId] = (votes[req.params.pageId] || 0) + 1;
      await ctx.storage.write("votes", votes);
      return { pageId: req.params.pageId, votes: votes[req.params.pageId] };
    },
    async dataStoreCreateNote(ctx, req) {
      if (!ctx.user) return { status: 401, body: { error: "sign in to write notes" } };
      const notes = (await ctx.storage.read("notes")) || [];
      const note = { uuid: `note-${notes.length + 1}`, userId: ctx.user.id, body: String(req.body.body || "") };
      await ctx.storage.write("notes", [...notes, note]);
      return note;
    },
    async dataStoreGetNote(ctx, req) {
      const note = ((await ctx.storage.read("notes")) || []).find((n) => n.uuid === req.params.uuid);
      if (!note) return { status: 404, body: { error: "not found" } };
      if (!ctx.user || note.userId !== ctx.user.id) return { status: 403, body: { error: "not your note" } };
      return note;
    },
    async dataStoreGetBadge(ctx) {
      return (await ctx.storage.read("badge")) || { label: null };
    },
    async dataStoreSetBadge(ctx, req) {
      const badge = { label: String(req.body.label || "") };
      await ctx.storage.write("badge", badge);
      return badge;
    },
  },
  // Upgrade steps by version (spec/13). Recipe: migrations/0002-move-votes.md
  upgrades: {
    "0.2.0": async (ctx) => {
      const old = await legacyVotes(ctx);
      if (!old) return;
      const current = (await ctx.storage.read("votes")) || {};
      for (const [page, n] of Object.entries(old)) current[page] = (current[page] || 0) + n;
      await ctx.storage.write("votes", current);
      const site = await ctx.entities.get("site");
      delete site.metadata.plugins["data-store"].votes;
      await ctx.entities.save("site", site);
      ctx.log.info(`moved votes for ${Object.keys(old).length} pages out of site.json`);
    },
  },
};
