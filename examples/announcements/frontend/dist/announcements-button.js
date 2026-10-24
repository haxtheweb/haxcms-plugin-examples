// Top-bar button for app-hax. Always present while the plugin is enabled so the dialog can be reopened; shows a
// "New" chip only while there is something undismissed. Nothing opens by itself: the user clicks.
// Data comes through app-hax's API layer (store.AppHaxAPI.makeCall("announcementsListLatest")), which adds the JWT and
// user-token headers; set the `call` property to inject it. Plain custom element: the real one would use DDD and Lit.
import { hasNew } from "./announcements-state.js";

class AnnouncementsButton extends HTMLElement {
  constructor() { super(); this.call = null; this.latest = null; this.attachShadow({ mode: "open" }); }
  async connectedCallback() {
    this.render();
    const call = this.call || globalThis.store?.AppHaxAPI?.makeCall?.bind(globalThis.store.AppHaxAPI);
    if (!call) return;
    const res = await call("announcementsListLatest", { lang: document.documentElement.lang || "en" });
    this.latest = res && (res.data || res);
    this.render();
  }
  render() {
    const isNew = this.latest && hasNew(this.latest.latestVersion);
    this.shadowRoot.innerHTML = `
      <style>
        button { font: inherit; background: none; border: 0; cursor: pointer; position: relative; padding: var(--ddd-spacing-2, 8px); }
        .chip { background: var(--ddd-primary-13, #b00); color: var(--ddd-theme-default-white, #fff); border-radius: var(--ddd-radius-rounded, 999px); padding: 0 var(--ddd-spacing-1, 4px); font-size: var(--ddd-font-size-4xs, 12px); margin-inline-start: var(--ddd-spacing-1, 4px); }
        @media (prefers-reduced-motion: no-preference) { .chip { transition: opacity .2s; } }
      </style>
      <button type="button" aria-label="What's new and HAX tips${isNew ? " (new)" : ""}">
        <span aria-hidden="true">✨</span>${isNew ? `<span class="chip">New</span>` : ""}
      </button>`;
    this.shadowRoot.querySelector("button").onclick = () =>
      this.dispatchEvent(new CustomEvent("announcements-open", { bubbles: true, composed: true, detail: { invokedBy: this } }));
  }
}
customElements.define("announcements-button", AnnouncementsButton);
