// Placeholder: a real theme extends the HAXcms theme base (HAXCMSLitElementTheme) and renders site-menu, regions, etc.
export class NeonGlowTheme extends HTMLElement {
  connectedCallback() { this.dataset.theme = "neon-glow"; }
}
customElements.define("neon-glow-theme", NeonGlowTheme);
