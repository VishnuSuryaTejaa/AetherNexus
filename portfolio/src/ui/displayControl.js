import { gsap } from 'gsap';

// iOS 27-style display control: Liquid Glass intensity (Clear ↔ Tinted) and
// a Motion & particles switch. Opens from its button with a gel spring.
export function initDisplayControl(store) {
  const btn = document.getElementById('gc-btn');
  const panel = document.getElementById('gc-panel');
  const range = document.getElementById('gc-intensity');
  const out = document.getElementById('gc-out');
  const sw = document.getElementById('gc-motion');
  if (!btn || !panel) return;

  const paint = () => {
    const v = Math.round(store.gi * 100);
    range.value = String(v);
    range.style.setProperty('--p', `${v}%`);
    out.textContent = v <= 2 ? 'Clear' : v >= 98 ? 'Tinted' : `${v}%`;
    sw.setAttribute('aria-checked', String(store.motion));
  };
  paint();
  store.subscribe(paint);

  let open = false;
  const setOpen = (next) => {
    if (next === open) return;
    open = next;
    btn.setAttribute('aria-expanded', String(open));
    const quick = !store.motion;
    gsap.killTweensOf(panel);
    if (open) {
      panel.hidden = false;
      gsap.fromTo(
        panel,
        { scale: 0.35, opacity: 0, y: 24 },
        { scale: 1, opacity: 1, y: 0, duration: quick ? 0.01 : 0.7, ease: 'elastic.out(1, 0.78)' },
      );
      gsap.fromTo(btn, { scale: 0.86 }, { scale: 1, duration: quick ? 0.01 : 0.6, ease: 'elastic.out(1.1, 0.5)' });
    } else {
      gsap.to(panel, {
        scale: 0.5,
        opacity: 0,
        y: 16,
        duration: quick ? 0.01 : 0.24,
        ease: 'power2.in',
        onComplete: () => {
          panel.hidden = true;
        },
      });
    }
  };

  btn.addEventListener('click', () => setOpen(!open));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) {
      setOpen(false);
      btn.focus();
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (open && !e.target.closest('#gc')) setOpen(false);
  });

  range.addEventListener('input', () => {
    store.set({ gi: Number(range.value) / 100 });
  });
  sw.addEventListener('click', () => store.set({ motion: !store.motion }));
}
