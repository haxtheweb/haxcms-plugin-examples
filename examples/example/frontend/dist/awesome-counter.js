// Injected singleton: the render.after.body hook writes <awesome-counter greeting="..."> into the page with the
// greeting baked in from the plugin's settings, so the browser never asks the server for settings. Never bake secrets.
// It needs no haxProperties because authors never insert it (role: injected).
class AwesomeCounter extends HTMLElement {
  connectedCallback() { this.textContent = `${this.getAttribute("greeting") || ""} 💥 x${document.querySelectorAll("awesome-explosion").length}`; }
}
customElements.define("awesome-counter", AwesomeCounter);
