// Scroll choreography without an animation framework.
//  · one-shot reveals + count-ups → IntersectionObserver + CSS transitions
//  · three scrubbed effects (thesis words, project deck, timeline) → measured
//    once per frame, only while near the viewport, in a read phase followed by
//    a write phase, so nothing forces a synchronous layout

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

// Wrap every word in a span without touching layout (no measuring needed)
function splitWords(root) {
  const words = [];
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        const parts = child.textContent.split(/(\s+)/);
        const frag = document.createDocumentFragment();
        for (const part of parts) {
          if (!part) continue;
          if (/^\s+$/.test(part)) {
            frag.appendChild(document.createTextNode(part));
          } else {
            const span = document.createElement('span');
            span.className = 'w';
            span.textContent = part;
            frag.appendChild(span);
            words.push(span);
          }
        }
        child.replaceWith(frag);
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        walk(child);
      }
    }
  };
  walk(root);
  return words;
}

function countUp(el, animate) {
  const to = Number(el.dataset.count);
  const from = el.dataset.from ? Number(el.dataset.from) : 0;
  if (!animate) {
    el.textContent = String(to);
    return;
  }
  const t0 = performance.now();
  const dur = 1600;
  const step = (now) => {
    const t = clamp((now - t0) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = String(Math.round(from + (to - from) * e));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function initReveals(store) {
  const html = document.documentElement;

  // ---- one-shot reveals (stagger within each batch of entries)
  const io = new IntersectionObserver(
    (entries) => {
      let i = 0;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.style.setProperty('--rd', String(i++));
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  document.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el));

  // ---- count-ups
  const cio = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        cio.unobserve(e.target);
        countUp(e.target, store.motion);
      }
    },
    { rootMargin: '0px 0px -8% 0px' },
  );
  document.querySelectorAll('[data-count]').forEach((el) => {
    if (store.motion) el.textContent = el.dataset.from || '0';
    cio.observe(el);
  });

  // ---- scrubbed effects
  const statement = document.querySelector('[data-words]');
  const words = statement ? splitWords(statement) : [];
  const wordOp = new Float32Array(words.length).fill(-1);
  // Floor keeps every word ≥ 3:1 (large text): white words 40%, coloured 56%
  const wordMin = words.map((w) => (w.closest('em') ? 0.56 : 0.4));
  const deckEl = document.querySelector('.deck');
  const cards = [...document.querySelectorAll('.project')];
  const cardState = cards.map(() => ({ s: -1, o: -1 }));
  const timeline = document.querySelector('.timeline');
  const progressEl = document.querySelector('.timeline__progress');
  const deckMQ = window.matchMedia('(min-width: 1024px) and (min-height: 740px)');

  const near = new Set();
  const nio = new IntersectionObserver((entries) => entries.forEach((e) => (e.isIntersecting ? near.add(e.target) : near.delete(e.target))), {
    rootMargin: '30% 0px 30% 0px',
  });
  [statement, deckEl, timeline].filter(Boolean).forEach((el) => nio.observe(el));

  let m = null;
  let lastTl = -1;

  const settle = () => {
    words.forEach((w) => (w.style.opacity = ''));
    wordOp.fill(-1);
    cards.forEach((c, i) => {
      c.style.transform = '';
      c.style.opacity = '';
      cardState[i] = { s: -1, o: -1 };
    });
    if (progressEl) progressEl.style.transform = 'scaleY(1)';
    lastTl = 1;
    document.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-in'));
  };

  store.subscribe((s, patch) => {
    if ('motion' in patch && !s.motion) settle();
  });

  return {
    // read phase
    measure() {
      if (!store.motion) {
        m = null;
        return;
      }
      const vh = window.innerHeight;
      m = { vh };
      if (statement && near.has(statement)) {
        const r = statement.getBoundingClientRect();
        m.st = [r.top, r.height];
      }
      if (deckEl && near.has(deckEl) && deckMQ.matches) m.cards = cards.map((c) => c.getBoundingClientRect().top);
      if (timeline && near.has(timeline)) {
        const r = timeline.getBoundingClientRect();
        m.tl = [r.top, r.height];
      }
    },
    // write phase
    apply() {
      if (!m) return;
      const { vh } = m;
      if (m.st) {
        // thesis words brighten from 40% (still AA for large text) to 100%
        const [top, h] = m.st;
        const p = clamp((vh * 0.8 - top) / (vh * 0.3 + h));
        const n = words.length;
        for (let i = 0; i < n; i++) {
          const lo = wordMin[i];
          const o = Math.round((lo + (1 - lo) * clamp((p - (i / n) * 0.75) / 0.25)) * 100) / 100;
          if (o !== wordOp[i]) {
            wordOp[i] = o;
            words[i].style.opacity = String(o);
          }
        }
      }
      if (m.cards) {
        // stacked deck: covered cards recede, two-deep cards fade out
        for (let i = 0; i < cards.length - 1; i++) {
          const p1 = clamp((vh - m.cards[i + 1]) / (vh * 0.78));
          const p2 = i + 2 < cards.length ? clamp((vh - m.cards[i + 2]) / (vh * 0.55)) : 0;
          const s = Math.round((1 - 0.05 * p1 - 0.05 * p2) * 1000) / 1000;
          const o = Math.round((1 - 0.58 * p1) * (1 - p2) * 100) / 100;
          const st = cardState[i];
          if (s !== st.s || o !== st.o) {
            st.s = s;
            st.o = o;
            cards[i].style.transform = s === 1 ? '' : `scale(${s})`;
            cards[i].style.opacity = o === 1 ? '' : String(o);
          }
        }
      } else if (!deckMQ.matches && cardState[0].s !== -1) {
        cards.forEach((c, i) => {
          c.style.transform = '';
          c.style.opacity = '';
          cardState[i] = { s: -1, o: -1 };
        });
      }
      if (m.tl && progressEl) {
        const [top, h] = m.tl;
        const p = Math.round(clamp((vh * 0.72 - top) / (vh * 0.1 + h)) * 1000) / 1000;
        if (p !== lastTl) {
          lastTl = p;
          progressEl.style.transform = `scaleY(${p})`;
        }
      }
    },
    settle,
    get reduced() {
      return html.dataset.motion === 'reduced';
    },
  };
}
