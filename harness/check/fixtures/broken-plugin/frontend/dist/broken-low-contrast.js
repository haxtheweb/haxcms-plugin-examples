// Fails axe color-contrast: light gray on white.
class BrokenLowContrast extends HTMLElement {
  connectedCallback() {
    this.innerHTML = '<p style="color:#ddd;background:#fff">Hard to read</p>';
  }
}
customElements.define("broken-low-contrast", BrokenLowContrast);
