// Files (Node). Mirrored in src/php/Plugin.php.
// Upload rules follow today's core: only these extensions; names reduced to safe characters.
export const ALLOWED = ["jpg", "jpeg", "png", "gif", "webp", "svg", "webm", "mp4", "mp3", "mov", "csv", "ppt", "pptx", "xlsx", "xls", "doc", "docx", "pdf", "rtf", "txt", "vtt", "xml"];
const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf", txt: "text/plain", mp4: "video/mp4", mp3: "audio/mpeg" };
export const safeName = (n) => String(n || "").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+/, "").slice(0, 120);

export default {
  operations: {
    /**
     * Implements operation filesList.
     *
     * Lists the site's files sorted by name, optionally filtered by part of the name, for the editor's Local files browser.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @param {object} req  req.query.name: optional filter (lower-case substring of the file name).
     * @returns {Promise<object>}  { items, total }.
     */
    async filesList(ctx, req) {
      const q = String(req.query.name || "").toLowerCase();
      const items = (await ctx.entities.list("file")).filter((f) => !q || f.name.includes(q)).sort((a, b) => a.name.localeCompare(b.name));
      return { items, total: items.length };
    },
    /**
     * Implements operation filesUpload.
     *
     * Stores an upload under files/ with the same rules as core today: allowed extensions only, a safe lower-case name and the maxUploadMb limit. The file record is saved through ctx.entities, so file.before.save and file.after.save fire; a veto removes the stored bytes and returns 409.
     *
     * @param {object} ctx  Platform context (spec/13); ctx.settings.maxUploadMb (default 50).
     * @param {object} req  req.body: { name, data (base64), alt }.
     * @returns {Promise<object>}  the saved file record, or { status, body: { error } }.
     */
    async filesUpload(ctx, req) {
      const name = safeName(req.body.name);
      const ext = name.includes(".") ? name.split(".").pop() : "";
      if (!name || !ALLOWED.includes(ext)) return { status: 400, body: { error: `files of type .${ext || "?"} are not allowed` } };
      const bytes = Buffer.from(String(req.body.data || ""), "base64");
      if (bytes.length > (Number(ctx.settings.maxUploadMb) || 50) * 1024 * 1024) return { status: 400, body: { error: "file is too large" } };
      const existing = await ctx.entities.list("file");
      const uuid = `file-${existing.length + 1}`;
      const record = { uuid, id: uuid, name, path: `files/${name}`, url: `files/${name}`, mimeType: MIME[ext] || "application/octet-stream", size: bytes.length, alt: req.body.alt || "" };
      await ctx.files.put(record.path, bytes);
      const r = await ctx.entities.save("file", record); // file.before.save / file.after.save fire here
      if (r.veto) { await ctx.files.remove(record.path); return { status: 409, body: { error: r.veto.message } }; }
      return r.record;
    },
    /**
     * Implements operation filesDelete.
     *
     * Deletes a file record (file.before.delete can veto with 409) and then its bytes under files/.
     *
     * @param {object} ctx  Platform context (spec/13).
     * @param {object} req  req.params.uuid: the file to delete.
     * @returns {Promise<object>}  { deleted: uuid }, or { status, body: { error } } (404 when unknown).
     */
    async filesDelete(ctx, req) {
      const f = await ctx.entities.get("file", req.params.uuid);
      if (!f) return { status: 404, body: { error: "not found" } };
      const r = await ctx.entities.delete("file", f.id);
      if (r.veto) return { status: 409, body: { error: r.veto.message } };
      await ctx.files.remove(f.path);
      return { deleted: f.uuid };
    },
  },
};
