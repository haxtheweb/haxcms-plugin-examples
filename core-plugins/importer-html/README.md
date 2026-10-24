# Import from HTML (core)

One of the twelve site importers in core today, as a plugin. Implements the core contract `import.platform` with `convert`: the h1 (or title) becomes the site title and each h2 starts a page; text before the first h2 becomes Introduction. Scripts, styles and inline event handlers are dropped (core sanitizes again on save).

The other importers (drupal, elmsln, gitbook, haxcms, notion, openstax, plone, pressbooks, quarto, vitepress, wordpress) follow the same shape.
