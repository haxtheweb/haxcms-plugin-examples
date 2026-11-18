# Import from Grav (core)

Turns a [Grav](https://getgrav.org) site into a new site by reading its files as data. Nothing of Grav runs: no PHP, no Twig, no plugins, no theme. Part of https://github.com/haxtheweb/issues/issues/3364.

**As a plugin:** implements the core contract `import.platform` (dispatch `chosen`). Markdown is converted through the platform (`import.file`, answered by `import-markdown`), and the repository or zip is listed and read through `import-source.tree` (answered by `import-source`), so this plugin has no network access and no zip code of its own.

## What goes in

- **A GitHub repository URL** (`https://github.com/<owner>/<repo>`, optionally `/tree/<branch>`), or **an uploaded zip** of the same folder (`files: [{ name: site.zip, data }]`). Grav sites often live on a server and not in a repository, so the zip matters: zip the site (or just its `user` folder) and upload it. A zip fetches nothing.
- The pages are found in the first of: `user/pages/` (a whole Grav install), `pages/` (the `user` folder on its own, as the Git Sync plugin keeps it), or numbered folders at the top (the pages folder itself).

## What comes out

| In Grav | In the new site |
|---|---|
| A folder under the pages folder with a markdown file (`default.md`, `blog.md`, `item.md`) | One page. The file's name is kept as `metadata.grav.template`. |
| A folder with no page file of its own, holding page folders | An empty page that keeps its children. |
| Numeric prefix (`01.home`) | Order among its siblings; the prefix is not part of the slug. |
| No numeric prefix, `visible: false`, or `routable: false` | `metadata.hideInMenu: true`. `visible: true` wins over a missing prefix. Children of a page that lists them itself (`content.items: '@self.children'`, a blog) stay in the menu. |
| `title` in the header, else the first `# heading`, else the folder name | The page title. |
| `slug` in the header, else the folder name | The page's slug, under its parent's. |
| `published: false` | `metadata.published: false`. |
| `date` (`2026-03-09 14:30`, `17:34 07/04/2014`, `09-03-2026`) | `metadata.created` (seconds, read as UTC). |
| `taxonomy.tag` | `metadata.tags`. |
| A listing ordered by date (`content.order.by: date`, `dir: desc`) | Its children in that order, so blog posts sit under their listing page, newest first. |
| Modules (`_name` or `01._name` folders under a modular page) | Folded into their page, in the page's `content.order.custom` order and then by folder name. A module's `title` becomes a heading unless its text starts with one. |
| `home.alias` in `system.yaml` (default `/home`) | That page goes first, as the new site's home. |
| `title` and `metadata.description` in `site.yaml` | The site's title and description. |
| A page with only `external_url` or `redirect` | A page holding that link. |
| Images and documents a page uses: beside the page, in another page's folder (by folder or by route), `image://`, `user://`, `page://` | Listed in `files` and linked as `files/<name>`; images become `media-image`. From a repository they are listed by URL for core to fetch; from a zip they are handed over as data. Image actions (`?cropZoom=600,300`) are dropped. |
| Links between pages: by route (`/blog/post`), by folder (`../02.blog/post`), with or without numeric prefixes, or to the page file | The imported page's slug. |
| Notice lines (`! text`, the markdown-notices plugin) | A quote. |
| The summary delimiter (`===`) and `{.class}` attribute blocks | Removed. |
| Several languages (`default.en.md`, `default.fr.md`) | One: the file with no language, else the first of `languages.supported` in `system.yaml`, else the first by name. The rest are counted in `stats.languageFiles`. |

`stats` reports `pages`, `modules`, `media`, `languageFiles` and, when anything was left out, `unmapped`: `twig` (Twig tags removed from pages that process Twig) and `shortcode:<name>` (a `[name]...[/name]` shortcode whose tags were removed and whose content was kept). More than 500 page files sets `truncated: true`; the pages beyond that are created empty.

## Not carried over

- **Anything Twig or a plugin builds:** collection listings, taxonomy pages, pagination, forms, galleries of every file in a folder, breadcrumbs. A blog's listing page imports with its own text only; its posts are its child pages.
- **The theme:** templates, CSS, and what a template does with header fields this importer does not read.
- **Shortcodes without a closing tag** (`[fa icon=... /]`) are left as written, and shortcode attributes are dropped with the tags.
- **Markdown the shared converter does not know** (tables, nested lists, footnotes, definition lists); see `core-plugins/import-markdown`.
- **Other languages**, and ordering other than folder order or date (`order.by: title`, a listing's `order.custom`).
- **Media no page refers to**, and `theme://` streams.
- **Other forges:** only github.com repositories are read; use a zip for anything else.

<!-- implements:start (generated by scripts/plugin-docs.mjs from plugin.yaml and the docblocks in the code; do not edit by hand) -->
## What it implements

| Kind | Name | Runs when | What this plugin does |
|---|---|---|---|
| contract | `import.platform` convert | core calls it (chosen) | Reads a Grav site from a GitHub repository (or an uploaded zip of one): one page per folder under its pages folder, ordered and shown in the menu by numeric prefix, titled, dated and tagged from each page header, with modules folded into their page, links between pages pointed at the imported slugs, and the images and files pages use listed for the new site. |

Each code row matches a docblock (`Implements hook ...`, `Implements operation ...`) directly above the implementation in `src/nodejs` and `src/php`.
<!-- implements:end -->
