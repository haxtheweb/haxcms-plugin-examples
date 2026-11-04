// Consent banner plus the tiny API trackers use: globalThis.HAXConsent.onGrant(category, callback) runs the
// callback once the visitor allows that category (immediately if they already did). The choice is stored in this
// browser only. Plugins that depend on cookie-consent use this API; core never does.
const KEY = "hax-consent";
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode: ask again next time */ } };
const waiting = {};
globalThis.HAXConsent = globalThis.HAXConsent || {
  granted: (cat) => read()[cat] === true,
  onGrant(cat, cb) { if (read()[cat] === true) cb(); else (waiting[cat] = waiting[cat] || []).push(cb); },
  set(cat, allowed) { write({ ...read(), [cat]: allowed }); if (allowed) (waiting[cat] || []).splice(0).forEach((cb) => cb()); },
};

class CookieConsentBanner extends HTMLElement {
  connectedCallback() {
    const cats = (this.getAttribute("categories") || "").split(",").filter(Boolean);
    const state = read();
    if (cats.every((c) => c in state)) return; // already answered
    const policy = this.getAttribute("policy-url");
    this.setAttribute("role", "region");
    this.setAttribute("aria-label", "Cookie consent");
    this.innerHTML = `<p>${this.getAttribute("message") || ""}${policy ? ` <a href="${policy}">Privacy policy</a>` : ""}</p>
      <button type="button" data-a="allow">Allow</button> <button type="button" data-a="deny">No thanks</button>`;
    this.querySelectorAll("button").forEach((b) => (b.onclick = () => { cats.forEach((c) => globalThis.HAXConsent.set(c, b.dataset.a === "allow")); this.remove(); }));
  }
}
customElements.define("cookie-consent-banner", CookieConsentBanner);
