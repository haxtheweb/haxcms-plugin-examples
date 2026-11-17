// Element tests in the webcomponents monorepo style (web-test-runner + @open-wc/testing). Run with:
//   npx web-test-runner "test/**/*.test.js" --node-resolve
import { fixture, expect, html } from "@open-wc/testing";
import "../frontend/dist/stripe-checkout-block.js";

describe("stripe-checkout-block", () => {
  // no valid button ID here, so the test never reaches out to js.stripe.com
  it("renders the Payment Link as a plain link", async () => {
    const el = await fixture(html`<stripe-checkout-block
      payment-link="https://buy.stripe.com/test_abc"
      label="Buy the workbook"
    ></stripe-checkout-block>`);
    const link = el.querySelector("a");
    expect(link.getAttribute("href")).to.equal("https://buy.stripe.com/test_abc");
    expect(link.textContent).to.equal("Buy the workbook");
    await expect(el).to.be.accessible();
  });

  it("ignores a fallback link that is not a Stripe Payment Link", async () => {
    const el = await fixture(html`<stripe-checkout-block
      payment-link="javascript:alert(1)"
    ></stripe-checkout-block>`);
    expect(el.querySelector("a")).to.equal(null);
  });

  it("refuses a secret key and never prints it", async () => {
    const el = await fixture(html`<stripe-checkout-block
      buy-button-id="buy_btn_1Abc"
      publishable-key="sk_live_SECRET123"
    ></stripe-checkout-block>`);
    expect(el.problem).to.equal("secret-key");
    expect(el.querySelector("[role=alert]")).to.exist;
    expect(el.innerHTML).to.not.contain("SECRET123");
    expect(await el.upgrade()).to.equal(false);
  });

  it("does not load Stripe without a valid button ID and publishable key", async () => {
    const el = await fixture(html`<stripe-checkout-block
      buy-button-id="nope"
      publishable-key="pk_test_Abc"
    ></stripe-checkout-block>`);
    expect(el.problem).to.equal("incomplete");
    expect(await el.upgrade()).to.equal(false);
    expect(document.querySelector('script[src*="js.stripe.com"]')).to.equal(null);
  });
});
