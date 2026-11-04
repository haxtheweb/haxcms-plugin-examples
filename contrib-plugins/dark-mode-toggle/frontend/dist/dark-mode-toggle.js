// A floating light/dark switch. Settings arrive as attributes baked in at render; the visitor's choice is kept in
// localStorage (a per-visitor convenience, never sent anywhere). DDD themes read the color-scheme on <html>.
class DarkModeToggle extends HTMLElement {
  connectedCallback() {
    let stored = null;
    try { stored = localStorage.getItem("hax-color-scheme"); } catch (e) { /* storage blocked */ }
    const start = stored || this.getAttribute("default") || "system";
    this.apply(start === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : start);
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", "Dark mode");
    b.addEventListener("click", () => { const next = document.documentElement.dataset.colorScheme === "dark" ? "light" : "dark"; this.apply(next); try { localStorage.setItem("hax-color-scheme", next); } catch (e) { /* storage blocked */ } });
    this.append(b);
    this.style.cssText = `position:fixed;${this.getAttribute("position") === "bottom-left" ? "left" : "right"}:var(--ddd-spacing-4,16px);bottom:var(--ddd-spacing-4,16px);z-index:1000`;
  }
  apply(scheme) {
    document.documentElement.dataset.colorScheme = scheme;
    document.documentElement.style.colorScheme = scheme;
    const b = this.querySelector("button");
    if (b) { b.setAttribute("aria-pressed", String(scheme === "dark")); b.textContent = scheme === "dark" ? "☾" : "☀"; }
  }
}
customElements.define("dark-mode-toggle", DarkModeToggle);
