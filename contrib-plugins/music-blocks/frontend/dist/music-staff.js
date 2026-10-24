// A melody written as note names (C4 D4 E4 ...), drawn on a five-line staff. Plain ES module, no build step.
const STEPS = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
class MusicStaff extends HTMLElement {
  static get observedAttributes() { return ["notes", "label"]; }
  connectedCallback() { this.render(); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }
  render() {
    const notes = String(this.getAttribute("notes") || "").trim().split(/\s+/).filter((n) => /^[A-G][0-9]$/.test(n));
    const y = (n) => 70 - ((Number(n[1]) - 4) * 7 + STEPS[n[0]]) * 5; // E4 sits on the bottom line
    const lines = [0, 1, 2, 3, 4].map((i) => `<line x1="0" x2="${40 + notes.length * 30}" y1="${30 + i * 10}" y2="${30 + i * 10}" stroke="currentColor"/>`).join("");
    const heads = notes.map((n, i) => `<ellipse cx="${40 + i * 30}" cy="${y(n) - 5}" rx="6" ry="4.5" fill="currentColor"/>`).join("");
    const label = this.getAttribute("label") || `Melody: ${notes.join(" ")}`;
    this.innerHTML = `<svg role="img" aria-label="${label.replace(/"/g, "&quot;")}" viewBox="0 0 ${50 + notes.length * 30} 100" style="max-width:100%;color:var(--ddd-theme-primary,currentColor)">${lines}${heads}</svg>`;
  }
}
customElements.define("music-staff", MusicStaff);
