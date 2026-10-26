// Page module lifecycle. Barba never runs the incoming page's own scripts, so every page carries this one
// bundle, and the module for the current namespace is started with init(container) and stopped with destroy().
//
// A module is a factory: (container, info) => ({ destroy?, restore? }).
//   info.arrival: 'load' (fresh page load) | 'flip' (arrived by a Barba page transition)
//   destroy(): stop timers, listeners and tickers. It must NOT revert visuals: the old page is still visible
//              while it turns away.
//   restore(): optional, called when the page comes back from the back/forward cache.

const registry = new Map();
let active = null;

export function register(namespace, factory) {
  registry.set(namespace, factory);
}

export function mount(container, info = {}) {
  unmount();
  const ns = container ? container.getAttribute('data-barba-namespace') : null;
  const wrapper = document.querySelector('[data-barba="wrapper"]');
  if (wrapper && ns) wrapper.setAttribute('data-namespace', ns);
  const factory = registry.get(ns);
  let inst = {};
  if (factory) {
    try {
      inst = factory(container, info) || {};
    } catch (err) {
      console.error(`[v4] ${ns} module failed to start`, err);
      inst = {};
    }
  }
  active = Object.assign(inst, { ns, container });
  return active;
}

export function unmount() {
  if (!active) return;
  const mod = active;
  active = null;
  try {
    if (mod.destroy) mod.destroy();
  } catch (err) {
    console.error(`[v4] ${mod.ns} module failed to stop`, err);
  }
}

export const activeModule = () => active;
