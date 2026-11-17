// Import source (Node). Mirrored in src/php/Plugin.php; both return identical results.
// One reader for "a site's files": a GitHub repository (file tree from the API, files from the raw host) or an
// uploaded zip of the same folder (ctx.archive.read). Site importers call it through import-source.tree and stay
// free of network and zip code.
const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";

const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const encPath = (p) => p.split("/").map((s) => encodeURIComponent(s)).join("/");

/** owner, repo and optional branch from a github.com URL, or null. */
export function parseRepo(url) {
  const m = /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)(?:\/tree\/([^/?#]+))?/i.exec(String(url).trim());
  return m ? { owner: m[1], name: m[2].replace(/\.git$/i, ""), branch: m[3] || null } : null;
}

/** The single top folder every path sits under (a GitHub download: <repo>-<branch>/), or "". */
export function topFolder(keys) {
  if (!keys.length) return "";
  const first = `${keys[0].split("/")[0]}/`;
  return first !== "/" && keys.every((k) => k.startsWith(first) && k.length > first.length) ? first : "";
}

async function listGithub(ctx, url) {
  const gh = parseRepo(url);
  if (!gh) return { error: "url must be a GitHub repository (https://github.com/<owner>/<repo>)" };
  const getJson = async (u, what) => {
    let r;
    try { r = await ctx.fetch(u); } catch { throw new Error(`unable to reach ${what}`); }
    if (!r.ok) throw new Error(`unable to read ${what} (HTTP ${r.status})`);
    return r.json();
  };
  const repo = `${gh.owner}/${gh.name}`;
  const info = await getJson(`${API}/repos/${repo}`, `the repository ${repo}`);
  const branch = gh.branch || (info && info.default_branch) || "main";
  const tree = await getJson(`${API}/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, `the file tree of ${repo}`);
  const paths = [];
  const seen = new Set();
  for (const t of (tree && Array.isArray(tree.tree) ? tree.tree : [])) {
    if (t && t.type === "blob" && typeof t.path === "string" && !seen.has(t.path)) { seen.add(t.path); paths.push(t.path); }
  }
  return { kind: "github", name: gh.name, repo, branch, prefix: "", rawBase: `${RAW}/${repo}/${encPath(branch)}`, paths };
}

async function openArchive(ctx, input, binary) {
  const f = (Array.isArray(input.files) && input.files[0]) || {};
  const opts = { match: typeof input.match === "string" && input.match !== "" ? input.match : "." };
  if (binary) opts.binary = true;
  try { return { file: f, entries: (await ctx.archive.read(String(f.data || ""), opts)) || {} }; } catch { return { error: "the file is not a zip archive" }; }
}

async function listArchive(ctx, input) {
  const a = await openArchive(ctx, input, false);
  if (a.error) return a;
  const keys = Object.keys(a.entries).sort(byText);
  const prefix = topFolder(keys);
  return { kind: "archive", name: String(a.file.name || "site").replace(/\.zip$/i, ""), repo: null, branch: null, prefix, rawBase: null, paths: keys.map((k) => k.slice(prefix.length)) };
}

const wantedPaths = (input) => (Array.isArray(input.paths) ? [...new Set(input.paths.filter((p) => typeof p === "string" && p !== ""))] : []);

async function readGithub(ctx, input, paths) {
  const repo = String(input.repo || "");
  const branch = String(input.branch || "");
  if (!/^[^/?#\s]+\/[^/?#\s]+$/.test(repo) || branch === "") return { error: "repo (<owner>/<repo>) and branch are required" };
  if (input.binary) return { error: "binary reads are for zip uploads; list a repository file by its URL (rawBase) instead" };
  const files = [];
  for (const p of paths) {
    let data = null;
    try { const r = await ctx.fetch(`${RAW}/${repo}/${encPath(branch)}/${encPath(p)}`); data = r.ok ? await r.text() : null; } catch { data = null; }
    files.push({ path: p, data });
  }
  return { files };
}

async function readArchive(ctx, input, paths) {
  const binary = input.binary === true;
  const a = await openArchive(ctx, input, binary);
  if (a.error) return a;
  const prefix = typeof input.prefix === "string" ? input.prefix : "";
  return { files: paths.map((p) => {
    const key = `${prefix}${p}`;
    if (!Object.prototype.hasOwnProperty.call(a.entries, key)) return { path: p, data: null };
    return { path: p, data: binary ? String(a.entries[key]) : String(a.entries[key]).replace(/\r\n?/g, "\n") };
  }) };
}

export default {
  contracts: {
    "import-source.tree": {
      /**
       * Implements contract import-source.tree, operation list.
       *
       * Lists the files of a site: a GitHub repository (its default branch, or the one named by /tree/<branch>) or
       * an uploaded zip of the same folder, with the top folder a GitHub download adds removed.
       *
       * @param {object} ctx    Platform context (spec/13); ctx.fetch reaches only api.github.com and raw.githubusercontent.com.
       * @param {object} input  { url } of the repository, or { files: [{ name, data (base64 zip) }], match? }.
       * @returns {Promise<object>}  { kind, name, repo, branch, prefix, rawBase, paths } or { error }.
       */
      async list(ctx, input) {
        input = input || {};
        try {
          if (Array.isArray(input.files) && input.files.length) return await listArchive(ctx, input);
          if (input.url) return await listGithub(ctx, input.url);
          return { error: "url or files is required" };
        } catch (e) {
          return { error: e.message };
        }
      },
      /**
       * Implements contract import-source.tree, operation read.
       *
       * Reads the named files of a source that list described: text from the repository's raw host, or text (base64
       * with binary) out of the uploaded zip. A file that is not there comes back with data null.
       *
       * @param {object} ctx    Platform context (spec/13).
       * @param {object} input  { repo, branch, paths } for a repository, or { files, prefix, match?, paths, binary? } for a zip.
       * @returns {Promise<object>}  { files: [{ path, data }] } or { error }.
       */
      async read(ctx, input) {
        input = input || {};
        try {
          const paths = wantedPaths(input);
          if (!paths.length) return { error: "paths is required" };
          if (Array.isArray(input.files) && input.files.length) return await readArchive(ctx, input, paths);
          return await readGithub(ctx, input, paths);
        } catch (e) {
          return { error: e.message };
        }
      },
    },
  },
};
