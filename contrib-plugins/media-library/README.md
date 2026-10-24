# Media library (community, Node only)

A `mediaItem` entity that **extends** `file`: every file field, plus `alt`, `decorative`, `credit` and `license`, stored in a site store. When the files plugin saves an image, `file.after.save` adds a library record waiting for alt text (`mediaLibraryList?missingAlt=1`).

Hooks on a parent entity also see entities that extend it. A mediaItem save fires `file.after.save` too, so the hook checks `ctx.entityType` and acts only on real files. Alt text cannot be blanked unless the image is marked decorative.
