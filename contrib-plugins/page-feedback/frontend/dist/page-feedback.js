// <page-feedback>: "Was this page helpful?" at the end of a page. A plain custom element with no dependencies, so it
// hydrates anywhere, including static publishes with no server.
//
// What it does when the reader presses Send:
//   - with an endpoint (the plugin's route, handed over by the server in data-config): POSTs the answer there;
//   - with no endpoint (static publish, plugin off): sends nothing anywhere;
// and in both cases, once the answer is accepted, fires
//   - "page-feedback-submit" (bubbles, composed) with { pageId, url, helpful, reasons, comment } so a host page can
//     handle the answer itself, and
//   - "user-engagement" (bubbles, composed) with { activityDisplay, xapi: false, objectName, objectId, objectDetail }.
// Feedback to the site team is not a learner record: xapi is false, no statement is built, and the comment text is
// never part of user-engagement.
//
// Attributes (all optional; the site's settings arrive in data-config and attributes win over them):
//   question, yes-label, no-label, reasons (JSON [{ id, label }]), no-comments, comment-max-length, endpoint,
//   page-id, named (the site stores who sent it, so the thank-you does not promise anonymity), repeat (allow more
//   than one answer per page in a browser session).

const DEFAULTS = {
  question: "Was this page helpful?",
  yesLabel: "Yes",
  noLabel: "No",
  reasons: [
    { id: "confusing", label: "Confusing" },
    { id: "out-of-date", label: "Out of date" },
    { id: "broken", label: "Broken link or media" },
    { id: "missing", label: "Missing something" },
  ],
  commentMaxLength: 1000,
};

const THUMB = "M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z";
const CHECK = "M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z";
const SVG_NS = "http://www.w3.org/2000/svg";

const STYLE = `
:host {
  display: block;
  color-scheme: light dark;
  --_surface: light-dark(var(--ddd-theme-default-white, #ffffff), var(--ddd-theme-default-coalyGray, #262626));
  --_text: light-dark(var(--ddd-theme-default-coalyGray, #262626), var(--ddd-theme-default-white, #ffffff));
  --_muted: light-dark(var(--ddd-theme-default-slateGray, #314d64), var(--ddd-theme-default-slateLight, #ccdae6));
  --_line: light-dark(var(--ddd-theme-default-limestoneGray, #a2aaad), var(--ddd-theme-default-slateGray, #314d64));
  --_control: light-dark(var(--ddd-theme-default-slateGray, #314d64), var(--ddd-theme-default-limestoneGray, #a2aaad));
  --_accent: light-dark(var(--ddd-theme-default-link, #005fa9), var(--ddd-theme-default-linkLight, #cce9ff));
  --_on-accent: light-dark(var(--ddd-theme-default-white, #ffffff), var(--ddd-theme-default-nittanyNavy, #001e44));
  --_pressed: light-dark(var(--ddd-theme-default-skyMaxLight, #e6f7ff), var(--ddd-theme-default-nittanyNavy, #001e44));
  --_error: light-dark(var(--ddd-theme-default-error, #5f2120), var(--ddd-theme-default-errorLight, #fdeded));
  --_error-surface: light-dark(var(--ddd-theme-default-errorLight, #fdeded), var(--ddd-theme-default-error, #5f2120));
  font-family: var(--ddd-font-primary, system-ui, sans-serif);
  font-size: var(--ddd-font-size-4xs, 16px);
  line-height: 1.5;
  color: var(--_text);
}
:host([hidden]) { display: none; }
* { box-sizing: border-box; }
.pf {
  margin: var(--ddd-spacing-6, 24px) 0 0;
  padding: var(--ddd-spacing-4, 16px) 0 0;
  border-top: var(--ddd-border-size-xs, 1px) solid var(--_line);
  min-width: 0;
}
p { margin: 0; }
.q { font-weight: var(--ddd-font-weight-medium, 500); margin-bottom: var(--ddd-spacing-2, 8px); }
.row, .opts { display: flex; flex-wrap: wrap; gap: var(--ddd-spacing-2, 8px); }
button {
  font: inherit;
  color: var(--_text);
  background: var(--_surface);
  border: var(--ddd-border-size-sm, 2px) solid var(--_control);
  border-radius: var(--ddd-radius-sm, 8px);
  min-height: 44px;
  padding: var(--ddd-spacing-2, 8px) var(--ddd-spacing-4, 16px);
  display: inline-flex;
  align-items: center;
  gap: var(--ddd-spacing-2, 8px);
  cursor: pointer;
  max-width: 100%;
  text-align: start;
}
button:hover { border-color: var(--_accent); }
button:focus-visible, textarea:focus-visible, .thanks:focus-visible {
  outline: var(--ddd-border-size-md, 3px) solid var(--_accent);
  outline-offset: 2px;
}
button[aria-pressed="true"] {
  background: var(--_pressed);
  font-weight: var(--ddd-font-weight-bold, 700);
}
svg { width: 20px; height: 20px; flex: none; fill: currentColor; }
.down svg { transform: scaleY(-1); }
.opt { border-radius: var(--ddd-radius-rounded, 100px); }
.opt svg { display: none; }
.opt[aria-pressed="true"] svg { display: block; }
.why, .more { margin-top: var(--ddd-spacing-3, 12px); }
.whyq, label { display: block; margin-bottom: var(--ddd-spacing-1, 4px); }
.comment { margin-top: var(--ddd-spacing-3, 12px); }
textarea {
  display: block;
  width: 100%;
  min-height: 72px;
  font: inherit;
  color: var(--_text);
  background: var(--_surface);
  border: var(--ddd-border-size-sm, 2px) solid var(--_control);
  border-radius: var(--ddd-radius-sm, 8px);
  padding: var(--ddd-spacing-2, 8px);
  resize: vertical;
}
.hint { color: var(--_muted); font-size: 0.875em; margin-top: var(--ddd-spacing-1, 4px); }
.send {
  margin-top: var(--ddd-spacing-3, 12px);
  background: var(--_accent);
  color: var(--_on-accent);
  font-weight: var(--ddd-font-weight-bold, 700);
}
.send:hover { border-color: var(--_text); }
.send[aria-disabled="true"] { cursor: progress; }
.err {
  margin-top: var(--ddd-spacing-3, 12px);
  padding: var(--ddd-spacing-2, 8px) var(--ddd-spacing-3, 12px);
  border: var(--ddd-border-size-sm, 2px) solid var(--_error);
  border-radius: var(--ddd-radius-sm, 8px);
  background: var(--_error-surface);
  color: var(--_error);
}
.thanks { overflow-wrap: anywhere; }
.sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
[hidden] { display: none !important; }
@media (prefers-reduced-motion: no-preference) {
  button { transition: background-color 0.15s ease, border-color 0.15s ease; }
}
@media (forced-colors: active) {
  button[aria-pressed="true"] { border-color: Highlight; outline: 2px solid Highlight; }
}
`;

let uid = 0;

function make(tag, props, children) {
  const el = document.createElement(tag);
  const p = props || {};
  Object.keys(p).forEach((k) => {
    if (k === "text") el.textContent = p[k];
    else if (k === "class") el.className = p[k];
    else el.setAttribute(k, p[k]);
  });
  (children || []).forEach((c) => el.appendChild(c));
  return el;
}

function icon(path) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const p = document.createElementNS(SVG_NS, "path");
  p.setAttribute("d", path);
  svg.appendChild(p);
  return svg;
}

function parseJson(text) {
  if (typeof text !== "string" || text === "") return null;
  try { return JSON.parse(text); } catch (e) { return null; }
}

function cleanReasons(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  list.forEach((r) => {
    if (r && typeof r.id === "string" && r.id !== "" && typeof r.label === "string" && r.label !== "") out.push({ id: r.id, label: r.label });
  });
  return out.slice(0, 12);
}

export class PageFeedback extends HTMLElement {
  static get tag() { return "page-feedback"; }
  static get observedAttributes() {
    return ["data-config", "question", "yes-label", "no-label", "reasons", "no-comments", "comment-max-length", "endpoint", "page-id", "named", "repeat"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    uid += 1;
    this._n = uid;
    this._helpful = null;
    this._picked = {};
    this._sending = false;
    this._sent = false;
  }

  connectedCallback() {
    this._ready = true;
    this._build();
  }

  attributeChangedCallback() {
    // settings changed (the editor, or the server's data-config): start over unless the reader is part way through
    if (this._ready && this._helpful === null && !this._sent) this._build();
  }

  /** Site settings from data-config, with the element's own attributes on top. */
  get config() {
    const site = parseJson(this.getAttribute("data-config")) || {};
    const text = (attr, key) => {
      const own = this.getAttribute(attr);
      if (own !== null && own.trim() !== "") return own;
      return typeof site[key] === "string" && site[key].trim() !== "" ? site[key] : DEFAULTS[key];
    };
    const reasons = cleanReasons(parseJson(this.getAttribute("reasons"))) || cleanReasons(site.reasons) || DEFAULTS.reasons;
    const max = Number(this.getAttribute("comment-max-length") || site.commentMaxLength || DEFAULTS.commentMaxLength);
    const endpoint = this.getAttribute("endpoint") || (typeof site.endpoint === "string" ? site.endpoint : "");
    return {
      question: text("question", "question"),
      yesLabel: text("yes-label", "yesLabel"),
      noLabel: text("no-label", "noLabel"),
      reasons,
      allowComments: !this.hasAttribute("no-comments") && site.allowComments !== false,
      commentMaxLength: max >= 1 && max <= 5000 ? Math.floor(max) : DEFAULTS.commentMaxLength,
      anonymous: !this.hasAttribute("named") && site.anonymous !== false,
      endpoint,
      pageId: this.getAttribute("page-id") || (typeof site.pageId === "string" ? site.pageId : ""),
    };
  }

  get _key() {
    const c = this.config;
    return "page-feedback:" + (c.pageId || globalThis.location.pathname);
  }

  _alreadySent() {
    if (this.hasAttribute("repeat")) return false;
    try { return globalThis.sessionStorage.getItem(this._key) === "1"; } catch (e) { return false; }
  }

  _remember() {
    try { globalThis.sessionStorage.setItem(this._key, "1"); } catch (e) { /* storage is off; the reader may answer again */ }
  }

  _say(message) {
    const live = this._live;
    if (!live) return;
    live.textContent = "";
    // a fresh text node after a tick, so the same sentence twice is still announced
    globalThis.setTimeout(() => { live.textContent = message; }, 50);
  }

  _build() {
    const c = this.config;
    const n = this._n;
    const root = this.shadowRoot;
    root.textContent = "";
    root.appendChild(make("style", { text: STYLE }));

    this._yes = make("button", { type: "button", class: "thumb up", "aria-pressed": "false" }, [icon(THUMB), make("span", { text: c.yesLabel })]);
    this._no = make("button", { type: "button", class: "thumb down", "aria-pressed": "false" }, [icon(THUMB), make("span", { text: c.noLabel })]);
    this._yes.addEventListener("click", () => this._choose(true));
    this._no.addEventListener("click", () => this._choose(false));

    this._chips = c.reasons.map((r) => {
      const b = make("button", { type: "button", class: "opt", "aria-pressed": "false", "data-reason": r.id }, [icon(CHECK), make("span", { text: r.label })]);
      b.addEventListener("click", () => {
        this._picked[r.id] = !this._picked[r.id];
        b.setAttribute("aria-pressed", this._picked[r.id] ? "true" : "false");
      });
      return b;
    });
    this._why = make("div", { class: "why", role: "group", "aria-labelledby": "pf-why-" + n, hidden: "" }, [
      make("p", { class: "whyq", id: "pf-why-" + n, text: "What was wrong? Pick any." }),
      make("div", { class: "opts" }, this._chips),
    ]);

    this._label = make("label", { for: "pf-c-" + n, text: "Tell us more (optional)" });
    this._text = make("textarea", { id: "pf-c-" + n, maxlength: String(c.commentMaxLength), "aria-describedby": "pf-h-" + n });
    this._commentBox = make("div", { class: "comment" }, [
      this._label,
      this._text,
      make("p", { class: "hint", id: "pf-h-" + n, text: c.anonymous ? "Please leave out names and other personal details." : "Sent with your name because you are signed in." }),
    ]);
    if (!c.allowComments) this._commentBox.hidden = true;

    this._err = make("p", { class: "err", role: "alert", hidden: "" });
    this._send = make("button", { type: "button", class: "send", text: "Send to the site team" });
    this._send.addEventListener("click", () => this._submit());
    this._more = make("div", { class: "more", hidden: "" }, [this._why, this._commentBox, this._err, this._send]);

    this._form = make("div", { class: "form" }, [
      make("p", { class: "q", id: "pf-q-" + n, text: c.question }),
      make("div", { class: "row", role: "group", "aria-labelledby": "pf-q-" + n }, [this._yes, this._no]),
      this._more,
    ]);
    this._thanks = make("p", { class: "thanks", tabindex: "-1", hidden: "" });
    this._live = make("div", { class: "sr", role: "status", "aria-live": "polite" });
    root.appendChild(make("section", { class: "pf", "aria-label": "Page feedback" }, [this._form, this._thanks, this._live]));

    if (this._alreadySent()) this._showThanks("Your feedback on this page was sent.", false);
  }

  _choose(helpful) {
    if (this._sending) return;
    this._helpful = helpful;
    this._yes.setAttribute("aria-pressed", helpful ? "true" : "false");
    this._no.setAttribute("aria-pressed", helpful ? "false" : "true");
    const hasReasons = !helpful && this._chips.length > 0;
    this._why.hidden = !hasReasons;
    this._label.textContent = helpful ? "Anything we could add? (optional)" : "Tell us more (optional)";
    this._more.hidden = false;
    this._err.hidden = true;
    const c = this.config;
    const parts = [(helpful ? c.yesLabel : c.noLabel) + " selected."];
    if (hasReasons) parts.push("You can pick what was wrong.");
    if (c.allowComments) parts.push("You can add a comment.");
    parts.push("Then send it to the site team.");
    this._say(parts.join(" "));
  }

  _showThanks(sentence, focus) {
    const c = this.config;
    this._sent = true;
    this._form.hidden = true;
    this._thanks.textContent = "";
    this._thanks.appendChild(make("strong", { text: "Thanks." }));
    this._thanks.appendChild(document.createTextNode(" " + sentence + (c.anonymous ? " No name is attached." : "")));
    this._thanks.hidden = false;
    if (focus) {
      this._thanks.focus();
      this._say("Thanks. Sent to the site team.");
    }
  }

  _fail(message) {
    this._sending = false;
    this._send.removeAttribute("aria-disabled");
    this._send.textContent = "Send to the site team";
    this._err.textContent = message;
    this._err.hidden = false;
  }

  async _submit() {
    if (this._sending || this._sent || this._helpful === null) return;
    const c = this.config;
    const helpful = this._helpful;
    const reasons = helpful ? [] : c.reasons.map((r) => r.id).filter((id) => this._picked[id]);
    const comment = c.allowComments ? this._text.value.trim() : "";
    this._err.hidden = true;
    if (c.endpoint) {
      this._sending = true;
      this._send.setAttribute("aria-disabled", "true");
      this._send.textContent = "Sending…";
      let res = null;
      try {
        res = await globalThis.fetch(new URL(c.endpoint, document.baseURI).toString(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ pageId: c.pageId, helpful, reasons, comment }),
        });
      } catch (e) {
        this._fail("That did not reach the site. Check your connection and try again.");
        return;
      }
      if (!res.ok) {
        const messages = {
          404: "This page cannot take feedback right now. Nothing was sent.",
          422: "The site could not accept that. Shorten or change your comment and try again.",
          429: "The site has had a lot of feedback in the last hour. Please try again later.",
        };
        this._fail(messages[res.status] || "The site could not take your feedback just now. Please try again in a moment.");
        return;
      }
      this._sending = false;
    }
    this._remember();
    // for a host page that handles feedback itself (static sites); the comment goes here and nowhere else
    this.dispatchEvent(new CustomEvent("page-feedback-submit", {
      bubbles: true,
      composed: true,
      detail: { pageId: c.pageId, url: globalThis.location.href, helpful, reasons, comment },
    }));
    // engagement only: not a learner record, and never the comment text
    this.dispatchEvent(new CustomEvent("user-engagement", {
      bubbles: true,
      composed: true,
      detail: { activityDisplay: "interacted", xapi: false, objectName: "Page feedback", objectId: "page-feedback", objectDetail: helpful ? "helpful" : "not helpful" },
    }));
    this._showThanks("The site team will see this.", true);
  }
}

if (!globalThis.customElements.get(PageFeedback.tag)) globalThis.customElements.define(PageFeedback.tag, PageFeedback);
