# Link checker (community, Node only)

Every Monday it checks each distinct outside link on public pages once (HEAD) and stores a report of the broken ones by page (`linkCheckerReport`, also offered through MCP).

It must reach hosts nobody can list in advance, so `egress` is `{ any: true, reason }`, which shows as the derived tag `reaches-any-host`. Core's SSRF guard still refuses private and link-local addresses: they are reported as `refused` and never requested.
