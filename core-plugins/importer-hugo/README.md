# Import from Hugo (core)

Turns a [Hugo](https://gohugo.io) site into a new site by reading its files as data. Nothing of Hugo runs: no templates, no theme, no custom shortcodes. Part of https://github.com/haxtheweb/issues/issues/3364.

**As a plugin:** implements the core contract `import.platform` (dispatch `chosen`). It calls three other plugins through the platform and so carries none of their code: `import-source` lists and reads the repository or zip (`import-source.tree`), `import-frontmatter` reads front matter and configuration in YAML, TOML or JSON (`import-frontmatter.data`), and `import-markdown` converts markdown (`import.file`). It has no network access of its own.

## What goes in

- **A GitHub repository URL** (`https://github.com/<owner>/<repo>`, optionally `/tree/<branch>`), or **an uploaded zip** of the same folder (`files: [{ name: site.zip, data }]`). A zip fetches nothing.
- The site is the shallowest folder holding `hugo.toml`, `hugo.yaml`, `hugo.yml` or `hugo.json` (at its top or in `config/_default/`), or the older `config.*` beside a `content/`, `layouts/`, `themes/` or `archetypes/` folder. A site in a subfolder (`docs/`, `site/`, `exampleSite/`) is found.
- Content is read from `contentDir` (default `content`), or from the default language's `contentDir` when the site keeps each language in its own folder.

## What comes out

| In Hugo | In the new site |
|---|---|
| `content/_index.md` | The home page, first. |
| A folder with `_index.md` (a section) | One page, with the pages under it as its children. |
| A folder of pages with no `_index.md` | An empty page that keeps its children. |
| A folder with `index.md` (a page bundle) | One page. Other files in the folder are its resources, not pages. |
| Any other `.md`, `.markdown` or `.html` file | One page. `metadata.hugo.kind` records which of these it was. |
| Hugo's default order | Kept: pages with a `weight` first (lowest first), then newest first by `date`, then by title. Blog posts sit under their section, newest first. |
| Front matter in YAML (`---`), TOML (`+++`) or JSON | Read alike. |
| `title`, else the first `# heading`, else the file or folder name | The page title. |
| `slug`, else the file or folder name | The page's slug, under its parent's. |
| `draft: true` | `metadata.published: false`. |
| `date` (`2026-03-09`, `2026-03-09T14:30:00+02:00`) | `metadata.created` (seconds; no offset is read as UTC). |
| `tags` | `metadata.tags`. |
| `headless: true` | `metadata.hideInMenu: true`. |
| `title` and `params.description` in the site configuration | The site's title and description. |
| `{{< figure src=… caption=… >}}` | A `media-image` and its caption. |
| `{{< youtube ID >}}`, `{{< vimeo ID >}}` | A `video-player`. |
| `{{< ref "page.md" >}}`, `{{< relref … >}}` | The imported page's slug. |
| `{{< highlight lang >}} … {{< /highlight >}}` | A code block. |
| `{{< param "name" >}}` | That site parameter, when it is text. |
| Any other shortcode | Removed, its inner content kept, and counted in `stats.unmapped` as `shortcode:<name>`. |
| Images and documents a page uses: beside the page (a bundle's resources), under `static/` or `assets/` | Listed in `files` and linked as `files/<name>`; images become `media-image`. From a repository they are listed by URL for core to fetch; from a zip they are handed over as data. |
| Links between pages: by address (`/posts/first/`, `../second/`), to a content file (`second.md`), with the site's own `baseURL`, or through `url` and `aliases` in front matter | The imported page's slug. |
| The summary divider (`<!--more-->`) and `{#id .class}` attribute blocks | Removed. |
| Several languages (`about.fr.md`, or a `contentDir` per language) | One: `defaultContentLanguage` (default `en`). Files in other languages are counted in `stats.languageFiles`. |

`stats` reports `pages`, `media`, `languageFiles` and, when anything was left out, `unmapped`: `shortcode:<name>` and `format:<ext>` (content in AsciiDoc, reStructuredText, Org or Pandoc, which Hugo converts with outside tools). More than 500 page files sets `truncated: true`; the pages beyond that are created empty.

## Not carried over

- **Anything a template builds:** section listings, taxonomy pages (`/tags/…`), pagination, menus, related pages, RSS. A section imports with its own text only; its pages are its children.
- **The theme and custom shortcodes** (`layouts/shortcodes/`): their tags are removed and counted, their inner content kept. A shortcode with no inner content leaves nothing behind.
- **Menus** (`menus.main`, `menu:` in front matter): the outline follows the content tree, as documentation themes do.
- **Markdown the shared converter does not know** (tables, nested lists, footnotes, definition lists); see `core-plugins/import-markdown`.
- **Other languages**, `publishDate` and `expiryDate`, `cascade`, page `params`, and data files (`data/`).
- **Media no page refers to**, and files reached only through Hugo Pipes.
- **Other forges:** only github.com repositories are read; use a zip for anything else.

<!-- implements:start (generated by scripts/plugin-docs.mjs from plugin.yaml and the docblocks in the code; do not edit by hand) -->
## What it implements

| Kind | Name | Runs when | What this plugin does |
|---|---|---|---|
| contract | `import.platform` convert | core calls it (chosen) | Reads a Hugo site from a GitHub repository (or an uploaded zip of one): one page per section, page bundle and content file, in Hugo's own order (weight, then newest first), titled, dated and tagged from front matter in YAML, TOML or JSON, with the built-in shortcodes that have a plain equivalent converted, links between pages pointed at the imported slugs, and the images and files pages use listed for the new site. |

Each code row matches a docblock (`Implements hook ...`, `Implements operation ...`) directly above the implementation in `src/nodejs` and `src/php`.
<!-- implements:end -->
