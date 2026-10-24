# Import from WordPress (core)

Turns a WordPress export (WXR, from Tools > Export) into a new site. Implements `import.platform`, which core dispatches to the importer the person picks (`dispatch: chosen`), so it coexists with importer-html and the others.

- Pages first (by menu order, with parent links), then posts. Drafts are kept with `metadata.published: false`; trash is dropped.
- Loose text gets paragraphs, as WordPress's `wpautop` would. Scripts and inline handlers are removed (core sanitizes again).
- Attachments are listed in `files` for core to fetch into the site's `files/` folder; the importer downloads nothing.
