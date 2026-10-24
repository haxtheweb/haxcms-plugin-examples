// The only place this plugin runs a command: `git`, as declared in plugin.yaml (exec: [git]).
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ENV = { ...process.env, GIT_AUTHOR_NAME: "HAXcms", GIT_AUTHOR_EMAIL: "haxcms@localhost", GIT_COMMITTER_NAME: "HAXcms", GIT_COMMITTER_EMAIL: "haxcms@localhost" };
export const run = (cwd, args) => new Promise((resolve, reject) => execFile("git", args, { cwd, env: ENV }, (err, stdout, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve(stdout))));

// same idea as core's sanitizeGitCommitMessage: a conservative allowlist, never shell or argument syntax
export const safeMessage = (m) => String(m || "Committed changes").replace(/[^A-Za-z0-9 _.,:;()/#@+=-]/g, "").slice(0, 200).trim() || "Committed changes";
export const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/;

export async function commit(dir, message) {
  if (!existsSync(join(dir, ".git"))) await run(dir, ["init", "-q"]);
  await run(dir, ["add", "-A"]);
  const status = await run(dir, ["status", "--porcelain"]);
  if (!status.trim()) return null; // nothing changed
  await run(dir, ["commit", "-q", "-m", safeMessage(message)]);
  return (await run(dir, ["rev-parse", "HEAD"])).trim();
}

export async function history(dir, limit) {
  if (!existsSync(join(dir, ".git"))) return [];
  const out = await run(dir, ["log", `-n${limit}`, "--pretty=format:%H%x09%s"]).catch(() => "");
  return out.split("\n").filter(Boolean).map((l) => { const [hash, message] = l.split("\t"); return { hash, message }; });
}
