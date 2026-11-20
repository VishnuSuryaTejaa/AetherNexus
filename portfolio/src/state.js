// Shared display state. Motion follows the visitor's OS setting
// (prefers-reduced-motion) and updates live if they change it.
const listeners = new Set();
const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

export const store = {
  gi: 0.5, // Liquid Glass intensity — Apple's midpoint default
  motion: !reduceQuery.matches,

  set(patch) {
    Object.assign(this, patch);
    apply();
    listeners.forEach((fn) => fn(this, patch));
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

function apply() {
  const root = document.documentElement;
  root.style.setProperty('--gi', String(store.gi));
  root.dataset.motion = store.motion ? 'full' : 'reduced';
}

reduceQuery.addEventListener?.('change', (e) => store.set({ motion: !e.matches }));
apply();
