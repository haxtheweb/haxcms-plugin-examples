// A block element: plain ES module, no build step needed during development (hax plugin build optimizes for shipping).
// Its editable properties are described in awesome-explosion.haxProperties.json.
class AwesomeExplosion extends HTMLElement {
  static get observedAttributes() { return ["intensity"]; }
  connectedCallback() { this.render(); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }
  render() {
    const n = Number(this.getAttribute("intensity") || 1);
    this.textContent = "💥".repeat(n * 3);
  }
}
customElements.define("awesome-explosion", AwesomeExplosion);
