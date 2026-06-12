// Sandboxed preload: flips the shell flag so the web build activates its
// desktop chrome (drag region, traffic-light inset) — see frontend.md.
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.dataset.shell = 'desktop';
});
