// Lists only the server target: the desktop app and the browser keep it inactive (spec/14).
export default { hooks: {
  /**
   * Implements hook rebuild.after.
   *
   * Does nothing; the fixture exists for its manifest.
   *
   * @param {object} ctx
   * @returns {Promise<void>}
   */
  "rebuild.after": async () => {},
} };
