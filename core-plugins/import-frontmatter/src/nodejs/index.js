// Import front matter (Node). Mirrored in src/php/Plugin.php; both return identical results.
// Page front matter (YAML between ---, TOML between +++, or a JSON object) and site configuration files, read as data
// for the site importers. Every scalar comes back as a string, so an importer sees the same shape whichever format a
// site was written in and whichever runtime it runs on.
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// ---- a YAML subset: block maps, block lists, scalars, [a, b] lists, | and > text. Enough for page front matter and site configuration. ----

const KEY = /^("[^"]*"|'[^']*'|[^\s"'#][^:#]*?)\s*:(?:\s+(.*))?$/;
const isItem = (t) => t === "-" || t.startsWith("- ");
const stripComment = (v) => (/^["']/.test(v) ? v : v.replace(/\s+#.*$/, "").trim());
function scalar(v) {
  v = v.trim();
  if (v.startsWith('"')) { const m = /^"((?:\\.|[^"\\])*)"/.exec(v); return m ? m[1].replace(/\\(.)/g, "$1") : v.slice(1); }
  if (v.startsWith("'")) { const m = /^'((?:''|[^'])*)'/.exec(v); return m ? m[1].replace(/''/g, "'") : v.slice(1); }
  v = stripComment(v);
  if (v.startsWith("[") && v.endsWith("]")) { const inner = v.slice(1, -1).trim(); return inner === "" ? [] : inner.split(",").map((x) => scalar(x)); }
  return v;
}
function yamlBlock(st, indent) {
  const l = st.lines[st.i];
  if (!l || l.indent < indent) return null;
  return isItem(l.text) ? yamlList(st, l.indent) : yamlMap(st, l.indent);
}
function yamlList(st, indent) {
  const out = [];
  while (st.i < st.lines.length) {
    const l = st.lines[st.i];
    if (l.indent !== indent || !isItem(l.text)) break;
    const rest = l.text.slice(1).replace(/^ +/, "");
    const offset = l.text.length - rest.length;
    if (rest === "") { st.i++; const n = st.lines[st.i]; out.push(n && n.indent > indent ? yamlBlock(st, n.indent) : null); continue; }
    if (isItem(rest) || KEY.test(rest)) { st.lines[st.i] = { indent: indent + offset, text: rest }; out.push(yamlBlock(st, indent + offset)); continue; }
    st.i++;
    out.push(scalar(rest));
  }
  return out;
}
function yamlMap(st, indent) {
  const out = {};
  while (st.i < st.lines.length) {
    const l = st.lines[st.i];
    if (l.indent < indent || (l.indent === indent && isItem(l.text))) break;
    st.i++;
    if (l.indent > indent) continue;
    const m = KEY.exec(l.text);
    if (!m) continue;
    const key = scalar(m[1]);
    const v = m[2] === undefined ? "" : stripComment(m[2]);
    if (v === "") {
      const n = st.lines[st.i];
      out[key] = n && (n.indent > indent || (n.indent === indent && isItem(n.text))) ? yamlBlock(st, n.indent) : null;
    } else if (/^[|>][-+0-9]*$/.test(v)) {
      const parts = [];
      while (st.i < st.lines.length && st.lines[st.i].indent > indent) parts.push(st.lines[st.i++].text);
      out[key] = parts.join(v[0] === "|" ? "\n" : " ");
    } else out[key] = scalar(v);
  }
  return out;
}
export function parseYaml(text) {
  const lines = [];
  for (const raw of String(text).replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*(#.*)?$/.test(raw) || /^(---|\.\.\.)\s*$/.test(raw)) continue;
    const indent = /^ */.exec(raw)[0].length;
    lines.push({ indent, text: raw.slice(indent).replace(/\s+$/, "") });
  }
  if (!lines.length) return {};
  const v = yamlBlock({ lines, i: 0 }, lines[0].indent);
  return isObject(v) ? v : {};
}

// ---- a TOML subset: tables, arrays of tables, dotted and quoted keys, strings (basic, literal, multi-line), arrays,
// inline tables; numbers, booleans and dates are kept as the text they were written with. ----

const isSpace = (c) => c === " " || c === "\t";
const isBare = (c) => /^[A-Za-z0-9_-]$/.test(c);

/** Past blanks, newlines and # comments. */
function tomlSkip(s, p, newlines) {
  while (p < s.length) {
    const c = s[p];
    if (isSpace(c) || (newlines && (c === "\n" || c === "\r"))) p++;
    else if (c === "#") { while (p < s.length && s[p] !== "\n") p++; }
    else break;
  }
  return p;
}
const tomlLineEnd = (s, p) => { while (p < s.length && s[p] !== "\n") p++; return p; };

/** A basic ("...") string's escapes. */
function tomlUnescape(raw) {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== "\\" || i + 1 >= raw.length) { out += c; continue; }
    const n = raw[++i];
    if (n === "n") out += "\n";
    else if (n === "t") out += "\t";
    else if (n === "r") out += "\r";
    else if ((n === "u" || n === "U") && /^[0-9A-Fa-f]+$/.test(raw.slice(i + 1, i + 1 + (n === "u" ? 4 : 8)))) {
      const len = n === "u" ? 4 : 8;
      const code = parseInt(raw.slice(i + 1, i + 1 + len), 16);
      out += code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
      i += len;
    } else if (n === "\n") { while (i + 1 < raw.length && /\s/.test(raw[i + 1])) i++; }   // a line-ending backslash joins lines
    else out += n;
  }
  return out;
}

/** One value starting at p: { value, p } with p just past it, or null when nothing readable is there. */
function tomlValue(s, p) {
  p = tomlSkip(s, p, false);
  if (p >= s.length) return null;
  const c = s[p];
  if (s.startsWith('"""', p) || s.startsWith("'''", p)) {
    const q = s.slice(p, p + 3);
    const end = s.indexOf(q, p + 3);
    if (end === -1) return null;
    let raw = s.slice(p + 3, end);
    if (raw.startsWith("\n")) raw = raw.slice(1);
    return { value: c === '"' ? tomlUnescape(raw) : raw, p: end + 3 };
  }
  if (c === '"') {
    let e = p + 1;
    while (e < s.length && s[e] !== '"' && s[e] !== "\n") e += s[e] === "\\" ? 2 : 1;
    if (e >= s.length || s[e] !== '"') return null;
    return { value: tomlUnescape(s.slice(p + 1, e)), p: e + 1 };
  }
  if (c === "'") {
    const e = s.indexOf("'", p + 1);
    if (e === -1 || s.slice(p + 1, e).includes("\n")) return null;
    return { value: s.slice(p + 1, e), p: e + 1 };
  }
  if (c === "[") {
    const out = [];
    p++;
    for (;;) {
      p = tomlSkip(s, p, true);
      if (p >= s.length) return null;
      if (s[p] === "]") return { value: out, p: p + 1 };
      const v = tomlValue(s, p);
      if (v === null) return null;
      out.push(v.value);
      p = tomlSkip(s, v.p, true);
      if (s[p] === ",") p++;
      else if (s[p] !== "]") return null;
    }
  }
  if (c === "{") {
    const out = {};
    p++;
    for (;;) {
      p = tomlSkip(s, p, true);
      if (p >= s.length) return null;
      if (s[p] === "}") return { value: out, p: p + 1 };
      const k = tomlKey(s, p);
      if (k === null) return null;
      p = tomlSkip(s, k.p, false);
      if (s[p] !== "=") return null;
      const v = tomlValue(s, p + 1);
      if (v === null) return null;
      tomlSet(out, k.parts, v.value);
      p = tomlSkip(s, v.p, true);
      if (s[p] === ",") p++;
      else if (s[p] !== "}") return null;
    }
  }
  // a number, boolean or date: kept as written
  let e = p;
  while (e < s.length && !",]}#\n\r".includes(s[e])) e++;
  const raw = s.slice(p, e).trim();
  return raw === "" ? null : { value: raw, p: e };
}

/** A key, possibly dotted (a.b."c d"): { parts, p }, or null. */
function tomlKey(s, p) {
  const parts = [];
  for (;;) {
    p = tomlSkip(s, p, false);
    if (s[p] === '"' || s[p] === "'") {
      const v = tomlValue(s, p);
      if (v === null || typeof v.value !== "string") return null;
      parts.push(v.value);
      p = v.p;
    } else {
      let e = p;
      while (e < s.length && isBare(s[e])) e++;
      if (e === p) return null;
      parts.push(s.slice(p, e));
      p = e;
    }
    p = tomlSkip(s, p, false);
    if (s[p] !== ".") return { parts, p };
    p++;
  }
}

/** The table a path leads to, made on the way; the last table of an array of tables stands for it. */
function tomlWalk(root, parts) {
  let cur = root;
  for (const k of parts) {
    if (k === "__proto__") return null;
    if (!Object.prototype.hasOwnProperty.call(cur, k) || cur[k] === null || typeof cur[k] !== "object") cur[k] = {};
    cur = cur[k];
    if (Array.isArray(cur)) {
      if (!cur.length || !isObject(cur[cur.length - 1])) cur.push({});
      cur = cur[cur.length - 1];
    }
  }
  return cur;
}
function tomlSet(table, parts, value) {
  const last = parts[parts.length - 1];
  const at = tomlWalk(table, parts.slice(0, -1));
  if (at !== null && last !== "__proto__") at[last] = value;
}

export function parseToml(text) {
  const s = String(text).replace(/\r\n?/g, "\n");
  const root = {};
  let table = root;
  let p = 0;
  while (p < s.length) {
    p = tomlSkip(s, p, true);
    if (p >= s.length) break;
    if (s[p] === "[") {
      const list = s[p + 1] === "[";
      const k = tomlKey(s, p + (list ? 2 : 1));
      const close = k === null ? -1 : tomlSkip(s, k.p, false);
      if (k === null || !s.startsWith(list ? "]]" : "]", close)) { p = tomlLineEnd(s, p); continue; }
      if (list) {
        const parent = tomlWalk(root, k.parts.slice(0, -1));
        const name = k.parts[k.parts.length - 1];
        if (parent !== null && name !== "__proto__") {
          if (!Object.prototype.hasOwnProperty.call(parent, name) || !Array.isArray(parent[name])) parent[name] = [];
          table = {};
          parent[name].push(table);
        }
      } else {
        const t = tomlWalk(root, k.parts);
        if (t !== null) table = t;
      }
      p = tomlLineEnd(s, close);
      continue;
    }
    const k = tomlKey(s, p);
    const eq = k === null ? -1 : tomlSkip(s, k.p, false);
    const v = k !== null && s[eq] === "=" ? tomlValue(s, eq + 1) : null;
    if (v === null) { p = tomlLineEnd(s, p); continue; }
    tomlSet(table, k.parts, v.value);
    p = tomlLineEnd(s, v.p);
  }
  return root;
}

// ---- JSON, with every scalar as a string like the other two ----

function stringify(v) {
  if (Array.isArray(v)) return v.map(stringify);
  if (isObject(v)) { const out = {}; for (const k of Object.keys(v)) if (k !== "__proto__") out[k] = stringify(v[k]); return out; }
  return v === null ? null : String(v);
}
export function parseJson(text) {
  let v;
  try { v = JSON.parse(String(text)); } catch { return null; }
  return isObject(v) ? stringify(v) : null;
}

/** Where the JSON object that opens the text ends (just past its closing brace), or -1. */
function jsonEnd(s) {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) { if (c === "\\") i++; else if (c === '"') inString = false; continue; }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return i + 1; }
  }
  return -1;
}

// ---- pages ----

/** A page as { format, data, body }: front matter between --- (YAML) or +++ (TOML) lines, or a leading JSON object. */
export function split(text) {
  const raw = String(text ?? "").replace(/\r\n?/g, "\n");
  const s = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;   // without a byte order mark
  for (const [mark, format] of [["---", "yaml"], ["+++", "toml"]]) {
    if (!s.startsWith(mark)) continue;
    const open = s.indexOf("\n");
    if (open === -1 || s.slice(mark.length, open).trim() !== "") continue;
    // the closing line is the next line that is only the marker
    let at = open;
    while (at !== -1) {
      const lineEnd = s.indexOf("\n", at + 1);
      const line = s.slice(at + 1, lineEnd === -1 ? s.length : lineEnd);
      if (line.trim() === mark && line.startsWith(mark)) {
        const inner = s.slice(open + 1, at + 1);
        return { format, data: format === "yaml" ? parseYaml(inner) : parseToml(inner), body: lineEnd === -1 ? "" : s.slice(lineEnd + 1) };
      }
      at = lineEnd;
    }
  }
  if (s.startsWith("{")) {
    const end = jsonEnd(s);
    const data = end === -1 ? null : parseJson(s.slice(0, end));
    if (data !== null) return { format: "json", data, body: s.slice(end).replace(/^[ \t]*\n/, "") };
  }
  return { format: "none", data: {}, body: s };
}

export default {
  contracts: {
    "import-frontmatter.data": {
      /**
       * Implements contract import-frontmatter.data, operation split.
       *
       * Splits a page into its front matter, as data, and the body after it. The front matter is YAML between ---
       * lines, TOML between +++ lines, or a JSON object at the top; a page with none comes back whole as the body.
       *
       * @param {object} ctx    Platform context (spec/13); nothing is fetched, read or stored.
       * @param {object} input  { text } for one page, or { texts: [..] } for many in one call.
       * @returns {Promise<object>}  { format, data, body }, or { results: [{ format, data, body }, ..] } for texts.
       */
      async split(ctx, input) {
        input = input || {};
        if (Array.isArray(input.texts)) return { results: input.texts.map((t) => split(typeof t === "string" ? t : "")) };
        return split(typeof input.text === "string" ? input.text : "");
      },
      /**
       * Implements contract import-frontmatter.data, operation parse.
       *
       * Reads a whole configuration text (a site's hugo.toml, _config.yml, config.json) as data.
       *
       * @param {object} ctx    Platform context (spec/13); nothing is fetched, read or stored.
       * @param {object} input  { format: yaml | toml | json, text }.
       * @returns {Promise<object>}  { data } or { error }.
       */
      async parse(ctx, input) {
        input = input || {};
        const text = typeof input.text === "string" ? input.text : "";
        if (input.format === "yaml") return { data: parseYaml(text) };
        if (input.format === "toml") return { data: parseToml(text) };
        if (input.format === "json") { const data = parseJson(text); return data === null ? { error: "the text is not a JSON object" } : { data }; }
        return { error: "format must be yaml, toml or json" };
      },
    },
  },
};
