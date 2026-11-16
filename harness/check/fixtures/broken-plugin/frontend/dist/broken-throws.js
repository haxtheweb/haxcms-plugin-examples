// Fails the load gate: throws while connecting.
class BrokenThrows extends HTMLElement {
  connectedCallback() {
    throw new Error("broken on purpose");
  }
}
customElements.define("broken-throws", BrokenThrows);
