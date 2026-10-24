// The What's New / HAX Tips dialog content. app-hax shows it with simple-modal (dispatch simple-modal-show with
// elements: { content }), the way _showSystemSettingsModal does, and returns focus to `invokedBy` on close.
// Latest highlights first with type filter chips, earlier versions below, tip of the day, and a Dismiss button.
// element visuals render through <hax-element-demo render-tag="..."> (first demoSchema item); screenshot visuals load
// from the authenticated visual route; entries without a visual show their type's icon. Chips carry label and icon,
// never color alone. Plain custom element: the real one would use DDD, Lit and I18NMixin (this.t) for its strings.
import { dismiss, markSeen } from "./announcements-state.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

class AnnouncementsDialog extends HTMLElement {
  constructor() { super(); this.call = null; this.focusUuid = null; this.filter = null; this.state = null; }
  async connectedCallback() {
    const call = this.call || globalThis.store?.AppHaxAPI?.makeCall?.bind(globalThis.store.AppHaxAPI);
    if (!call) return;
    const lang = document.documentElement.lang || "en";
    const [all, tip] = await Promise.all([call("announcementsListAll", { "filter[kind]": "update", lang }), call("announcementsGetDailyTip", { lang })]);
    this.state = { all: all.data || all, tip: tip && (tip.data || tip) };
    markSeen(this.state.all.latestVersion);
    this.render();
  }
  card(e, types) {
    const t = types[e.type] || {};
    let visual = `<simple-icon-lite icon="${esc(t.icon)}" aria-hidden="true"></simple-icon-lite>`;
    if (e.visual?.mode === "element") visual = `<hax-element-demo render-tag="${esc(e.visual.tag)}"></hax-element-demo>`;
    if (e.visual?.mode === "screenshot") visual = `<img src="${esc(e.visual.url)}" alt="${esc(e.visual.alt)}" loading="lazy">`;
    return `<li id="a-${esc(e.uuid)}"><span class="chip" style="background: var(${esc(t.color)})">${esc(t.label)}</span>
      <h3>${esc(e.label)}</h3><p>${esc(e.description)}</p>${visual}
      ${(e.links || []).map((l) => `<a href="${esc(l.url)}">${esc(l.title)}</a>`).join(" ")}</li>`;
  }
  render() {
    const { all, tip } = this.state;
    const items = all.items.filter((e) => !this.filter || e.type === this.filter);
    const latest = items.filter((e) => e.version === all.latestVersion);
    const earlier = items.filter((e) => e.version !== all.latestVersion);
    this.innerHTML = `
      <div role="group" aria-label="Filter by type">${Object.values(all.types).map((t) =>
        `<button type="button" class="filter" data-type="${esc(t.uuid)}" aria-pressed="${this.filter === t.uuid}">${esc(t.label)}</button>`).join("")}</div>
      <h2>New in ${esc(all.latestVersion)}</h2><ul>${latest.map((e) => this.card(e, all.types)).join("")}</ul>
      ${earlier.length ? `<h2>Earlier</h2><ul>${earlier.map((e) => this.card(e, all.types)).join("")}</ul>` : ""}
      ${tip ? `<h2>Tip of the day</h2><ul>${this.card(tip, all.types)}</ul>` : ""}
      <button type="button" class="dismiss">Dismiss</button>`;
    this.querySelectorAll(".filter").forEach((b) => (b.onclick = () => { this.filter = this.filter === b.dataset.type ? null : b.dataset.type; this.render(); }));
    this.querySelector(".dismiss").onclick = () => {
      dismiss(all.latestVersion);
      this.dispatchEvent(new CustomEvent("simple-modal-hide", { bubbles: true, composed: true }));
    };
    if (this.focusUuid) this.querySelector(`#a-${CSS.escape(this.focusUuid)}`)?.scrollIntoView();
  }
}
customElements.define("announcements-dialog", AnnouncementsDialog);
