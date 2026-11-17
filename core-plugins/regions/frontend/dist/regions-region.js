// Renders the pages mapped to one region. Reads the published map from site.json (metadata.plugins.regions.map),
// falling back to the pre-plugin location (metadata.theme.regions) for sites whose install migration has not run.
// The platform registers the legacy tag `site-region` as an alias of this element (plugin.yaml legacy.tags).
// Placeholder rendering: the real element reuses the site store's content loading, as site-region does today.
class RegionsRegion extends HTMLElement {
  static get observedAttributes() { return ["name"]; }
  connectedCallback() { this.render(); }
  attributeChangedCallback() { if (this.isConnected) this.render(); }
  render() {
    const store = globalThis.HAXCMS && globalThis.HAXCMS.requestAvailability && globalThis.HAXCMS.requestAvailability().store;
    const manifest = store && store.getManifest ? store.getManifest() : null;
    const meta = (manifest && manifest.metadata) || {};
    const map = (meta.plugins && meta.plugins.regions && meta.plugins.regions.map) || (meta.theme && meta.theme.regions) || {};
    const ids = [].concat(map[this.getAttribute("name")] || []);
    this.dataset.items = ids.join(",");
  }
}
customElements.define("regions-region", RegionsRegion);
