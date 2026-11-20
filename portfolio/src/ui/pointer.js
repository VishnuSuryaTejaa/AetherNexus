import { gsap } from 'gsap';

// Pointer craft, without anything that chases the cursor:
//  · press illumination — glass lights up from the exact point you touch it
//    (iOS 26/27 behaviour); position is set once per press, never tracked
//  · magnetic CTAs — a subtle 6px pull with a spring release
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
    const xTo = gsap.quickTo(el, 'x', { duration: 0.7, ease: 'elastic.out(1, 0.45)' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.7, ease: 'elastic.out(1, 0.45)' });
    const clamp = gsap.utils.clamp(-6, 6);
    el.addEventListener('pointermove', (e) => {
      if (!store.motion) return;
      const r = el.getBoundingClientRect();
      xTo(clamp((e.clientX - (r.left + r.width / 2)) * 0.2));
      yTo(clamp((e.clientY - (r.top + r.height / 2)) * 0.3));
    });
    el.addEventListener('pointerleave', () => {
      xTo(0);
      yTo(0);
    });
  });
}
