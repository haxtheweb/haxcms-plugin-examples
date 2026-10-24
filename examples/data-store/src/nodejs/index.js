// Data store example (Node). Placeholder: the loader and storage helper do not exist yet.
export default {
  upgrade: {
    // runs once per scope when the installed version is older than plugin.yaml
    "0.2.0": async ({ storage, log }) => {
      log("moving votes from metadata.plugins.data-store to the votes store");
    },
  },
};
