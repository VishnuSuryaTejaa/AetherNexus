// Shared display state: Liquid Glass intensity (iOS 27 slider) + motion preference.
const KEY = 'vst:display';
const listeners = new Set();
const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

let saved = {};
try {
  saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
} catch {
  saved = {};
}

export const store = {
  gi: typeof saved.gi === 'number' ? Math.min(1, Math.max(0, saved.gi)) : 0.5,
  motion: typeof saved.motion === 'boolean' ? saved.motion : !reduceQuery.matches,

  set(patch) {
    Object.assign(this, patch);
    persist();
    apply();
    listeners.forEach((fn) => fn(this, patch));
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ gi: store.gi, motion: store.motion }));
  } catch {
    /* storage unavailable (private mode) — state still works for this visit */
  }
}

function apply() {
  const root = document.documentElement;
  root.style.setProperty('--gi', String(store.gi));
  root.dataset.motion = store.motion ? 'full' : 'reduced';
}

apply();
