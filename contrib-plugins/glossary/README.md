# Glossary (community, Node only)

A site glossary as its own entity (`glossaryTerm`, stored in a site store that travels with the site). Entity hooks refuse duplicates (terms and aliases) for every writer: this plugin's route, an import, or another plugin saving terms.

At render, the first appearance of each term in running text becomes `<glossary-term definition="...">`, a small element this plugin ships (`role: injected`). Text inside links, headings and code is left alone. Visitors may read the term list (`optional` auth). `hax glossary list` prints it.
