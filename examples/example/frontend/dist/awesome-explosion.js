// Plain ES module; no build step needed during development.
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
