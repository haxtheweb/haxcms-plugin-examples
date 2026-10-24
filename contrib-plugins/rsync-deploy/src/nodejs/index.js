// rsync deploy (Node only). Runs exactly one command, rsync, through ctx.exec: an argument list (no shell), refused
// unless the command is in the exec list. The SSH key reaches rsync as a private temp file that ctx.exec writes
// into {tmp} for the length of the run and removes afterwards; the key itself is never logged or returned.
const TARGET = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._~\/-]+$/;

export function rsyncArgs(settings, sitePath) {
  const ssh = `ssh -p ${Number(settings.port) || 22} -i {tmp}/id -o BatchMode=yes -o StrictHostKeyChecking=accept-new`;
  return ["-az", "--delete", ...(settings.dryRun ? ["--dry-run", "--itemize-changes"] : []), "--exclude", ".git", "-e", ssh, `${sitePath.replace(/\/?$/, "/")}`, settings.target];
}

async function deploy(ctx, reason) {
  const s = ctx.settings;
  const key = s.privateKey.endsWith("\n") ? s.privateKey : `${s.privateKey}\n`;
  const r = await ctx.exec("rsync", rsyncArgs(s, ctx.site.path), { files: { id: { content: key, mode: 0o600 } }, timeout: 55_000 });
  if (r.code !== 0) throw new Error(r.stderr.slice(-500) || `exit ${r.code}`);
  ctx.log.info(`deployed to ${s.target} (${reason})${s.dryRun ? " [dry run]" : ""}`);
  return { ran: true, reason, dryRun: !!s.dryRun, output: r.stdout.slice(-2000) };
}

export default {
  operations: {
    /**
     * Implements operation rsyncDeployNow.
     *
     * Copies the site to the configured target with rsync right away, for an admin who does not want to wait for a
     * commit.
     *
     * @param {object} ctx
     * @returns {object}  { ran, reason, dryRun, output }, or a 502 response when rsync fails (details go to the log).
     */
    async rsyncDeployNow(ctx) {
      try { return await deploy(ctx, "manual"); }
      catch (e) { ctx.log.error(`rsync failed: ${e.message}`); return { status: 502, body: { error: "rsync failed; see the log" } }; }
    },
  },
  hooks: {
    /**
     * Implements hook config.before.save.
     *
     * Refuses a target that is not user@host:/path and a key that is not a private key, and warns when deploy after
     * commit is on but the git plugin is off.
     *
     * @param {object} ctx  ctx.subject: the settings being saved (values); ctx.previous: the stored settings.
     * @returns {Promise<object>}  the settings, or a veto.
     */
    "config.before.save": async (ctx) => {
      const v = ctx.subject.values;
      if (v.target && !TARGET.test(v.target)) return ctx.veto(`"${v.target}" is not user@host:/path`, 422);
      if (v.privateKey && !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(v.privateKey)) return ctx.veto("that does not look like a private key", 422);
      if (v.deployOnCommit && !ctx.pluginEnabled("git")) ctx.warn("deploy after commit does nothing until the git plugin is enabled");
      return ctx.subject;
    },
    /**
     * Implements hook git.after.commit.
     *
     * Copies the site to the target after each commit when deployOnCommit is on. Detached: it runs after the commit
     * response is sent, and failures go to the log.
     *
     * @param {object} ctx  ctx.subject: the commit (hash, message, author).
     * @returns {Promise<undefined>}
     */
    "git.after.commit": async (ctx) => {
      if (!ctx.settings.deployOnCommit) return;
      try { await deploy(ctx, `commit ${String(ctx.subject.hash).slice(0, 7)}`); }
      catch (e) { ctx.log.error(`rsync after commit failed: ${e.message}`); }
    },
  },
};
