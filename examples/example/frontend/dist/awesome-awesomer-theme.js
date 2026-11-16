// A child theme: extends the parent theme's class and declares `extends` in its registry entry, so it falls back
// to the parent's settings and assets. The tag still starts with the plugin's tagPrefix (awesome-).
import { AwesomeExplosionsTheme } from "./awesome-explosions-theme.js";
export class AwesomerExplosionsTheme extends AwesomeExplosionsTheme {
  connectedCallback() { super.connectedCallback(); this.dataset.theme = "awesome-awesomer"; }
}
customElements.define("awesome-awesomer-theme", AwesomerExplosionsTheme);
