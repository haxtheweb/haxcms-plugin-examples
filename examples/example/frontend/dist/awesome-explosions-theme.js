// The "theme base" parent class would come from the HAXcms theme packages; shown here as a placeholder.
export class AwesomeExplosionsTheme extends HTMLElement {
  connectedCallback() { this.style.display = "block"; this.dataset.theme = "awesome-explosions"; }
}
customElements.define("awesome-explosions-theme", AwesomeExplosionsTheme);
