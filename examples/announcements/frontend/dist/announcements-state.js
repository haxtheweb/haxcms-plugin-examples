// "Dismissed latest" state, per browser. In app-hax this is UserScaffoldInstance long-term memory under the key
// "whatsNew" ({ seenVersion, dismissedVersion }); this module wraps whichever store is available so the elements
// stay testable. Never delete the key with deleteMemory(key, "long"): that clears all long-term memory. Overwrite it.
import { compareVersions } from "./announcements-versions.js";

const KEY = "whatsNew";

function store() {
  const us = globalThis.UserScaffoldInstance;
  if (us && us.readMemory) return { read: () => us.readMemory(KEY) || {}, write: (v) => us.writeMemory(KEY, v, "long") };
  return {
    read: () => { try { return JSON.parse(localStorage.getItem(`announcements-${KEY}`) || "{}"); } catch { return {}; } },
    write: (v) => { try { localStorage.setItem(`announcements-${KEY}`, JSON.stringify(v)); } catch { /* storage unavailable: chip just shows again */ } },
  };
}

// The chip shows while dismissedVersion is missing or older than latestVersion (an unparseable value counts as new).
export function hasNew(latestVersion) {
  if (!latestVersion) return false;
  const { dismissedVersion } = store().read();
  return !dismissedVersion || compareVersions(dismissedVersion, latestVersion) < 0;
}
export function markSeen(latestVersion) { const s = store(); s.write({ ...s.read(), seenVersion: latestVersion }); }
export function dismiss(latestVersion) { const s = store(); s.write({ ...s.read(), seenVersion: latestVersion, dismissedVersion: latestVersion }); }
