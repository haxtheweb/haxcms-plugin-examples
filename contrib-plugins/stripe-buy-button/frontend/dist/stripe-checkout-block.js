/**
 * Copyright 2026 The Pennsylvania State University
 * @license Apache-2.0, see LICENSE for full text.
 *
 * A Stripe Buy Button as a HAX block (haxtheweb/issues#2090). Stripe hosts the
 * checkout, so the page never sees card data and the site keeps no secret.
 *
 * - Always renders a plain link to the Payment Link (when one is set) first, so
 *   the block works on static hosts, in print, without JavaScript and when the
 *   content leaves HAXcms.
 * - Loads Stripe's script only when the block nears the viewport, once per page,
 *   and never while the page is being edited in HAX.
 * - Refuses secret and restricted keys (sk_, rk_): those must never be in a page.
 */
const STRIPE_SCRIPT = "https://js.stripe.com/v3/buy-button.js";
const BUY_BUTTON_ID = /^buy_btn_[A-Za-z0-9]+$/;
const PUBLISHABLE_KEY = /^pk_(live|test)_[A-Za-z0-9]+$/;
const SECRET_KEY = /^(sk|rk)_/;
const PAYMENT_LINK = /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9_/-]+$/;

let scriptPromise = null;
function loadStripeScript() {
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = globalThis.document.createElement("script");
      script.src = STRIPE_SCRIPT;
      script.async = true;
      script.addEventListener("load", () => resolve(true), { once: true });
      script.addEventListener(
        "error",
        () => {
          scriptPromise = null;
          reject(new Error("Stripe script did not load"));
        },
        { once: true },
      );
      globalThis.document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

function inEditor() {
  const hs = globalThis.HaxStore;
  return Boolean(hs && hs.instance && hs.instance.editMode);
}

class StripeCheckoutBlock extends HTMLElement {
  static get tag() {
    return "stripe-checkout-block";
  }
  static get observedAttributes() {
    return ["buy-button-id", "publishable-key", "payment-link", "label"];
  }
  connectedCallback() {
    this.render();
    if (!this.__observer && "IntersectionObserver" in globalThis) {
      this.__observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            this.__observer.disconnect();
            this.__observer = null;
            this.upgrade();
          }
        },
        { rootMargin: "200px" },
      );
      this.__observer.observe(this);
    }
  }
  disconnectedCallback() {
    if (this.__observer) {
      this.__observer.disconnect();
      this.__observer = null;
    }
  }
  attributeChangedCallback() {
    if (this.isConnected) {
      this.render();
    }
  }
  /** what is wrong with the settings, or "" */
  get problem() {
    const id = this.getAttribute("buy-button-id") || "";
    const key = this.getAttribute("publishable-key") || "";
    if (SECRET_KEY.test(key)) {
      return "secret-key";
    }
    if (!BUY_BUTTON_ID.test(id) || !PUBLISHABLE_KEY.test(key)) {
      return "incomplete";
    }
    return "";
  }
  get paymentLink() {
    const link = this.getAttribute("payment-link") || "";
    return PAYMENT_LINK.test(link) ? link : "";
  }
  render() {
    const doc = globalThis.document;
    this.replaceChildren();
    this.style.display = "block";
    const box = doc.createElement("div");
    box.className = "fallback";
    box.style.cssText =
      "display:flex;flex-direction:column;gap:var(--ddd-spacing-2,8px);align-items:flex-start;";
    if (this.problem === "secret-key") {
      // never echo the key back into the page
      const note = doc.createElement("p");
      note.setAttribute("role", "alert");
      note.style.cssText =
        "margin:0;padding:var(--ddd-spacing-3,12px);border:var(--ddd-border-sm,1px solid);border-left:var(--ddd-spacing-1,4px) solid var(--ddd-theme-default-error,#b40000);";
      note.textContent =
        "This block has a secret Stripe key. Remove it and use the publishable key (pk_) instead.";
      box.appendChild(note);
    }
    const link = this.paymentLink;
    if (link) {
      const a = doc.createElement("a");
      a.href = link;
      a.rel = "noopener";
      a.textContent = this.getAttribute("label") || "Buy now";
      a.style.cssText =
        "display:inline-block;padding:var(--ddd-spacing-3,12px) var(--ddd-spacing-5,20px);border-radius:var(--ddd-radius-sm,4px);background:var(--ddd-theme-primary,var(--ddd-theme-default-link,#005fa9));color:var(--ddd-theme-bgContrast,#fff);font-weight:var(--ddd-font-weight-bold,700);text-decoration:none;";
      box.appendChild(a);
    } else if (this.problem === "incomplete" && inEditor()) {
      const note = doc.createElement("p");
      note.style.cssText = "margin:0;";
      note.textContent =
        "Add the buy button ID and publishable key from your Stripe dashboard.";
      box.appendChild(note);
    }
    this.appendChild(box);
  }
  /** swap the fallback for Stripe's button when it can load */
  async upgrade() {
    if (this.problem || inEditor()) {
      return false;
    }
    try {
      await loadStripeScript();
      await globalThis.customElements.whenDefined("stripe-buy-button");
    } catch {
      // the fallback link stays
      return false;
    }
    if (!this.isConnected) {
      return false;
    }
    const button = globalThis.document.createElement("stripe-buy-button");
    button.setAttribute("buy-button-id", this.getAttribute("buy-button-id"));
    button.setAttribute(
      "publishable-key",
      this.getAttribute("publishable-key"),
    );
    this.replaceChildren(button);
    return true;
  }
}
globalThis.customElements.define(StripeCheckoutBlock.tag, StripeCheckoutBlock);
export { StripeCheckoutBlock };
