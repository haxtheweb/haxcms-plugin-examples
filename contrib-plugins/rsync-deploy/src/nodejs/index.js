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
    async rsyncDeployNow(ctx) {
      try { return await deploy(ctx, "manual"); }
      catch (e) { ctx.log.error(`rsync failed: ${e.message}`); return { status: 502, body: { error: "rsync failed; see the log" } }; }
    },
  },
  hooks: {
    "plugin.before.requirements": async (ctx) => {
      const unmet = [...ctx.subject];
      if (!ctx.settings.target) unmet.push({ key: "settings.target", message: "Set the destination (user@host:/path)" });
      if (!ctx.settings.privateKey) unmet.push({ key: "settings.privateKey", message: "Add the SSH private key for the destination" });
      return unmet;
    },
    "config.before.save": async (ctx) => {
      const v = ctx.subject.values;
      if (v.target && !TARGET.test(v.target)) return ctx.veto(`"${v.target}" is not user@host:/path`, 422);
      if (v.privateKey && !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(v.privateKey)) return ctx.veto("that does not look like a private key", 422);
      if (v.deployOnCommit && !ctx.pluginEnabled("git")) ctx.warn("deploy after commit does nothing until the git plugin is enabled");
      return ctx.subject;
    },
    // detached: runs after the commit response is sent; failures go to the log
    "git.after.commit": async (ctx) => {
      if (!ctx.settings.deployOnCommit) return;
      try { await deploy(ctx, `commit ${String(ctx.subject.hash).slice(0, 7)}`); }
      catch (e) { ctx.log.error(`rsync after commit failed: ${e.message}`); }
    },
  },
};
