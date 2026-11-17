import { NeonGlowTheme } from "./neon-glow-theme.js";
// A child theme: inherits the parent's class and falls back to its registry entry.
class NeonSunsetTheme extends NeonGlowTheme {
  connectedCallback() { super.connectedCallback(); this.dataset.theme = "neon-sunset"; }
}
customElements.define("neon-sunset-theme", NeonSunsetTheme);
