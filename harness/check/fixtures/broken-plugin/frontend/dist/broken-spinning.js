// Fails the reduced motion gate: an infinite animation that ignores prefers-reduced-motion.
class BrokenSpinning extends HTMLElement {
  connectedCallback() {
    this.attachShadow({ mode: "open" }).innerHTML =
      "<style>@keyframes spin{to{transform:rotate(360deg)}}span{display:inline-block;animation:spin 1s linear infinite}@media (prefers-color-scheme: dark){span{color:#eee}}</style><span>*</span>";
  }
}
customElements.define("broken-spinning", BrokenSpinning);
