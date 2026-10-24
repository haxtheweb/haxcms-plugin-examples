// Injected singleton: arrives through render.after.body, needs no haxProperties.
class AwesomeCounter extends HTMLElement {
  connectedCallback() { this.textContent = `💥 x${document.querySelectorAll("awesome-explosion").length}`; }
}
customElements.define("awesome-counter", AwesomeCounter);
