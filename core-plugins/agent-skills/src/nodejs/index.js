// Agent skills discovery (Node). Mirrored in src/php/Plugin.php.
import { createHash } from "node:crypto";

const ROOT = ".well-known/agent-skills";
const SCHEMA = "https://schemas.agentskills.io/discovery/0.2.0/schema.json";
const digest = (s) => `sha256:${createHash("sha256").update(s, "utf8").digest("hex")}`;
// the description line of a SKILL.md frontmatter, without surrounding quotes
export const description = (md) => { const m = /^---\n[\s\S]*?^description:\s*(.+)$[\s\S]*?\n---/m.exec(md); return m ? m[1].trim().replace(/^(["'])([\s\S]*)\1$/, "$2") : ""; };

export default {
  hooks: {
    "rebuild.after": async (ctx) => {
      const skills = [];
      // the core set this plugin ships (data/skills/<name>/...)
      const names = [...new Set((await ctx.package.list("data/skills")).map((f) => f.split("/")[0]))];
      for (const name of names) {
        const paths = (await ctx.package.list(`data/skills/${name}`)).filter((f) => /\.(md|json|txt)$/.test(f));
        const files = [];
        for (const path of paths) files.push({ path, content: await ctx.package.read(`data/skills/${name}/${path}`) });
        skills.push({ name, files });
      }
      // site skills of every active plugin (core reads their folders)
      for (const s of await ctx.plugins.skills("site")) skills.push({ name: s.name, files: s.files });
      const index = { $schema: SCHEMA, skills: [] };
      for (const { name, files } of skills.sort((a, b) => a.name.localeCompare(b.name))) {
        const main = files.find((f) => f.path === "SKILL.md");
        if (!main) continue;
        for (const f of files) await ctx.files.writeManaged(`${ROOT}/${name}/${f.path}`, f.content);
        const extra = files.filter((f) => f.path !== "SKILL.md").map((f) => ({ path: f.path, digest: digest(f.content) }));
        index.skills.push({ name, type: "skill-md", description: description(main.content), url: `${name}/SKILL.md`, digest: digest(main.content), ...(extra.length ? { files: extra } : {}) });
      }
      await ctx.files.writeManaged(`${ROOT}/index.json`, JSON.stringify(index, null, 2) + "\n");
      await ctx.files.writeManaged(`${ROOT}/.htaccess`, await ctx.package.read("data/htaccess.txt"));
    },
  },
};
