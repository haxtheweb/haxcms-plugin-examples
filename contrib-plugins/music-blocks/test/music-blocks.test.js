// Element tests in the webcomponents monorepo style (web-test-runner + @open-wc/testing). Run with:
//   npx web-test-runner "test/**/*.test.js" --node-resolve
import { fixture, expect, html } from "@open-wc/testing";
import "../frontend/dist/music-staff.js";
import "../frontend/dist/music-chord-chart.js";

describe("music-staff", () => {
  it("draws one note head per valid note and ignores the rest", async () => {
    const el = await fixture(html`<music-staff notes="C4 D4 X9 E4"></music-staff>`);
    expect(el.querySelectorAll("ellipse").length).to.equal(3);
  });
  it("has an accessible name", async () => {
    const el = await fixture(html`<music-staff notes="E4 G4"></music-staff>`);
    expect(el.querySelector("svg").getAttribute("aria-label")).to.equal("Melody: E4 G4");
    await expect(el).to.be.accessible();
  });
});

describe("music-chord-chart", () => {
  it("lists each chord, escaped", async () => {
    const el = await fixture(html`<music-chord-chart chords="G D <b>Em</b>"></music-chord-chart>`);
    expect([...el.querySelectorAll("li")].map((li) => li.textContent)).to.deep.equal(["G", "D", "<b>Em</b>"]);
    await expect(el).to.be.accessible();
  });
});
