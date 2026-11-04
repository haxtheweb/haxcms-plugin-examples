---
name: example-authoring
description: "Author content that uses the example plugin's elements on a HAX site. Use when a page needs an awesome-* element or the example's Merlin options. Published to the site's .well-known/agent-skills while the plugin is enabled."
version: 0.1.0
license: Apache-2.0
metadata:
  author: haxtheweb
  plugin: example
  audience: site
  tags: [hax, plugin, example, authoring]
---

# Example plugin: authoring

This skill shows the shape of a **site** skill: it helps an agent working on a site that has the plugin enabled.

- The plugin provides elements prefixed `awesome-`; check `wc-registry.json` for the ones available.
- Insert them as normal HAX content in `pages/`; their editable properties are in each element's haxProperties.
- Do not hand-edit files the plugin generates; see the site's `hax-managed-files` skill.
