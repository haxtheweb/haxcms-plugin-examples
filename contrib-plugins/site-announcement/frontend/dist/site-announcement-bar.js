// <site-announcement-bar>: the site's announcement, full width above the theme. No dependencies; colors and spacing
// come from DDD tokens (every HAX theme loads them), with fallbacks. Everything it shows is baked in as attributes at
// render (heading, text, link, link-text, variant, ends, site); it never asks the server.
// Dismissing hides this announcement in this browser until its text, link or end date changes.
const style = `
:host { display: block; color-scheme: inherit;
  --sa-accent: light-dark(var(--ddd-theme-default-info, #1e407c), var(--ddd-theme-default-skyBlue, #009cde));
  --sa-bg: light-dark(var(--ddd-theme-default-infoLight, #cfeceb), color-mix(in srgb, var(--ddd-theme-default-info, #1e407c) 30%, var(--ddd-theme-default-coalyGray, #262626))); }
:host([hidden]) { display: none; }
:host([variant="neutral"]) {
  --sa-accent: light-dark(var(--ddd-theme-default-limestoneGray, #a2aaad), var(--ddd-theme-default-slateGray, #314d64));
  --sa-bg: light-dark(var(--ddd-theme-default-limestoneMaxLight, #f2f2f4), var(--ddd-theme-default-coalyGray, #262626)); }
:host([variant="success"]) {
  --sa-accent: light-dark(var(--ddd-theme-default-success, #4caf50), var(--ddd-theme-default-opportunityGreen, #008e2c));
  --sa-bg: light-dark(var(--ddd-theme-default-successLight, #ddf3dd), color-mix(in srgb, var(--ddd-theme-default-success, #4caf50) 30%, var(--ddd-theme-default-coalyGray, #262626))); }
:host([variant="warning"]) {
  --sa-accent: var(--ddd-theme-default-keystoneYellow, #ffd100);
  --sa-bg: light-dark(var(--ddd-theme-default-warningLight, #fff3cd), color-mix(in srgb, var(--ddd-theme-default-warning, #ffc107) 30%, var(--ddd-theme-default-coalyGray, #262626))); }
:host([variant="danger"]) {
  --sa-accent: light-dark(var(--ddd-theme-default-error, #dc3545), var(--ddd-theme-default-original87Pink, #bc204b));
  --sa-bg: light-dark(var(--ddd-theme-default-errorLight, #f8d7da), color-mix(in srgb, var(--ddd-theme-default-error, #dc3545) 30%, var(--ddd-theme-default-coalyGray, #262626))); }
.bar { position: relative; display: flex; flex-wrap: wrap; align-items: center; justify-content: center;
  gap: var(--ddd-spacing-1, 4px) var(--ddd-spacing-3, 12px);
  padding: var(--ddd-spacing-2, 8px) var(--ddd-spacing-4, 16px); padding-inline-end: var(--ddd-spacing-10, 40px);
  background-color: var(--sa-bg);
  color: light-dark(var(--ddd-theme-default-coalyGray, #262626), var(--ddd-theme-default-white, #fff));
  border-bottom: var(--ddd-border-xs, 1px solid); border-bottom-color: var(--sa-accent);
  font-family: var(--ddd-font-primary, sans-serif); font-size: var(--ddd-font-size-4xs, 16px);
  line-height: var(--ddd-lh-140, 1.4); text-align: center; }
p { margin: 0; }
strong { font-weight: var(--ddd-font-weight-bold, 700); }
a { color: light-dark(var(--ddd-theme-default-link, #005fa9), var(--ddd-theme-default-linkLight, #cfeceb));
  font-weight: var(--ddd-font-weight-medium, 500); text-decoration: underline; }
a:focus-visible, button:focus-visible { outline: var(--ddd-border-md, 2px solid);
  outline-color: light-dark(var(--ddd-theme-default-link, #005fa9), var(--ddd-theme-default-linkLight, #cfeceb)); outline-offset: 2px; }
button { position: absolute; inset-inline-end: var(--ddd-spacing-2, 8px); top: 50%; transform: translateY(-50%);
  display: inline-grid; place-items: center; width: 32px; height: 32px; /* above the 24px minimum target size */
  padding: 0; margin: 0; border: 0; border-radius: var(--ddd-radius-xs, 4px); background: transparent; color: inherit; cursor: pointer; }
button:hover { background-color: color-mix(in srgb, currentColor 12%, transparent); }
svg { width: 20px; height: 20px; fill: currentColor; }
@media print { :host { display: none; } }
`;

function safeLink(value) {
  const s = String(value || "").replace(/[\u0000- \u007f]/g, "");
  if (!s) return "";
  if (/^(https?:\/\/|mailto:)/i.test(s)) return s;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith("//") || s.startsWith("\\")) return "";
  return s;
}

function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

class SiteAnnouncementBar extends HTMLElement {
  static get observedAttributes() { return ["heading", "text", "link", "link-text", "variant", "ends", "site"]; }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._onScroll = () => this._publishHeight();
  }

  connectedCallback() {
    this.render();
    globalThis.addEventListener("scroll", this._onScroll, { passive: true });
    globalThis.addEventListener("resize", this._onScroll, { passive: true });
  }

  disconnectedCallback() {
    globalThis.removeEventListener("scroll", this._onScroll);
    globalThis.removeEventListener("resize", this._onScroll);
    if (this._ro) this._ro.disconnect();
    document.documentElement.style.removeProperty("--haxcms-site-announcement-height");
  }

  attributeChangedCallback() { if (this.isConnected) this.render(); }

  // "heading", not "title": a title attribute would show as a tooltip over the whole bar
  get _title() { return this.getAttribute("heading") || ""; }

  /** what identifies this announcement: dismissing it does not hide the next one */
  get signature() {
    return JSON.stringify([this._title, this.getAttribute("text") || "", this.getAttribute("link") || "", this.getAttribute("link-text") || "", this.getAttribute("ends") || ""]);
  }

  get storageKey() { return `haxcms-announcement-dismissed:${this.getAttribute("site") || location.pathname.split("/")[1] || ""}`; }

  get dismissed() {
    try { return localStorage.getItem(this.storageKey) === this.signature; } catch (e) { return false; }
  }

  dismiss() {
    try { localStorage.setItem(this.storageKey, this.signature); } catch (e) { /* storage blocked: hide for this page view */ }
    this.hidden = true;
    this._publishHeight();
    this.dispatchEvent(new CustomEvent("site-announcement-dismissed", { bubbles: true, composed: true }));
  }

  render() {
    const title = this._title;
    const text = this.getAttribute("text") || "";
    const ends = this.getAttribute("ends") || "";
    // an unknown variant matches no :host([variant]) rule, so it shows as brand
    this.hidden = (!title && !text) || (ends && ends < today()) || this.dismissed;
    const root = this.shadowRoot;
    root.innerHTML = `<style>${style}</style>`;
    if (this.hidden) { this._publishHeight(); return; }
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", "Announcement");
    const p = document.createElement("p");
    if (title) {
      const strong = document.createElement("strong");
      strong.textContent = title;
      p.append(strong);
      if (text) p.append(" ");
    }
    if (text) p.append(text);
    bar.append(p);
    const href = safeLink(this.getAttribute("link"));
    if (href) {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = this.getAttribute("link-text") || "Learn more";
      bar.append(a);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss announcement");
    close.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
    close.addEventListener("click", () => this.dismiss());
    bar.append(close);
    root.append(bar);
    if (!this._ro && globalThis.ResizeObserver) { this._ro = new ResizeObserver(() => this._publishHeight()); this._ro.observe(this); }
    this._publishHeight();
  }

  // how much of the bar is on screen, for themes with a sticky header to offset by
  _publishHeight() {
    const h = this.hidden ? 0 : Math.max(0, this.offsetHeight - (globalThis.scrollY || 0));
    document.documentElement.style.setProperty("--haxcms-site-announcement-height", `${h}px`);
  }
}

if (!customElements.get("site-announcement-bar")) customElements.define("site-announcement-bar", SiteAnnouncementBar);
