// Fails the ARIA reference gate: the host points aria-describedby at an id inside its own shadow
// root, which no screen reader can follow (the bug glossary-term had).
class BrokenAriaRef extends HTMLElement {
  connectedCallback() {
    this.attachShadow({ mode: "open" }).innerHTML = '<slot></slot><span id="d">A description nobody hears</span>';
    this.tabIndex = 0;
    this.setAttribute("aria-describedby", "d");
    this.textContent = "Term";
  }
}
customElements.define("broken-aria-ref", BrokenAriaRef);
