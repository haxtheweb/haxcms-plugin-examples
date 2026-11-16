// A block element, written the way HAX elements are: a LitElement, shipped as a plain ES module that imports `lit`
// by name. A site resolves that through its import map (spec/07, Authoring) and hax-plugin-check through the
// installed package, so there is no build step during development (hax plugin build optimizes for shipping).
// Its editable properties are described in awesome-explosion.haxProperties.json.
import { LitElement, html, css } from "lit";

class AwesomeExplosion extends LitElement {
  static get properties() {
    return { intensity: { type: Number, reflect: true } };
  }
  static get styles() {
    return css`
      :host {
        display: block;
      }
    `;
  }
  constructor() {
    super();
    this.intensity = 1;
  }
  render() {
    return html`<span role="img" aria-label="Explosion, intensity ${this.intensity}">${"💥".repeat(Math.max(1, Number(this.intensity) || 1) * 3)}</span><slot></slot>`;
  }
}
customElements.define("awesome-explosion", AwesomeExplosion);
