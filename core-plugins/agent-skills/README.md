# agent-skills

Agent skills discovery, extracted from core. Required.

**Today in core:** `HAXCMS.rebuildAgentSkills()` copies a curated skill set from the site boilerplate into each site's `.well-known/agent-skills/` with `index.json` (agentskills.io discovery 0.2.0, sha256 digests) and an `.htaccess`.

**As a plugin:** the core set ships as package data (`data/skills/`; two of today's nine are included here as a sample); `rebuild.after` adds the `site` skills of every active plugin and writes the folder as managed files. Developer skills are never published.

**Found along the way:** today's boilerplate `index.json` wraps some descriptions in literal quotes (`"\"Read and navigate...\""`), because the frontmatter quotes are not stripped; this plugin strips them.

Tests: `node harness/run-cases.mjs core-plugins/agent-skills`.
