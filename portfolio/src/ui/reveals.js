import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';

// Wrap each hero line's content so it can rise out of a clipping mask
function prepareHeroLines() {
  document.querySelectorAll('.hero__line').forEach((line) => {
    if (line.querySelector('.hero__line-inner')) return;
    const inner = document.createElement('span');
    inner.className = 'hero__line-inner';
    while (line.firstChild) inner.appendChild(line.firstChild);
    line.appendChild(inner);
  });
}

const entrances = [];

// Motion switched off mid-visit: finish every entrance so nothing stays hidden
export function settleReveals() {
  entrances.forEach((t) => t.progress(1));
  gsap.set('[data-reveal], [data-intro], .topbar .nav', { opacity: 1, y: 0 });
}

export function initReveals(store) {
  prepareHeroLines();
  const all = '[data-reveal], [data-intro]';
  const showAll = () => gsap.set(all, { opacity: 1, y: 0, clearProps: 'transform' });

  const statement = document.querySelector('[data-words]');

  if (!store.motion) {
    showAll();
    gsap.set('.topbar .nav', { opacity: 1 });
    countAll(false);
    return;
  }

  // ---- hero intro
  const tl = gsap.timeline({ delay: 0.1, defaults: { ease: 'expo.out' } });
  tl.fromTo('.topbar .nav', { y: -24, scale: 0.86, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 1.1, ease: 'elastic.out(1, 0.8)' }, 0)
    .to('.eyebrow', { opacity: 1, y: 0, duration: 0.9 }, 0.15)
    .from('.hero__line-inner', { yPercent: 112, duration: 1.25, stagger: 0.1 }, 0.2)
    .to('.hero__lede, .hero__actions, .status', { opacity: 1, y: 0, duration: 1, stagger: 0.08 }, 0.5);
  entrances.push(tl);

  // ---- generic reveals (opacity + translate only: never filters on glass)
  ScrollTrigger.batch('[data-reveal]', {
    start: 'top 90%',
    once: true,
    onEnter: (batch) =>
      gsap.to(batch, { opacity: 1, y: 0, duration: 1.1, ease: 'expo.out', stagger: 0.08, overwrite: 'auto' }),
  });

  // ---- split headings: lines rise out of masks
  document.querySelectorAll('[data-split]').forEach((el) => {
    SplitText.create(el, {
      type: 'lines',
      mask: 'lines',
      linesClass: 'split-line',
      autoSplit: true,
      onSplit(self) {
        const tween = gsap.from(self.lines, {
          yPercent: 110,
          duration: 1.15,
          stagger: 0.09,
          ease: 'expo.out',
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        });
        entrances.push(tween);
        return tween;
      },
    });
  });

  // ---- thesis statement: words brighten with scroll
  if (statement) {
    const words = SplitText.create(statement, { type: 'words', wordsClass: 'word' });
    gsap.fromTo(
      words.words,
      { opacity: 0.14 },
      {
        opacity: 1,
        stagger: 0.06,
        ease: 'none',
        scrollTrigger: { trigger: statement, start: 'top 80%', end: 'bottom 50%', scrub: 0.6 },
      },
    );
  }

  countAll(true);

  // ---- project deck: covered cards recede (desktop with enough height)
  const mm = gsap.matchMedia();
  mm.add('(min-width: 1024px) and (min-height: 740px)', () => {
    const cards = gsap.utils.toArray('.project');
    cards.forEach((card, i) => {
      const next = cards[i + 1];
      const after = cards[i + 2];
      if (!next) return;
      // Stage 1: the next card slides over → this one recedes into the stack
      gsap.fromTo(
        card,
        { scale: 1, opacity: 1 },
        {
          scale: 0.95,
          opacity: 0.42,
          ease: 'none',
          immediateRender: false,
          scrollTrigger: { trigger: next, start: 'top bottom', end: 'top 22%', scrub: true },
        },
      );
      // Stage 2: two cards deep → fade out so stacked titles never overlap
      if (after) {
        gsap.fromTo(
          card,
          { scale: 0.95, opacity: 0.42 },
          {
            scale: 0.9,
            opacity: 0,
            ease: 'none',
            immediateRender: false,
            scrollTrigger: { trigger: after, start: 'top bottom', end: 'top 45%', scrub: true },
          },
        );
      }
    });
  });

  // ---- timeline progress line
  gsap.fromTo(
    '.timeline__progress',
    { scaleY: 0 },
    { scaleY: 1, ease: 'none', scrollTrigger: { trigger: '.timeline', start: 'top 72%', end: 'bottom 62%', scrub: true } },
  );
}

function countAll(animate) {
  document.querySelectorAll('[data-count]').forEach((el) => {
    const to = Number(el.dataset.count);
    const from = el.dataset.from ? Number(el.dataset.from) : 0;
    if (!animate) {
      el.textContent = String(to);
      return;
    }
    const o = { v: from };
    el.textContent = String(Math.round(from));
    ScrollTrigger.create({
      trigger: el,
      start: 'top 92%',
      once: true,
      onEnter: () =>
        gsap.to(o, {
          v: to,
          duration: 1.8,
          ease: 'power3.out',
          onUpdate: () => {
            el.textContent = String(Math.round(o.v));
          },
        }),
    });
  });
}
