import { AwesomeExplosionsTheme } from "./awesome-explosions-theme.js";
export class AwesomerExplosionsTheme extends AwesomeExplosionsTheme {
  connectedCallback() { super.connectedCallback(); this.dataset.theme = "awesome-awesomer"; }
}
customElements.define("awesome-awesomer-theme", AwesomerExplosionsTheme);
