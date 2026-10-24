# Site search (core)

**Today:** `HAXCMS.updateAlternateFormats()` writes `lunrSearchIndex.json` for every item. The text of unpublished pages ends up in a public file. Its symbol cleanup never ran, because it used a string where a regular expression was meant.

**As a plugin:** `rebuild.after` writes the same format (`[{ id, title, created, location, description, text }]`, read by the site-search element) from public pages only. The text is lower case with no tags, entities or symbols.
