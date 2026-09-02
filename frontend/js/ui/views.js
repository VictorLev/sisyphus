// No router library — a handful of statically-defined <section data-view>
// elements toggled via the hidden attribute.
const sections = new Map();

export function initViews() {
  document.querySelectorAll('[data-view]').forEach((el) => {
    sections.set(el.dataset.view, el);
    el.hidden = true;
  });
}

export function showView(name) {
  for (const [viewName, el] of sections) {
    el.hidden = viewName !== name;
  }
  document.dispatchEvent(new CustomEvent('viewchange', { detail: { view: name } }));
}
