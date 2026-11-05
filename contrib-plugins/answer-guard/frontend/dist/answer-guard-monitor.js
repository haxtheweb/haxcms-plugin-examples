// Injected singleton: render.after.body writes <answer-guard-monitor> into pages that have guarded questions, with
// its settings baked in as attributes, so the browser never reads server settings.
//
// What it does, per question marked data-answer-guard-key by render.before.content:
// - listens in the capture phase for pointer, key, input, change and drop events; a script-generated event
//   (event.isTrusted false) is counted and, with block-untrusted, stopped before the question sees it. Real assistive
//   technology (keyboard, switch access, voice control) produces trusted events and is never affected.
// - notes how long after the question appeared the learner first interacted, and whether that was by pointer,
//   keyboard or neither.
// - answers the question's `question-check-request` event from the plugin's check route, so grading happens on the
//   server (the question element needs the companion change in webcomponents; see the plugin README).
// - shows the honor prompt once per page before the first check.
//
// It is a speed bump, not a lock: anything that can see the page can still read and answer it.
// No optional chaining (webcomponents lint rule), no dependencies.
const KEY = "data-answer-guard-key";
const WATCHED = ["pointerdown", "mousedown", "click", "keydown", "input", "change", "drop", "dragstart"];

class AnswerGuardMonitor extends HTMLElement {
  connectedCallback() {
    if (this._ready) return;
    this._ready = true;
    this.hidden = true;
    this._state = new Map();
    this._acknowledged = false;
    this._started = Date.now();
    this._onCheck = this._onCheck.bind(this);
    globalThis.document.addEventListener("question-check-request", this._onCheck, true);
    const seen = globalThis.IntersectionObserver
      ? new IntersectionObserver((entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              const st = this._get(e.target);
              if (!st.shownAt) st.shownAt = Date.now();
            }
          });
        })
      : null;
    globalThis.document.querySelectorAll(`[${KEY}]`).forEach((el) => {
      this._get(el);
      if (seen) seen.observe(el);
      WATCHED.forEach((type) => el.addEventListener(type, (e) => this._onInput(el, e), true));
    });
  }

  disconnectedCallback() {
    globalThis.document.removeEventListener("question-check-request", this._onCheck, true);
  }

  _get(el) {
    let st = this._state.get(el);
    if (!st) {
      st = { shownAt: 0, firstInputAt: 0, inputKind: "none", untrusted: 0 };
      this._state.set(el, st);
    }
    return st;
  }

  _onInput(el, e) {
    const st = this._get(el);
    if (!e.isTrusted) {
      st.untrusted += 1;
      if (this.hasAttribute("block-untrusted")) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
      return;
    }
    if (!st.firstInputAt) st.firstInputAt = Date.now();
    if (e.type === "pointerdown" || e.type === "mousedown" || e.type === "dragstart") st.inputKind = "pointer";
    else if (e.type === "keydown" && st.inputKind === "none") st.inputKind = "keyboard";
  }

  _url(path) {
    // relative to the site's <base href>, so it works under any HAXiam or HAXcms base path
    return new URL(`${this.getAttribute("endpoint") || ""}${path}`, globalThis.document.baseURI).toString();
  }

  async _post(path, body) {
    const res = await globalThis.fetch(this._url(path), {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    return { status: res.status, body: data };
  }

  // detail: { choices: [labels], respond(promise) }; the question awaits the promise for { correct, feedback }
  _onCheck(e) {
    const el = e.composedPath().find((n) => n && n.getAttribute && n.getAttribute(KEY));
    if (!el || !e.detail || typeof e.detail.respond !== "function") return;
    e.detail.respond(this._check(el, e.detail.choices || []));
  }

  async _check(el, choices) {
    await this._honor();
    const st = this._get(el);
    const key = el.getAttribute(KEY);
    const page = this.getAttribute("page");
    const start = st.shownAt || this._started;
    this._post("signals", {
      pageId: page,
      key,
      untrusted: st.untrusted,
      msToFirstInput: st.firstInputAt ? Math.max(0, st.firstInputAt - start) : Math.max(0, Date.now() - start),
      inputKind: st.inputKind,
      automation: globalThis.navigator && globalThis.navigator.webdriver === true,
    }).catch(() => {});
    const r = await this._post("check", { pageId: page, key, choices });
    if (r.status === 429) return { correct: false, retry: true, retryAfterMs: r.body ? r.body.retryAfterMs : 0, feedback: [] };
    if (r.status !== 200 || !r.body) return { correct: false, error: true, feedback: [] };
    return r.body;
  }

  // once per page, before the first check; an app-styled <dialog>, never window.confirm()
  _honor() {
    const text = this.getAttribute("honor-prompt");
    if (!text || this._acknowledged) return Promise.resolve();
    if (this._pending) return this._pending;
    this._pending = new Promise((resolve) => {
      const d = globalThis.document.createElement("dialog");
      d.setAttribute("aria-labelledby", "answer-guard-honor-text");
      d.style.cssText = "max-width:min(90vw,32rem);padding:var(--ddd-spacing-6,24px);border:var(--ddd-border-sm,1px solid);border-radius:var(--ddd-radius-sm,4px);font-family:var(--ddd-font-primary,sans-serif);color-scheme:light dark;color:CanvasText;background:Canvas;";
      const p = globalThis.document.createElement("p");
      p.id = "answer-guard-honor-text";
      p.textContent = text;
      const b = globalThis.document.createElement("button");
      b.type = "button";
      b.textContent = this.getAttribute("continue-label") || "Continue";
      b.style.cssText = "font:inherit;padding:var(--ddd-spacing-2,8px) var(--ddd-spacing-4,16px);cursor:pointer;";
      const done = () => {
        this._acknowledged = true;
        if (d.open) d.close();
        d.remove();
        resolve();
      };
      b.addEventListener("click", done);
      d.addEventListener("cancel", (ev) => {
        ev.preventDefault();
        done();
      });
      d.append(p, b);
      globalThis.document.body.append(d);
      if (typeof d.showModal === "function") {
        d.showModal();
        b.focus();
      } else {
        done();
      }
    });
    return this._pending;
  }
}

if (!globalThis.customElements.get("answer-guard-monitor")) {
  globalThis.customElements.define("answer-guard-monitor", AnswerGuardMonitor);
}
