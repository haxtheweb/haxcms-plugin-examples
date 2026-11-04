import { fixture, expect, html } from "@open-wc/testing";
import "../frontend/dist/glossary-term.js";
describe("glossary-term", () => {
  it("shows the definition as text, never as markup", async () => {
    const el = await fixture(html`<glossary-term definition="<b>x</b>">API</glossary-term>`);
    expect(el.shadowRoot.querySelector("[role=tooltip]").textContent).to.equal("<b>x</b>");
  });
});
