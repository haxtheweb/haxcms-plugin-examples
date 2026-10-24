import { fixture, expect, html } from "@open-wc/testing";
import "../frontend/dist/dark-mode-toggle.js";
describe("dark-mode-toggle", () => {
  it("starts in the default scheme and toggles with aria-pressed", async () => {
    try { localStorage.removeItem("hax-color-scheme"); } catch (e) {}
    const el = await fixture(html`<dark-mode-toggle default="light"></dark-mode-toggle>`);
    const b = el.querySelector("button");
    expect(b.getAttribute("aria-pressed")).to.equal("false");
    b.click();
    expect(document.documentElement.dataset.colorScheme).to.equal("dark");
    expect(b.getAttribute("aria-pressed")).to.equal("true");
  });
});
