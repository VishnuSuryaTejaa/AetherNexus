// Section-aware nav. An IntersectionObserver band picks the active section;
// each link group (desktop capsule, mobile tab bar) carries a liquid
// selection that flows from item to item (see ui/liquid.js).
import { Liquid } from './liquid.js';

export function initNav(store) {
  const groups = [...document.querySelectorAll('[data-liquid]')].map((el) => new Liquid(el, store));
  let current = null;
  const setActive = (id) => {
    if (id === current) return;
    current = id;
    groups.forEach((g) => g.setActive(id));
  };

  // A thin band across the middle of the viewport decides the active section
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
    },
    { rootMargin: '-45% 0px -50% 0px' },
  );
  ['top', 'about', 'work', 'experience', 'skills', 'contact'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) io.observe(el);
  });
  // Layout changes re-seat the drop without a flow
  const remeasure = () => groups.forEach((g) => g.active && g.to(g.active, true));
  window.addEventListener('resize', remeasure);
  document.fonts?.ready.then(remeasure);

  return {
    tick(dt) {
      for (const g of groups) g.tick(dt);
    },
  };
}
