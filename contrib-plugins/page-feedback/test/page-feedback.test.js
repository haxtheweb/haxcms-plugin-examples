// Element tests in the webcomponents monorepo style (web-test-runner + @open-wc/testing). Run with:
//   npx web-test-runner "test/**/*.test.js" --node-resolve
// fetch is stubbed, so nothing reaches the network.
import { fixture, expect, html, waitUntil, aTimeout } from "@open-wc/testing";
import "../frontend/dist/page-feedback.js";

const CONFIG = JSON.stringify({
  endpoint: "x/api/v1/plugins/page-feedback/feedback",
  pageId: "p1",
  question: "Did this page help?",
  yesLabel: "Yes",
  noLabel: "No",
  reasons: [{ id: "confusing", label: "Confusing" }, { id: "slow", label: "Too slow" }],
  allowComments: true,
  commentMaxLength: 200,
  anonymous: true,
});

let calls = [];
let answer = { ok: true, status: 200 };
let events = [];
const realFetch = globalThis.fetch;
const record = (e) => events.push({ type: e.type, detail: e.detail, composed: e.composed, bubbles: e.bubbles });

beforeEach(() => {
  calls = [];
  events = [];
  answer = { ok: true, status: 200 };
  try { sessionStorage.clear(); } catch (e) { /* blocked */ }
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (answer === "offline") throw new TypeError("Failed to fetch");
    return { ok: answer.ok, status: answer.status, json: async () => ({ received: true }) };
  };
  document.body.addEventListener("user-engagement", record);
  document.body.addEventListener("page-feedback-submit", record);
});
afterEach(() => {
  globalThis.fetch = realFetch;
  document.body.removeEventListener("user-engagement", record);
  document.body.removeEventListener("page-feedback-submit", record);
});

const $ = (el, sel) => el.shadowRoot.querySelector(sel);
const $$ = (el, sel) => [...el.shadowRoot.querySelectorAll(sel)];
const sent = (el) => waitUntil(() => !$(el, ".thanks").hidden, "the thank-you did not show");

describe("page-feedback", () => {
  it("starts with a question and two real buttons, and is accessible", async () => {
    const el = await fixture(html`<page-feedback></page-feedback>`);
    expect($(el, ".q").textContent).to.equal("Was this page helpful?");
    const buttons = $$(el, ".thumb");
    expect(buttons.map((b) => b.tagName + ":" + b.textContent + ":" + b.getAttribute("aria-pressed"))).to.deep.equal(["BUTTON:Yes:false", "BUTTON:No:false"]);
    expect(buttons.every((b) => b.querySelector("svg[aria-hidden=true]"))).to.equal(true);
    expect($(el, ".more").hidden).to.equal(true);
    expect($(el, ".thanks").hidden).to.equal(true);
    expect($(el, "[role=status]").getAttribute("aria-live")).to.equal("polite");
    await expect(el).shadowDom.to.be.accessible();
  });

  it("No shows the site's reasons as toggle buttons and an optional comment; state changes are announced", async () => {
    const el = await fixture(html`<page-feedback data-config=${CONFIG}></page-feedback>`);
    expect($(el, ".q").textContent).to.equal("Did this page help?");
    const no = $(el, ".down");
    no.focus();
    no.click();
    expect(no.getAttribute("aria-pressed")).to.equal("true");
    expect($(el, ".up").getAttribute("aria-pressed")).to.equal("false");
    expect(el.shadowRoot.activeElement).to.equal(no);
    expect($(el, ".why").hidden).to.equal(false);
    expect($(el, ".whyq").textContent).to.equal("What was wrong? Pick any.");
    const chips = $$(el, ".opt");
    expect(chips.map((c) => c.textContent)).to.deep.equal(["Confusing", "Too slow"]);
    chips[1].click();
    expect(chips[1].getAttribute("aria-pressed")).to.equal("true");
    chips[1].click();
    expect(chips[1].getAttribute("aria-pressed")).to.equal("false");
    expect($(el, "label").textContent).to.equal("Tell us more (optional)");
    expect($(el, "textarea").getAttribute("maxlength")).to.equal("200");
    expect($(el, "textarea").required).to.equal(false);
    expect($(el, ".send").textContent).to.equal("Send to the site team");
    await waitUntil(() => $(el, "[role=status]").textContent.indexOf("No selected.") === 0, "the choice was not announced");
    await expect(el).shadowDom.to.be.accessible();
    // Yes hides the reasons again and asks a different question
    $(el, ".up").click();
    expect($(el, ".why").hidden).to.equal(true);
    expect($(el, "label").textContent).to.equal("Anything we could add? (optional)");
  });

  it("posts the answer to the plugin's route and fires both events; the comment never reaches user-engagement", async () => {
    const el = await fixture(html`<page-feedback data-config=${CONFIG}></page-feedback>`);
    $(el, ".down").click();
    $$(el, ".opt")[0].click();
    $(el, "textarea").value = "  The srcset example is hard to follow.  ";
    $(el, ".send").click();
    await sent(el);
    expect(calls.length).to.equal(1);
    expect(calls[0].url).to.equal(new URL("x/api/v1/plugins/page-feedback/feedback", document.baseURI).toString());
    expect(calls[0].init.method).to.equal("POST");
    expect(calls[0].init.credentials).to.equal("same-origin");
    expect(JSON.parse(calls[0].init.body)).to.deep.equal({ pageId: "p1", helpful: false, reasons: ["confusing"], comment: "The srcset example is hard to follow." });
    expect(events.map((e) => e.type)).to.deep.equal(["page-feedback-submit", "user-engagement"]);
    expect(events.every((e) => e.bubbles && e.composed)).to.equal(true);
    expect(events[0].detail).to.deep.equal({ pageId: "p1", url: globalThis.location.href, helpful: false, reasons: ["confusing"], comment: "The srcset example is hard to follow." });
    expect(events[1].detail).to.deep.equal({ activityDisplay: "interacted", xapi: false, objectName: "Page feedback", objectId: "page-feedback", objectDetail: "not helpful" });
    expect(JSON.stringify(events[1].detail)).to.not.contain("srcset");
    expect($(el, ".form").hidden).to.equal(true);
    expect($(el, ".thanks").textContent).to.equal("Thanks. The site team will see this. No name is attached.");
    expect(el.shadowRoot.activeElement).to.equal($(el, ".thanks"));
    await waitUntil(() => $(el, "[role=status]").textContent === "Thanks. Sent to the site team.", "the thank-you was not announced");
    await expect(el).shadowDom.to.be.accessible();
  });

  it("works with no backend: no request, both events, and the thank-you", async () => {
    const el = await fixture(html`<page-feedback page-id="about"></page-feedback>`);
    $(el, ".up").click();
    $(el, ".send").click();
    await sent(el);
    expect(calls.length).to.equal(0);
    expect(events.map((e) => e.type)).to.deep.equal(["page-feedback-submit", "user-engagement"]);
    expect(events[0].detail).to.deep.equal({ pageId: "about", url: globalThis.location.href, helpful: true, reasons: [], comment: "" });
    expect(events[1].detail.objectDetail).to.equal("helpful");
  });

  it("explains an error and stays usable", async () => {
    const el = await fixture(html`<page-feedback data-config=${CONFIG}></page-feedback>`);
    $(el, ".up").click();
    answer = { ok: false, status: 429 };
    $(el, ".send").click();
    await waitUntil(() => !$(el, ".err").hidden, "no error shown");
    expect($(el, ".err").getAttribute("role")).to.equal("alert");
    expect($(el, ".err").textContent).to.contain("try again later");
    expect(events.length).to.equal(0);
    expect($(el, ".form").hidden).to.equal(false);
    expect($(el, ".send").hasAttribute("aria-disabled")).to.equal(false);
    await expect(el).shadowDom.to.be.accessible();
    answer = "offline";
    $(el, ".send").click();
    await waitUntil(() => $(el, ".err").textContent.indexOf("Check your connection") !== -1, "no offline message");
    answer = { ok: true, status: 200 };
    $(el, ".send").click();
    await sent(el);
    expect(calls.length).to.equal(3);
    expect(events.length).to.equal(2);
  });

  it("takes one answer per page per browser session unless repeat is set", async () => {
    const first = await fixture(html`<page-feedback data-config=${CONFIG}></page-feedback>`);
    $(first, ".up").click();
    $(first, ".send").click();
    await sent(first);
    const again = await fixture(html`<page-feedback data-config=${CONFIG}></page-feedback>`);
    expect($(again, ".form").hidden).to.equal(true);
    expect($(again, ".thanks").textContent).to.contain("Your feedback on this page was sent.");
    const other = await fixture(html`<page-feedback data-config=${CONFIG} page-id="p2"></page-feedback>`);
    expect($(other, ".form").hidden).to.equal(false);
    const repeat = await fixture(html`<page-feedback data-config=${CONFIG} repeat></page-feedback>`);
    expect($(repeat, ".form").hidden).to.equal(false);
  });

  it("its own attributes win over site settings; comments can be turned off; named mode drops the anonymity promise", async () => {
    const el = await fixture(html`<page-feedback data-config=${CONFIG} question="Useful?" yes-label="Yep" no-comments named reasons='[{"id":"x","label":"<b>Other</b>"}]'></page-feedback>`);
    expect($(el, ".q").textContent).to.equal("Useful?");
    expect($(el, ".up").textContent).to.equal("Yep");
    $(el, ".down").click();
    expect($(el, ".comment").hidden).to.equal(true);
    // labels are text, never markup
    expect($(el, ".opt").textContent).to.equal("<b>Other</b>");
    expect($(el, ".opt b")).to.equal(null);
    $(el, "textarea").value = "should not be sent";
    $(el, ".send").click();
    await sent(el);
    expect(JSON.parse(calls[0].init.body).comment).to.equal("");
    expect($(el, ".thanks").textContent).to.equal("Thanks. The site team will see this.");
  });

  it("fits a 360px column in every state", async () => {
    const box = await fixture(html`<div style="width: 360px"><page-feedback data-config=${CONFIG} repeat></page-feedback></div>`);
    const el = box.querySelector("page-feedback");
    const fits = () => [el, ...$$(el, "*")].every((n) => n.getBoundingClientRect().right <= box.getBoundingClientRect().right + 0.5) && box.scrollWidth <= 360;
    expect(fits()).to.equal(true);
    $(el, ".down").click();
    expect(fits()).to.equal(true);
    $(el, ".send").click();
    await sent(el);
    expect(fits()).to.equal(true);
    await aTimeout(0);
  });
});
