# Import from Jekyll (core)

Turns a [Jekyll](https://jekyllrb.com) site (including a GitHub Pages site) into a new site by reading its files as data. Nothing of Jekyll runs: no layouts, no includes, no plugins, no Ruby. Part of https://github.com/haxtheweb/issues/issues/3364.

**As a plugin:** implements the core contract `import.platform` (dispatch `chosen`). It calls three other plugins through the platform and carries none of their code: `import-source` lists and reads the repository or zip (`import-source.tree`), `import-frontmatter` reads front matter and `_config.yml` (`import-frontmatter.data`), and `import-markdown` converts markdown (`import.file`). It has no network access of its own.

## What goes in

- **A GitHub repository URL** (`https://github.com/<owner>/<repo>`, optionally `/tree/<branch>`), or **an uploaded zip** of the same folder (`files: [{ name: site.zip, data }]`). A zip fetches nothing.
- The site is the shallowest folder holding `_config.yml` (or `.yaml`, `.toml`), so a GitHub Pages site kept in `docs/` is found.

## What comes out

| In Jekyll | In the new site |
|---|---|
| `index.md` / `index.html` at the top (or `README.md` when there is no index, as GitHub Pages does) | The home page, first. |
| Pages (`.md`, `.markdown`, `.html` with front matter) | One page each. Markdown without front matter is a page too, as on GitHub Pages, except `README`, `LICENSE`, `CHANGELOG`, `CONTRIBUTING` and the like. |
| `parent` and `grand_parent` front matter (Just the Docs and its kin) | Nesting by the parent's title, whatever folder a page is in. A chain that loops is cut. |
| No `parent` anywhere | Nesting by folder: a folder's `index.md` holds the pages under it. |
| `nav_order` | Sibling order: numbers first, then text, then pages without one by title. `header_pages` in `_config.yml` (Minima) orders the pages it names. |
| `_posts/YYYY-MM-DD-title.md` (also under category folders) | One **Posts** page holding every post, newest first. A top-level page at `/blog/` or `/posts/` holds them instead. |
| Collections declared in `_config.yml` (`_guides/…`, under `collections_dir`) | A page per collection holding its documents, unless they name a parent. |
| `title`, else the first `# heading`, else the file name (a post's title words capitalised, as Jekyll does) | The page title. |
| `slug`, else the file or folder name | The page's slug, under its parent's. |
| `published: false` | `metadata.published: false`. |
| `date` front matter, else a post's file name date | `metadata.created` (seconds; no offset is read as UTC). |
| `tags` (a list or words) | `metadata.tags`. |
| `nav_exclude: true` | `metadata.hideInMenu: true`. |
| `title` and `description` in `_config.yml` | The site's title and description. |
| `{% highlight lang %}…{% endhighlight %}` | A code block. |
| `{% raw %}…{% endraw %}` | Its text, as written. |
| `{% link path %}`, `{% post_url name %}` | The imported page's slug. |
| `{{ site.baseurl }}`, `{{ site.url }}`, `relative_url`, `absolute_url` | Nothing, so the address that follows is read from the site's root. |
| `{{ site.<text> }}`, `{{ page.title }}`, `{{ page.<text> }}` | That value. |
| `{% comment %}…{% endcomment %}` | Removed with its text. |
| Any other Liquid tag (`include`, `if`, `for`, `assign`, …) or value | Removed, its block's text kept, and counted in `stats.unmapped` as `liquid:<tag>` or `liquid:output`. |
| kramdown `{: .class}` attribute lists, `{::options}` and the `* TOC` / `{:toc}` list | Removed. |
| Images and documents a page uses: beside it, or from the site's root (`/assets/…`), written with or without `baseurl` or `url` | Listed in `files` and linked as `files/<name>`; images become `media-image`. From a repository they are listed by URL for core to fetch; from a zip they are handed over as data. |
| Links between pages: by address (`/docs/setup/`, `setup.html`), by file (`setup.md`), through `permalink` or `redirect_from`, with or without `baseurl` | The imported page's slug. Post addresses follow `permalink` in `_config.yml` (`date`, `pretty`, `ordinal`, `none` or a `:placeholder` pattern). |

Left out of the site, as Jekyll leaves them out: names starting with `_`, `.` or `#`, `exclude` in `_config.yml`, `node_modules`, `vendor`, `Gemfile`, `_drafts` (counted in `stats.drafts`), `404` pages, and HTML without front matter. `include` in `_config.yml` brings a name back.

`stats` reports `pages`, `posts`, `media`, `drafts` and, when anything was left out, `unmapped`. More than 500 documents sets `truncated: true`; the rest are not imported.

## Not carried over

- **Anything a layout, include or plugin builds:** post listings, pagination, tag and category pages, feeds, navigation data files (`_data/navigation.yml`). The Posts page holds the posts as children; it has no text of its own.
- **Liquid logic:** `if`, `for` and `case` are not evaluated, so every branch's text is kept. Check the pages that the count names.
- **Markdown the shared converter does not know** (tables, nested lists, footnotes, definition lists); see `core-plugins/import-markdown`.
- **Data files** (`_data/`), **Sass**, and **media no page refers to**.
- **Collections' own `permalink` patterns**: a document's address is `/<collection>/<path>` unless its front matter sets one.
- **Other forges:** only github.com repositories are read; use a zip for anything else.

<!-- implements:start (generated by scripts/plugin-docs.mjs from plugin.yaml and the docblocks in the code; do not edit by hand) -->
## What it implements

| Kind | Name | Runs when | What this plugin does |
|---|---|---|---|
| contract | `import.platform` convert | core calls it (chosen) | Reads a Jekyll site from a GitHub repository (or an uploaded zip of one): its pages (nested by the parent front matter that Just the Docs and its kin use, else by folder), its collections, and its posts under one Posts page, newest first; titled, dated and tagged from front matter, with the Liquid tags that have a plain equivalent converted, links between pages pointed at the imported slugs, and the images and files pages use listed for the new site. |

Each code row matches a docblock (`Implements hook ...`, `Implements operation ...`) directly above the implementation in `src/nodejs` and `src/php`.
<!-- implements:end -->
