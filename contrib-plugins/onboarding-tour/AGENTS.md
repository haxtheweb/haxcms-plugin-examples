# AGENTS.md (onboarding-tour)

## Purpose
Declarative dashboard tour with translations.

## Rules
- Anchors only from the schema's list; never CSS selectors.
- Every translatable string gets a key in each locale overlay as `dashboard.first-steps.<path>`; the validator rejects keys that name nothing.

## Build, test, validate
`hax plugin validate` (a pack: no executable cases).
