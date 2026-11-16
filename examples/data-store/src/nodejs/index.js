// Data store example (Node). Shows each writable store scope, an upgrade step that moves data out of site.json,
// and a personal-data store core can export and erase. The PHP entry mirrors it (src/php/Plugin.php).

// 0.1.0 kept votes in site.json at metadata.plugins.data-store.votes; 0.2.0 keeps them in the `votes` site store.
async function legacyVotes(ctx) {
  const site = await ctx.entities.get("site");
  return (site && site.metadata && site.metadata.plugins && site.metadata.plugins["data-store"] && site.metadata.plugins["data-store"].votes) || null;
}

export default {
  operations: {
    /**
     * Implements operation dataStoreListVotes.
     *
     * Returns the vote count per page from the votes site store, falling back to the 0.1.0 location in site.json so a
     * site whose upgrade has not run still shows its votes.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @returns {Promise<object>}  { <pageId>: count }.
     */
    async dataStoreListVotes(ctx) {
      return (await ctx.storage.read("votes")) || (await legacyVotes(ctx)) || {};
    },
    /**
     * Implements operation dataStoreVote.
     *
     * Adds one vote for a page in the votes site store, which travels with the site.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @param {object} req  req.params.pageId.
     * @returns {Promise<object>}  { pageId, votes }.
     */
    async dataStoreVote(ctx, req) {
      const votes = (await ctx.storage.read("votes")) || {};
      votes[req.params.pageId] = (votes[req.params.pageId] || 0) + 1;
      await ctx.storage.write("votes", votes);
      return { pageId: req.params.pageId, votes: votes[req.params.pageId] };
    },
    /**
     * Implements operation dataStoreCreateNote.
     *
     * Saves a note owned by the signed-in user in the notes siteData store, which core exports and erases by userId.
     *
     * @param {object} ctx  Platform context (spec/13); ctx.user is the caller.
     * @param {object} req  req.body.body: the note text.
     * @returns {Promise<object>}  the note { uuid, userId, body }, or 401 when nobody is signed in.
     */
    async dataStoreCreateNote(ctx, req) {
      if (!ctx.user) return { status: 401, body: { error: "sign in to write notes" } };
      const notes = (await ctx.storage.read("notes")) || [];
      const note = { uuid: `note-${notes.length + 1}`, userId: ctx.user.id, body: String(req.body.body || "") };
      await ctx.storage.write("notes", [...notes, note]);
      return note;
    },
    /**
     * Implements operation dataStoreGetNote.
     *
     * Returns one note, only to the user who owns it.
     *
     * @param {object} ctx  Platform context (spec/13); ctx.user is the caller.
     * @param {object} req  req.params.uuid.
     * @returns {Promise<object>}  the note, 404 when it does not exist, or 403 when the caller does not own it.
     */
    async dataStoreGetNote(ctx, req) {
      const note = ((await ctx.storage.read("notes")) || []).find((n) => n.uuid === req.params.uuid);
      if (!note) return { status: 404, body: { error: "not found" } };
      if (!ctx.user || note.userId !== ctx.user.id) return { status: 403, body: { error: "not your note" } };
      return note;
    },
    /**
     * Implements operation dataStoreGetBadge.
     *
     * Returns the site's badge from the manifest store, which lives inside site.json.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @returns {Promise<object>}  { label }, label null when none is set.
     */
    async dataStoreGetBadge(ctx) {
      return (await ctx.storage.read("badge")) || { label: null };
    },
    /**
     * Implements operation dataStoreSetBadge.
     *
     * Sets the site's badge in the manifest store, so it is published inside site.json.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @param {object} req  req.body.label.
     * @returns {Promise<object>}  { label }.
     */
    async dataStoreSetBadge(ctx, req) {
      const badge = { label: String(req.body.label || "") };
      await ctx.storage.write("badge", badge);
      return badge;
    },
  },
  // Upgrade steps by version (spec/13).
  upgrades: {
    /**
     * Implements upgrade 0.2.0.
     *
     * Moves the votes 0.1.0 kept in site.json (metadata.plugins.data-store.votes) into the votes site store, adding them
     * to any votes already there. Recipe: migrations/0002-move-votes.md.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @returns {Promise<void>}  nothing.
     */
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
