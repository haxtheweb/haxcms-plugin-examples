# xAPI statements (community, Node only)

Records learners' progress (`completed`, `answered`, `experienced`) for the signed-in user and sends it to your learning record store every five minutes, in one batch.

Personal data lives in two places. Unsent statements are in a `personalData` store, which core exports and erases by itself. Sent statements are in the LRS, which only this plugin knows about, so it implements `privacy.export` (lists the sent statement ids and the LRS host) and `privacy.delete` (forgets them and warns the admin to void them in the LRS). The LRS host comes from a setting, so both `egress` and `privacy.recipients` name that setting.
