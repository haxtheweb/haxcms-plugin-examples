// The term as written, with its definition on hover and focus. Plain ES module.
//
// Accessibility: the focusable term and its definition live in the same shadow root, so the
// aria-describedby reference resolves and screen readers announce the definition with the term
// (an id reference cannot cross from the host into its shadow root). The definition shows on hover
// and focus, stays while the pointer is over it, and Escape hides it until the pointer leaves or
// focus moves (WCAG 1.4.13, content on hover or focus). Colors follow light and dark mode.
class GlossaryTerm extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>:host{position:relative}.term{border-bottom:1px dotted currentColor;cursor:help}.term:focus-visible{outline:var(--ddd-border-sm,2px) solid currentColor;outline-offset:2px}span[role=tooltip]{display:none;position:absolute;inset-block-start:100%;inset-inline-start:0;z-index:1;min-inline-size:16em;padding:var(--ddd-spacing-2,8px);background:light-dark(var(--ddd-theme-default-white,#fff),var(--ddd-theme-default-coalyGray,#222));color:light-dark(var(--ddd-theme-default-coalyGray,#222),var(--ddd-theme-default-white,#fff));border:var(--ddd-border-xs,1px solid)}:host(:hover:not([data-dismissed])) span[role=tooltip],.term:focus+span[role=tooltip]{display:block}:host([data-dismissed]) .term:focus+span[role=tooltip]{display:none}</style><span class="term" tabindex="0" aria-describedby="d"><slot></slot></span><span role="tooltip" id="d"></span>`;
    root.getElementById("d").textContent = this.getAttribute("definition") || "";
    const term = root.querySelector(".term");
    this.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.setAttribute("data-dismissed", "");
    });
    const reset = () => this.removeAttribute("data-dismissed");
    this.addEventListener("mouseleave", reset);
    term.addEventListener("blur", reset);
  }
}
customElements.define("glossary-term", GlossaryTerm);
