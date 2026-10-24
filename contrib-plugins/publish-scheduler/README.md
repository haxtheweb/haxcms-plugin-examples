# Publish scheduler (community, Node only)

Authors set **publish at** and **unpublish at** times on a page (`publishSchedulerSet`). They are stored in the page itself under `metadata.plugins.publish-scheduler`, declared in `config/entities.yaml`, so they travel with the site and core drops anything undeclared there. The `publish` schedule (every 15 minutes) flips `metadata.published` for every page that is due. Core runs the job as one bulk transaction, so git makes a single commit for the batch.
