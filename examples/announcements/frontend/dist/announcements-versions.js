// Same comparison as src/nodejs/announcements.js, for the browser.
export function compareVersions(a, b) {
  const pa = String(a).split(".");
  const pb = String(b).split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number(pa[i] ?? 0);
    const y = Number(pb[i] ?? 0);
    if (Number.isNaN(x) || Number.isNaN(y)) return Number.isNaN(x) && Number.isNaN(y) ? 0 : Number.isNaN(x) ? 1 : -1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
