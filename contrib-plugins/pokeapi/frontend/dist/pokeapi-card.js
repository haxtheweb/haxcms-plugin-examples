// pokeapi-card: one Pokémon as an interactive trading-style card. Front: artwork, name, number, kind, types, HP and a
// line from the games. Back: base stats, abilities, height and weight. A flip button turns it, a cry button plays its
// call, and the card tilts toward a mouse pointer. Plain custom element (no build, no dependencies) so it hydrates on
// any HAX site, published or static. Data comes from PokeAPI in the reader's browser and is shaped by the same module
// the plugin's server uses (pokeapi-data.js).
import { toCard, STAT_MAX } from "./pokeapi-data.js";

const DEFAULT_BASE = "https://pokeapi.co/api/v2";
// a name or number PokeAPI can answer: it refuses paths with . , * % ; : ' ! @ + [
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// PokeAPI's 18 types, each with its own hue; the type's name is always written next to its color
const TYPE_COLORS = {
  normal: "#a8a77a", fire: "#ee8130", water: "#6390f0", electric: "#f7d02c", grass: "#7ac74c", ice: "#96d9d6",
  fighting: "#c22e28", poison: "#a33ea1", ground: "#e2bf65", flying: "#a98ff3", psychic: "#f95587", bug: "#a6b91a",
  rock: "#b6a136", ghost: "#735797", dragon: "#6f35fc", dark: "#705746", steel: "#b7b7ce", fairy: "#d685ad",
};
const LABELS = {
  loading: "Loading {name}…",
  error: "Could not load “{name}”. Check the name or number.",
  empty: "Choose a Pokémon by name or number.",
  hp: "HP",
  number: "Number {n}",
  artwork: "Artwork of {name}",
  showBack: "Show stats",
  showFront: "Show front",
  cry: "Play cry",
  stats: "Base stats",
  abilities: "Abilities",
  hidden: "hidden",
  height: "Height",
  weight: "Weight",
  types: "Types",
};
// shaped cards per address, name and language, for this page (and this tab, when storage allows)
const memory = new Map();

function fill(s, values) {
  return String(s).replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
/** Only http(s) addresses reach the page: artwork and cries come from data, so anything else is dropped. */
function safeUrl(u) {
  try {
    const url = new URL(String(u), document.baseURI);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch (e) {
    return "";
  }
}
function normalizeName(v) {
  return String(v == null ? "" : v).trim().toLowerCase().replace(/\s+/g, "-").replace(/^#?0*(?=\d)/, "");
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/** The card for a name, from memory, this tab's storage, or PokeAPI (pokemon, then its species for words). */
export async function loadCard(base, name, lang) {
  const key = `pokeapi-card:${base}|${name}|${lang}`;
  if (memory.has(key)) return memory.get(key);
  let stored = null;
  try { stored = JSON.parse(sessionStorage.getItem(key) || "null"); } catch (e) { stored = null; }
  if (stored && stored.id) { memory.set(key, Promise.resolve(stored)); return stored; }
  const p = (async () => {
    const pokemon = await getJson(`${base}/pokemon/${encodeURIComponent(name)}/`);
    const speciesId = (pokemon && pokemon.species && /\/(\d+)\/?$/.exec(String(pokemon.species.url || ""))) || null;
    let species = null;
    try { species = await getJson(`${base}/pokemon-species/${speciesId ? speciesId[1] : encodeURIComponent(name)}/`); } catch (e) { species = null; }
    const card = toCard(pokemon, species, lang);
    try { sessionStorage.setItem(key, JSON.stringify(card)); } catch (e) { /* storage full or blocked */ }
    return card;
  })();
  memory.set(key, p);
  p.catch(() => memory.delete(key));
  return p;
}

const STYLE = `
:host {
  display: block;
  width: var(--pokeapi-card-width, 320px);
  max-width: 100%;
  margin: var(--ddd-spacing-4, 16px) auto;
  font-family: var(--ddd-font-navigation, system-ui, sans-serif);
  --_type: var(--pokeapi-card-type, #a8a77a);
  --_surface: light-dark(var(--ddd-theme-default-white, #fff), var(--ddd-theme-default-coalyGray, #262626));
  --_text: light-dark(var(--ddd-theme-default-coalyGray, #262626), var(--ddd-theme-default-white, #fff));
  --_muted: light-dark(var(--ddd-theme-default-slateGray, #666), var(--ddd-theme-default-limestoneGray, #ccc));
  --_line: light-dark(var(--ddd-theme-default-limestoneGray, #e4e5e7), var(--ddd-theme-default-slateGray, #5c5c5c));
  --_focus: var(--ddd-theme-default-skyBlue, #009cde);
  color: var(--_text);
}
:host([hidden]) { display: none; }
* { box-sizing: border-box; }
.tilt {
  perspective: 1000px;
  transform: rotateX(var(--_rx, 0deg)) rotateY(var(--_ry, 0deg));
  transition: transform 0.2s ease-out;
}
.card {
  position: relative;
  display: grid;
  transform-style: preserve-3d;
  transition: transform 0.5s cubic-bezier(0.2, 0.7, 0.3, 1);
}
:host([flipped]) .card { transform: rotateY(180deg); }
.face {
  grid-area: 1 / 1;
  display: flex;
  flex-direction: column;
  gap: var(--ddd-spacing-2, 8px);
  padding: var(--ddd-spacing-3, 12px);
  border: var(--ddd-border-md, 4px solid) var(--_type);
  border-radius: var(--ddd-radius-lg, 16px);
  background: linear-gradient(160deg, color-mix(in srgb, var(--_type) 26%, var(--_surface)) 0%, var(--_surface) 55%);
  box-shadow: var(--ddd-boxShadow-md, 0 4px 12px rgba(0, 0, 0, 0.18));
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  overflow: hidden;
}
.back { transform: rotateY(180deg); }
.sheen {
  pointer-events: none;
  position: absolute;
  inset: 0;
  border-radius: var(--ddd-radius-lg, 16px);
  background: radial-gradient(circle at var(--_sx, 50%) var(--_sy, 0%), rgba(255, 255, 255, 0.28), transparent 55%);
  opacity: var(--_so, 0);
  transition: opacity 0.2s;
}
.top { display: flex; align-items: baseline; justify-content: space-between; gap: var(--ddd-spacing-2, 8px); }
.name { margin: 0; font-size: var(--ddd-font-size-s, 20px); font-weight: var(--ddd-font-weight-bold, 700); line-height: 1.2; }
.hp { font-weight: var(--ddd-font-weight-bold, 700); font-size: var(--ddd-font-size-xs, 18px); white-space: nowrap; }
.hp small { font-size: var(--ddd-font-size-4xs, 14px); margin-inline-end: var(--ddd-spacing-1, 4px); color: var(--_muted); }
.art {
  aspect-ratio: 1;
  display: grid;
  place-items: center;
  border-radius: var(--ddd-radius-md, 8px);
  border: var(--ddd-border-xs, 1px solid) var(--_line);
  background: radial-gradient(circle, color-mix(in srgb, var(--_type) 40%, var(--_surface)) 0%, color-mix(in srgb, var(--_type) 12%, var(--_surface)) 70%);
}
.art img { width: 88%; height: 88%; object-fit: contain; filter: drop-shadow(0 6px 8px rgba(0, 0, 0, 0.25)); }
.meta { margin: 0; font-size: var(--ddd-font-size-4xs, 14px); color: var(--_muted); }
.types { display: flex; flex-wrap: wrap; gap: var(--ddd-spacing-1, 4px); margin: 0; padding: 0; list-style: none; }
.type {
  display: inline-flex; align-items: center; gap: var(--ddd-spacing-1, 4px);
  padding: 2px var(--ddd-spacing-2, 8px);
  border-radius: var(--ddd-radius-circle, 100px);
  border: var(--ddd-border-xs, 1px solid) var(--_line);
  background: var(--_surface);
  font-size: var(--ddd-font-size-4xs, 14px);
}
.type i { width: 10px; height: 10px; border-radius: 50%; background: var(--_c); border: 1px solid rgba(0, 0, 0, 0.35); }
.flavor { margin: 0; font-size: var(--ddd-font-size-4xs, 14px); line-height: 1.5; font-style: italic; }
.label { margin: 0; font-size: var(--ddd-font-size-4xs, 14px); font-weight: var(--ddd-font-weight-bold, 700); text-transform: uppercase; letter-spacing: 0.04em; color: var(--_muted); }
.stats { display: grid; gap: var(--ddd-spacing-1, 4px); margin: 0; }
.stat { display: grid; grid-template-columns: 7.5em 2.5em 1fr; align-items: center; gap: var(--ddd-spacing-2, 8px); font-size: var(--ddd-font-size-4xs, 14px); }
.stat dt, .stat dd { margin: 0; }
.stat dd.num { text-align: end; font-variant-numeric: tabular-nums; font-weight: var(--ddd-font-weight-bold, 700); }
.bar { height: 8px; border-radius: 4px; background: var(--_line); overflow: hidden; }
.bar span { display: block; height: 100%; width: var(--_v); background: var(--_type); border-radius: 4px; }
.abilities { margin: 0; padding-inline-start: var(--ddd-spacing-5, 20px); font-size: var(--ddd-font-size-4xs, 14px); }
.facts { display: grid; grid-template-columns: auto 1fr; gap: 2px var(--ddd-spacing-3, 12px); margin: 0; font-size: var(--ddd-font-size-4xs, 14px); }
.facts dt { color: var(--_muted); }
.facts dd { margin: 0; }
.actions { display: flex; gap: var(--ddd-spacing-2, 8px); justify-content: center; margin-top: var(--ddd-spacing-3, 12px); }
button {
  font: inherit; font-size: var(--ddd-font-size-4xs, 14px); font-weight: var(--ddd-font-weight-medium, 500);
  padding: var(--ddd-spacing-1, 4px) var(--ddd-spacing-3, 12px);
  min-height: 36px;
  border-radius: var(--ddd-radius-sm, 4px);
  border: var(--ddd-border-sm, 2px solid) var(--_text);
  background: var(--_surface);
  color: var(--_text);
  cursor: pointer;
}
button:hover { background: color-mix(in srgb, var(--_type) 22%, var(--_surface)); }
button:focus-visible { outline: var(--ddd-border-md, 4px solid) var(--_focus); outline-offset: 2px; }
button:disabled { opacity: 0.5; cursor: not-allowed; }
.status {
  display: grid; place-items: center; min-height: 160px; padding: var(--ddd-spacing-4, 16px); text-align: center;
  border: var(--ddd-border-sm, 2px dashed) var(--_line); border-radius: var(--ddd-radius-lg, 16px);
  font-size: var(--ddd-font-size-4xs, 14px); color: var(--_muted);
}
@media (prefers-reduced-motion: reduce) {
  .tilt, .card, .sheen { transition: none; }
  .tilt { transform: none; }
  .sheen { display: none; }
}
@media (forced-colors: active) {
  .face { border-color: CanvasText; background: Canvas; }
  .bar span, .type i { background: CanvasText; }
}
`;

class PokeapiCard extends HTMLElement {
  static get tag() { return "pokeapi-card"; }
  static get observedAttributes() { return ["pokemon", "lang", "api-base", "flipped"]; }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.t = { ...LABELS };
    this.card = null;
    this._token = 0;
    this._onMove = this._onMove.bind(this);
    this._onLeave = this._onLeave.bind(this);
  }

  get pokemon() { return this.getAttribute("pokemon") || ""; }
  set pokemon(v) { this.setAttribute("pokemon", String(v)); }
  get flipped() { return this.hasAttribute("flipped"); }
  set flipped(v) { this.toggleAttribute("flipped", !!v); }
  get apiBase() { return String(this.getAttribute("api-base") || DEFAULT_BASE).trim().replace(/\/+$/, ""); }
  /** PokeAPI's language code for the card's words: the lang attribute, else the page's, else English. */
  get langCode() {
    const lang = String(this.getAttribute("lang") || document.documentElement.lang || "en").toLowerCase().replace(/_/g, "-");
    if (lang.indexOf("zh") === 0) return /hant|tw|hk|mo/.test(lang) ? "zh-hant" : "zh-hans";
    return lang.split("-")[0] || "en";
  }

  connectedCallback() {
    this.addEventListener("pointermove", this._onMove);
    this.addEventListener("pointerleave", this._onLeave);
    this._load();
  }
  disconnectedCallback() {
    this.removeEventListener("pointermove", this._onMove);
    this.removeEventListener("pointerleave", this._onLeave);
  }
  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue || !this.isConnected) return;
    if (name === "flipped") this._syncFlip();
    else this._load();
  }

  /** Turns the card over. Fires pokeapi-card-flip with { flipped }. */
  flip() {
    this.flipped = !this.flipped;
    this.dispatchEvent(new CustomEvent("pokeapi-card-flip", { bubbles: true, composed: true, detail: { flipped: this.flipped } }));
  }

  /** Plays the Pokémon's cry, when PokeAPI has one. */
  playCry() {
    const src = this.card ? safeUrl(this.card.cry) : "";
    if (!src) return;
    if (this._audio) this._audio.pause();
    this._audio = new Audio(src);
    this._audio.volume = 0.5;
    const played = this._audio.play();
    if (played && played.catch) played.catch(() => {});
  }

  async _load() {
    const token = ++this._token;
    const name = normalizeName(this.pokemon);
    this.card = null;
    if (name === "") return this._status(this.t.empty);
    if (!NAME.test(name)) return this._status(fill(this.t.error, { name: this.pokemon }), true);
    this._status(fill(this.t.loading, { name: this.pokemon }));
    try {
      const card = await loadCard(this.apiBase, name, this.langCode);
      if (token !== this._token) return;
      this.card = card;
      this._render();
      this.dispatchEvent(new CustomEvent("pokeapi-card-loaded", { bubbles: true, composed: true, detail: { id: card.id, name: card.name } }));
    } catch (e) {
      if (token !== this._token) return;
      this._status(fill(this.t.error, { name: this.pokemon }), true);
    }
  }

  _status(message, isError) {
    this.shadowRoot.innerHTML = `<style>${STYLE}</style><div class="status" role="${isError ? "alert" : "status"}">${esc(message)}</div>`;
  }

  _render() {
    const c = this.card;
    const t = this.t;
    const primary = c.types[0] || "normal";
    this.style.setProperty("--pokeapi-card-type", TYPE_COLORS[primary] || TYPE_COLORS.normal);
    const number = `#${String(c.id).padStart(3, "0")}`;
    const img = safeUrl(c.image);
    const types = c.types.map((ty) => `<li class="type"><i style="--_c:${TYPE_COLORS[ty] || TYPE_COLORS.normal}" aria-hidden="true"></i>${esc(ty.charAt(0).toUpperCase() + ty.slice(1))}</li>`).join("");
    const stats = c.stats.map((s) => `<div class="stat"><dt>${esc(s.label)}</dt><dd class="num">${s.value}</dd><dd class="bar" aria-hidden="true"><span style="--_v:${Math.min(100, Math.round((s.value / STAT_MAX) * 100))}%"></span></dd></div>`).join("");
    const abilities = c.abilities.map((a) => `<li>${esc(a.name)}${a.hidden ? ` <small>(${esc(t.hidden)})</small>` : ""}</li>`).join("");
    this.shadowRoot.innerHTML = `<style>${STYLE}</style>
<div class="tilt" part="tilt">
  <article class="card" part="card" aria-labelledby="name" aria-roledescription="card">
    <section class="face front" part="front">
      <div class="top"><p class="name" id="name">${esc(c.title)}</p><p class="hp"><small>${esc(t.hp)}</small>${c.hp}</p></div>
      <div class="art">${img ? `<img src="${esc(img)}" alt="${esc(fill(t.artwork, { name: c.title }))}" loading="lazy" decoding="async">` : ""}</div>
      <p class="meta"><span aria-label="${esc(fill(t.number, { n: c.id }))}">${esc(number)}</span>${c.genus ? ` · ${esc(c.genus)}` : ""}</p>
      <ul class="types" aria-label="${esc(t.types)}">${types}</ul>
      ${c.flavor ? `<p class="flavor">${esc(c.flavor)}</p>` : ""}
    </section>
    <section class="face back" part="back">
      <div class="top"><p class="name">${esc(c.title)}</p><p class="hp"><small>${esc(t.hp)}</small>${c.hp}</p></div>
      <p class="label" id="stats-label">${esc(t.stats)}</p>
      <dl class="stats" aria-labelledby="stats-label">${stats}</dl>
      ${abilities ? `<p class="label" id="abilities-label">${esc(t.abilities)}</p><ul class="abilities" aria-labelledby="abilities-label">${abilities}</ul>` : ""}
      <dl class="facts"><dt>${esc(t.height)}</dt><dd>${c.heightM} m</dd><dt>${esc(t.weight)}</dt><dd>${c.weightKg} kg</dd></dl>
    </section>
    <div class="sheen" aria-hidden="true"></div>
  </article>
</div>
<div class="actions">
  <button type="button" class="flip" part="button" aria-pressed="false"></button>
  <button type="button" class="cry" part="button"${safeUrl(c.cry) ? "" : " disabled"}>${esc(t.cry)}</button>
</div>`;
    this.shadowRoot.querySelector(".flip").addEventListener("click", () => this.flip());
    this.shadowRoot.querySelector(".cry").addEventListener("click", () => this.playCry());
    this._syncFlip();
  }

  /** The face turned away is inert, so keyboard and screen reader users only meet the side they can see. */
  _syncFlip() {
    const root = this.shadowRoot;
    const front = root.querySelector(".front");
    const back = root.querySelector(".back");
    const button = root.querySelector(".flip");
    if (!front || !back || !button) return;
    front.inert = this.flipped;
    back.inert = !this.flipped;
    button.setAttribute("aria-pressed", String(this.flipped));
    button.textContent = this.flipped ? this.t.showFront : this.t.showBack;
  }

  _onMove(e) {
    if (e.pointerType !== "mouse" || !this.card) return;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const tilt = this.shadowRoot.querySelector(".tilt");
    if (!tilt) return;
    const r = tilt.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    tilt.style.setProperty("--_ry", `${((x - 0.5) * 12).toFixed(2)}deg`);
    tilt.style.setProperty("--_rx", `${((0.5 - y) * 12).toFixed(2)}deg`);
    tilt.style.setProperty("--_sx", `${Math.round(x * 100)}%`);
    tilt.style.setProperty("--_sy", `${Math.round(y * 100)}%`);
    tilt.style.setProperty("--_so", "1");
  }
  _onLeave() {
    const tilt = this.shadowRoot.querySelector(".tilt");
    if (!tilt) return;
    for (const p of ["--_rx", "--_ry", "--_sx", "--_sy", "--_so"]) tilt.style.removeProperty(p);
  }
}

if (!customElements.get(PokeapiCard.tag)) customElements.define(PokeapiCard.tag, PokeapiCard);
export { PokeapiCard };
