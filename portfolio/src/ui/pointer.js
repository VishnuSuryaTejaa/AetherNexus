// Pointer craft, without anything that chases the cursor:
//  · press illumination — glass lights up from the exact point you touch it
//    (iOS 26/27 behaviour); position is set once per press, never tracked
//  · magnetic CTAs — a subtle 6px pull; CSS `translate` + spring easing does
//    the motion, so there is no animation loop
const clamp = (v) => Math.max(-6, Math.min(6, v));

export function initPointerFx(store) {
  document.addEventListener(
    'pointerdown',
    (e) => {
      const glass = e.target.closest?.('.glass');
      if (!glass) return;
      const r = glass.getBoundingClientRect();
      glass.style.setProperty('--px', `${e.clientX - r.left}px`);
      glass.style.setProperty('--py', `${e.clientY - r.top}px`);
    },
    { passive: true },
  );

  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  document.querySelectorAll('[data-magnetic]').forEach((el) => {
    let rect = null;
    el.addEventListener('pointerenter', () => {
      rect = el.getBoundingClientRect();
    });
    el.addEventListener('pointermove', (e) => {
      if (!store.motion || !rect) return;
      const x = clamp((e.clientX - (rect.left + rect.width / 2)) * 0.2);
      const y = clamp((e.clientY - (rect.top + rect.height / 2)) * 0.3);
      el.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
    });
    el.addEventListener('pointerleave', () => {
      el.style.translate = '';
      rect = null;
    });
  });
}
