// Small touches: copy-to-clipboard toast, live IST clock, degree progress,
// velocity-reactive marquee, touch-aware hint copy — and pausing every CSS /
// SVG animation that is off-screen so it costs nothing.

export function initMisc() {
  // ---- toast
  const toast = document.querySelector('.toast');
  let toastTimer = 0;
  const showToast = (msg) => {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-on'), 2200);
  };

  // ---- copy email
  document.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const value = btn.dataset.copy;
      let ok = false;
      try {
        await navigator.clipboard.writeText(value);
        ok = true;
      } catch {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.appendChild(ta);
        ta.select();
        try {
          ok = document.execCommand('copy');
        } catch {
          ok = false;
        }
        ta.remove();
      }
      showToast(ok ? 'Email copied to clipboard' : value);
      const labelEl = btn.querySelector('span');
      if (ok && labelEl) {
        labelEl.textContent = 'Copied';
        setTimeout(() => {
          labelEl.textContent = 'Copy';
        }, 1800);
      }
    });
  });

  // ---- live IST clock
  const clock = document.getElementById('ist-clock');
  if (clock) {
    const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false });
    const tick = () => {
      const now = new Date();
      clock.textContent = fmt.format(now);
      clock.dateTime = now.toISOString();
    };
    tick();
    setInterval(tick, 15000);
  }

  // ---- degree progress (Aug 2023 → May 2027)
  const edu = document.querySelector('.edu__progress span');
  if (edu) {
    const start = Date.UTC(2023, 7, 1);
    const end = Date.UTC(2027, 4, 31);
    const p = Math.min(1, Math.max(0, (Date.now() - start) / (end - start)));
    edu.style.setProperty('--edu', p.toFixed(3));
    edu.parentElement.setAttribute('title', `${Math.round(p * 100)}% of the degree complete`);
  }


  // ---- pause CSS + SMIL animations while their region is off-screen
  const pauseIO = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        e.target.classList.toggle('is-offscreen', !e.isIntersecting);
        const svg = e.target.querySelector('svg.diagram');
        if (svg?.pauseAnimations) {
          if (e.isIntersecting) svg.unpauseAnimations();
          else svg.pauseAnimations();
        }
      }
    },
    { rootMargin: '15% 0px' },
  );
  document.querySelectorAll('.project__visual, .marquee, .hero, .contact').forEach((el) => {
    // below-the-fold regions start paused; the observer wakes them in view
    if (!el.matches('.hero, .contact')) {
      el.classList.add('is-offscreen');
      el.querySelector('svg.diagram')?.pauseAnimations?.();
    }
    pauseIO.observe(el);
  });

  // ---- marquee reacts to scroll velocity
  const track = document.querySelector('.marquee__track');
  let anim = null;
  return {
    tick(velocity) {
      if (Math.abs(velocity || 0) < 0.5 && !anim) return;
      anim ||= track?.getAnimations?.()[0] || null;
      if (!anim) return;
      const target = 1 + Math.min(6, Math.abs(velocity || 0) * 0.12);
      if (Math.abs(anim.playbackRate - target) < 0.01) return;
      anim.playbackRate += (target - anim.playbackRate) * 0.08;
    },
  };
}
