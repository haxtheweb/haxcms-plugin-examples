# Reading time (community)

Counts the words of a page on save (`page.before.save`) and stores `{ words, minutes }` under `metadata.plugins.reading-time`, a declared metadata field. `render.before.content` puts the label ("{n} min read") above the content.

- Settings: `wordsPerMinute` (200), `label`.
