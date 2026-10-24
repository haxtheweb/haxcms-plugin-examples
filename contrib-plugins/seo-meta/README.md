# SEO meta tags (community)

Authors set a search description, a share image and *hide from search engines* per page. These are declared page metadata fields with a form (`entities.yaml` `metadata.page.form`), shown in the page settings dialog under the plugin's title. `render.before.head` adds the canonical link, Open Graph tags, the description and robots.

- Saving trims the description and notes when it is outside 50 to 160 characters.
- A share image must be a path under `files/` or an https URL.
