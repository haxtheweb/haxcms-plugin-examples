import { fixture, expect, html } from "@open-wc/testing";
import "../frontend/dist/site-announcement-bar.js";
describe("site-announcement-bar", () => {
  beforeEach(() => { try { localStorage.removeItem("haxcms-announcement-dismissed:s1"); } catch (e) {} });

  it("shows the heading, text and link in a labelled region", async () => {
    const el = await fixture(html`<site-announcement-bar site="s1" heading="Heads up:" text="Closed Friday." link="/hours" link-text="See hours"></site-announcement-bar>`);
    const region = el.shadowRoot.querySelector('[role="region"]');
    expect(region.getAttribute("aria-label")).to.equal("Announcement");
    expect(region.querySelector("strong").textContent).to.equal("Heads up:");
    expect(region.querySelector("a").getAttribute("href")).to.equal("/hours");
    expect(el.hidden).to.equal(false);
  });

  it("stays dismissed for the same announcement, and shows a changed one", async () => {
    const el = await fixture(html`<site-announcement-bar site="s1" text="One"></site-announcement-bar>`);
    el.shadowRoot.querySelector("button").click();
    expect(el.hidden).to.equal(true);
    const again = await fixture(html`<site-announcement-bar site="s1" text="One"></site-announcement-bar>`);
    expect(again.hidden).to.equal(true);
    const changed = await fixture(html`<site-announcement-bar site="s1" text="Two"></site-announcement-bar>`);
    expect(changed.hidden).to.equal(false);
  });

  it("hides after its end date and drops unsafe links", async () => {
    const past = await fixture(html`<site-announcement-bar site="s1" text="Old" ends="2000-01-01"></site-announcement-bar>`);
    expect(past.hidden).to.equal(true);
    const el = await fixture(html`<site-announcement-bar site="s1" text="x" link="javascript:alert(1)"></site-announcement-bar>`);
    expect(el.shadowRoot.querySelector("a")).to.equal(null);
  });
});
