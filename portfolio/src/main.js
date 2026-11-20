import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import 'lenis/dist/lenis.css';
import './styles/base.css';
import './styles/glass.css';
import './styles/sections.css';
import './styles/ui.css';

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';
import { store } from './state.js';
import { initLiquidGlass } from './ui/liquidGlass.js';
import { initNav } from './ui/nav.js';
import { initDisplayControl } from './ui/displayControl.js';
import { initReveals, settleReveals } from './ui/reveals.js';
import { initPointerFx } from './ui/pointer.js';
import { initMisc } from './ui/misc.js';
import { hasWebGL2, pickTier } from './gl/quality.js';
import portraitSample from './assets/portrait-sample.webp';
import portraitHalftone from './assets/portrait-halftone.webp';

gsap.registerPlugin(ScrollTrigger, SplitText);

const root = document.documentElement;
const $ = (s) => document.querySelector(s);

let lenis = null;
let engine = null;
let misc = { tick() {} };

function startLenis() {
  if (lenis) return;
  lenis = new Lenis({
    duration: 1.15,
    easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    anchors: true,
    autoRaf: false,
  });
  lenis.on('scroll', ScrollTrigger.update);
}

function stopLenis() {
  if (!lenis) return;
  lenis.destroy();
  lenis = null;
}

// ------------------------------------------------------------------ particles
async function bootGL() {
  const canvas = $('#gl');
  const hudStep = $('#hud-step');
  const hudSigma = $('#hud-sigma');
  const hudN = $('#hud-n');
  const chipName = $('#chip-formation');
  const chipSigma = $('#chip-sigma');

  const fallback = () => {
    root.classList.remove('has-gl');
    root.classList.add('no-gl');
    const img = $('.hero__fallback');
    if (img && !img.getAttribute('src')) img.src = portraitHalftone;
    hudStep.textContent = '50';
    hudSigma.textContent = '0.000';
    hudN.textContent = '12,518';
  };

  if (!hasWebGL2()) return fallback();

  try {
    const { ParticleEngine } = await import('./gl/ParticleEngine.js');
    engine = new ParticleEngine(canvas, {
      tier: pickTier(),
      motion: store.motion,
      anchors: {
        portrait: $('[data-anchor="portrait"]'),
        gap: $('[data-anchor="gap"]'),
        sphere: $('[data-anchor="sphere"]'),
        ring: $('[data-anchor="ring"]'),
      },
      sections: [...document.querySelectorAll('[data-formation]')],
      labelsRoot: $('#flabels'),
      onIntro: (step, sigma) => {
        hudStep.textContent = String(step).padStart(2, '0');
        hudSigma.textContent = sigma.toFixed(3);
      },
      onStatus: (name, sigma) => {
        chipName.textContent = name;
        chipSigma.textContent = sigma.toFixed(2);
      },
    });
    await engine.init(portraitSample);
    hudN.textContent = engine.count.toLocaleString('en-US');
    root.classList.add('has-gl');
    engine.startIntro();

    ScrollTrigger.addEventListener('refresh', () => engine?.refresh());
    window.addEventListener('resize', () => engine?.resize());
    document.fonts?.ready.then(() => engine?.refresh());
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      engine = null;
      fallback();
    });
  } catch (err) {
    console.warn('[portfolio] WebGL particles unavailable — showing the static portrait.', err);
    engine = null;
    fallback();
  }
}

// ------------------------------------------------------------------ boot
function boot() {
  initLiquidGlass(store);
  initDisplayControl(store);
  initNav(store);
  misc = initMisc();
  initPointerFx(store);
  if (store.motion) startLenis();
  initReveals(store);

  store.subscribe((s, patch) => {
    if (!('motion' in patch)) return;
    if (s.motion) {
      startLenis();
    } else {
      stopLenis();
      settleReveals();
    }
    engine?.setMotion(s.motion);
  });

  gsap.ticker.add((time, deltaMs) => {
    lenis?.raf(time * 1000);
    const dt = Math.max(0.0001, deltaMs / 1000);
    const y = lenis ? lenis.scroll : window.scrollY;
    const v = lenis ? lenis.velocity : 0;
    misc.tick(v);
    engine?.update(time, dt, y, v);
  });
  gsap.ticker.lagSmoothing(0);

  // Let the first paint (real HTML text) land before the GPU work starts
  requestAnimationFrame(() => setTimeout(bootGL, 30));
}

try {
  boot();
} catch (err) {
  // Never leave content hidden behind a failed animation layer
  console.error('[portfolio] boot failed', err);
  root.dataset.motion = 'reduced';
}
