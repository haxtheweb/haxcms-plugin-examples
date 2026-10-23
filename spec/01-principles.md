# Principles

Part of the HAXcms plugin specification (decision source: https://github.com/haxtheweb/issues/issues/3176).

## Principles

**Pillars.** HAX plugins extend a platform whose foundation stays portable, remixable, static-capable, accessible, owned by its owner, and creative across formats. Plugins build beyond the pillars (a paywall broker or OAuth login needs a backend and is less portable) but the foundation never depends on them.

**Core versus plugin test.** A capability belongs in core when every site should have it, a site owner would not reasonably turn it off, or it tracks an evolving standard or technology (SEO, accessibility compliance, LLM indexing, social cards, sitemap, search index). Existing sites gain it by upgrading, and nobody has to opt in. A capability is a plugin when it is a choice, a brand, an integration, or needs an outside service or a policy decision (comments, forms, LTI, OAuth providers, trackers, importers, payments, institutional theme packs, cookie consent).

**Load only what is used.** Nothing loads for a site that does not need it. Example: cookie consent exists as an optional core plugin, but its UI never loads unless an enabled plugin declares that it tracks users.

**Base contracts stay stable.** Core entities and routes keep their location (`/system/api/v1/sites`, `/themes`, `/languages`, `/skeletons`) even when a feature is extracted into a plugin. Extraction changes who provides the data, never the URL clients call. The `/entities` catalog is metadata and topology verification, not a data route.

**Honest about trust.** Plugin backend code runs in the main process. Capabilities are declared, shown, audited and enforced on the host API, but code that is already installed cannot be fully sandboxed. The defenses are tier gating, signing, audit and review.
