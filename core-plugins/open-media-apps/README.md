# Open media apps (core pack)

**Today:** `HAXAppStoreService.loadBaseAppStore()` always adds five keyless providers to the editor: NASA images, Sketchfab models, Dailymotion videos, Wikipedia articles and ccMixter music.

**As a plugin:** a pack (`kind: pack`) holding their appstore fragments (`registries/appstore/*.json`, copied unchanged). The browser calls the public APIs directly, as it does today, so there is no route, no secret and no code. Disabling the pack removes the five apps from the editor; content already inserted keeps working.

Because these apps are on for everyone today, the release that extracts them must keep them on for existing sites (see spec/GAPS.md, "Extracting an always-on feature").
