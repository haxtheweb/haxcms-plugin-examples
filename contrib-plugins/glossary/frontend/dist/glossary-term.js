// The term as written, with its definition on hover and focus. Plain ES module.
class GlossaryTerm extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    const def = this.getAttribute("definition") || "";
    root.innerHTML = `<style>:host{border-bottom:1px dotted currentColor;position:relative;cursor:help}span[role=tooltip]{display:none;position:absolute;inset-block-start:100%;inset-inline-start:0;z-index:1;min-inline-size:16em;padding:var(--ddd-spacing-2,8px);background:var(--ddd-theme-default-white,#fff);color:var(--ddd-theme-default-coalyGray,#222);border:var(--ddd-border-xs,1px solid)}:host(:hover) span[role=tooltip],:host(:focus) span[role=tooltip]{display:block}</style><slot></slot><span role="tooltip" id="d"></span>`;
    root.getElementById("d").textContent = def;
    this.tabIndex = 0;
    this.setAttribute("aria-describedby", "d");
  }
}
customElements.define("glossary-term", GlossaryTerm);
