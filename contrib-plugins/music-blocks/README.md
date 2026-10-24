# Music blocks (community element pack)

Two blocks for music lessons, written in plain-text notation:

- `music-staff`: a melody from note names (`C4 D4 E4`) on a five-line staff, with an accessible name
- `music-chord-chart`: a progression (`G D Em C`), four chords to a bar

A pack (`kind: pack`, no backend code) that ships its own element files in `frontend/dist`. Turning it on adds the blocks to the site's block list. Turning it off removes them from the list but keeps them in the element registry, so placed blocks still render. The disable step names the pages that use them.

Suggested for `course` and `portfolio` sites (`siteTypes`). Element tests live in `test/` (web-test-runner).
