---
name: example-plugin-dev
description: "Work on the example HAXcms plugin itself: where each piece lives, how to add one with hax plugin add, and how to validate. Use when changing the plugin, not when authoring a site. Ships with the package; never published to sites."
version: 0.1.0
license: Apache-2.0
metadata:
  author: haxtheweb
  plugin: example
  audience: developer
  tags: [hax, plugin, example, development]
---

# Example plugin: development

This skill shows the shape of a **developer** skill: it helps someone working on the plugin or the system.

- Manifest: `plugin.yaml`, validated by `hax-plugin-validate` from https://github.com/haxtheweb/haxcms-plugin-examples
- Add pieces with `hax plugin add <piece> <name>` rather than by hand, then run `hax plugin validate`.
- Every hook in the spec's `schema/hooks.json` has a stub in both `src/nodejs/index.js` and `src/php/Plugin.php`; keep them in step.
