// Element tests in the webcomponents monorepo style (web-test-runner + @open-wc/testing). Run with:
//   npx web-test-runner "test/**/*.test.js" --node-resolve
// fetch is stubbed with small PokeAPI-shaped answers, so nothing reaches the network.
import { fixture, expect, html, waitUntil } from "@open-wc/testing";
import { toCard, searchIndex } from "../frontend/dist/pokeapi-data.js";
import "../frontend/dist/pokeapi-card.js";

const ART = "https://example.invalid/artwork/25.png";
const POKEMON = {
  id: 25,
  name: "pikachu",
  height: 4,
  weight: 60,
  species: { url: "https://pokeapi.co/api/v2/pokemon-species/25/" },
  types: [{ slot: 1, type: { name: "electric" } }],
  stats: [{ base_stat: 35, stat: { name: "hp" } }, { base_stat: 55, stat: { name: "attack" } }, { base_stat: 90, stat: { name: "speed" } }],
  abilities: [{ slot: 3, is_hidden: true, ability: { name: "lightning-rod" } }, { slot: 1, is_hidden: false, ability: { name: "static" } }],
  sprites: { other: { "official-artwork": { front_default: ART } } },
  cries: { latest: "https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest/25.ogg" },
};
const SPECIES = {
  names: [{ language: { name: "en" }, name: "Pikachu" }, { language: { name: "fr" }, name: "Pikachu" }],
  genera: [{ language: { name: "en" }, genus: "Mouse Pokémon" }, { language: { name: "fr" }, genus: "Pokémon Souris" }],
  flavor_text_entries: [
    { language: { name: "en" }, flavor_text: "Old\ftext." },
    { language: { name: "en" }, flavor_text: "When several of\nthese gather, their\felectricity can build." },
    { language: { name: "fr" }, flavor_text: "Texte en\nfrançais." },
  ],
};

let calls = [];
const realFetch = window.fetch;
beforeEach(() => {
  calls = [];
  try { sessionStorage.clear(); } catch (e) { /* blocked */ }
  window.fetch = async (url) => {
    calls.push(String(url));
    const u = String(url);
    const body = /pokemon-species\/25\/$/.test(u) ? SPECIES : /pokemon\/(pikachu|25)\/$/.test(u) ? POKEMON : null;
    return { ok: !!body, status: body ? 200 : 404, json: async () => body };
  };
});
afterEach(() => { window.fetch = realFetch; });

const loaded = (el) => waitUntil(() => el.shadowRoot.querySelector(".card") || el.shadowRoot.querySelector("[role=alert]"), "card did not render");

describe("pokeapi-data", () => {
  it("shapes a card: localized words, cleaned flavor text, sorted abilities, metric units", () => {
    const c = toCard(POKEMON, SPECIES, "en");
    expect(c.title).to.equal("Pikachu");
    expect(c.genus).to.equal("Mouse Pokémon");
    expect(c.flavor).to.equal("When several of these gather, their electricity can build.");
    expect(c.abilities.map((a) => a.name)).to.deep.equal(["Static", "Lightning Rod"]);
    expect([c.heightM, c.weightKg, c.hp]).to.deep.equal([0.4, 6, 35]);
    expect(toCard(POKEMON, SPECIES, "fr").genus).to.equal("Pokémon Souris");
    expect(toCard(POKEMON, SPECIES, "ko").genus).to.equal("Mouse Pokémon");
  });
  it("searches names, numbers and spaced names", () => {
    const list = { results: [{ name: "pikachu", url: "/pokemon/25/" }, { name: "mr-mime", url: "/pokemon/122/" }] };
    expect(searchIndex(list, "Mr Mime", 1).items[0].name).to.equal("mr-mime");
    expect(searchIndex(list, "25", 1).items[0].name).to.equal("pikachu");
  });
});

describe("pokeapi-card", () => {
  it("renders the front from PokeAPI and is accessible", async () => {
    const el = await fixture(html`<pokeapi-card pokemon="Pikachu"></pokeapi-card>`);
    await loaded(el);
    const root = el.shadowRoot;
    expect(root.querySelector(".name").textContent).to.equal("Pikachu");
    expect(root.querySelector(".hp").textContent).to.equal("HP35");
    expect(root.querySelector(".art img").getAttribute("alt")).to.equal("Artwork of Pikachu");
    expect(root.querySelector(".type").textContent).to.equal("Electric");
    expect(calls).to.deep.equal(["https://pokeapi.co/api/v2/pokemon/pikachu/", "https://pokeapi.co/api/v2/pokemon-species/25/"]);
    await expect(el).shadowDom.to.be.accessible();
  });
  it("flips with the button: only the visible face is reachable", async () => {
    const el = await fixture(html`<pokeapi-card pokemon="25"></pokeapi-card>`);
    await loaded(el);
    const root = el.shadowRoot;
    const button = root.querySelector(".flip");
    expect(root.querySelector(".back").inert).to.equal(true);
    button.click();
    expect(el.flipped).to.equal(true);
    expect(button.getAttribute("aria-pressed")).to.equal("true");
    expect(button.textContent).to.equal("Show front");
    expect(root.querySelector(".front").inert).to.equal(true);
    expect(root.querySelector(".back").inert).to.equal(false);
    expect([...root.querySelectorAll(".stat dt")].map((d) => d.textContent)).to.deep.equal(["HP", "Attack", "Speed"]);
    await expect(el).shadowDom.to.be.accessible();
  });
  it("loads each Pokémon once per page", async () => {
    await loaded(await fixture(html`<pokeapi-card pokemon="pikachu" lang="en"></pokeapi-card>`));
    const before = calls.length;
    await loaded(await fixture(html`<pokeapi-card pokemon="pikachu" lang="en"></pokeapi-card>`));
    expect(calls.length).to.equal(before);
  });
  it("says so when a name is unknown or not a name", async () => {
    const el = await fixture(html`<pokeapi-card pokemon="missingno"></pokeapi-card>`);
    await loaded(el);
    expect(el.shadowRoot.querySelector("[role=alert]").textContent).to.contain("missingno");
    const bad = await fixture(html`<pokeapi-card pokemon="../admin"></pokeapi-card>`);
    await loaded(bad);
    expect(calls.some((u) => u.indexOf("admin") !== -1)).to.equal(false);
  });
});
