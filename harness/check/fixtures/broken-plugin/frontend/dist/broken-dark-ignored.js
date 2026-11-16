// Fails the dark mode gate: fixed colors that never change under prefers-color-scheme: dark.
class BrokenDarkIgnored extends HTMLElement {
  connectedCallback() {
    this.attachShadow({ mode: "open" }).innerHTML = "<style>p{color:#111;background:#fafafa}</style><p>Always light</p>";
  }
}
customElements.define("broken-dark-ignored", BrokenDarkIgnored);
