// A chord progression (for example "G D Em C"), shown as labelled boxes, four to a bar.
class MusicChordChart extends HTMLElement {
  static get observedAttributes() { return ["chords"]; }
  connectedCallback() { this.render(); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }
  render() {
    const chords = String(this.getAttribute("chords") || "").trim().split(/\s+/).filter(Boolean);
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    this.innerHTML = `<ol style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--ddd-spacing-2,8px);list-style:none;padding:0" aria-label="Chord progression">${chords.map((c) => `<li style="border:var(--ddd-border-sm,1px solid);padding:var(--ddd-spacing-2,8px);text-align:center">${esc(c)}</li>`).join("")}</ol>`;
  }
}
customElements.define("music-chord-chart", MusicChordChart);
