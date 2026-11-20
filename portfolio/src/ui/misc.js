// Small touches: copy-to-clipboard toast, live IST clock, degree progress,
// velocity-reactive marquee and touch-aware hint copy.

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

  // ---- hint copy for touch screens
  if (window.matchMedia('(pointer: coarse)').matches) {
    const hint = document.querySelector('.hint-text');
    if (hint) hint.textContent = 'Touch the portrait to add noise';
  }

  // ---- marquee reacts to scroll velocity
  const track = document.querySelector('.marquee__track');
  const anim = track?.getAnimations?.()[0];
  return {
    tick(velocity) {
      if (!anim) return;
      const target = 1 + Math.min(6, Math.abs(velocity || 0) * 0.12);
      anim.playbackRate += (target - anim.playbackRate) * 0.08;
    },
  };
}
