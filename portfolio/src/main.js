import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import 'lenis/dist/lenis.css';
import './styles/base.css';
import './styles/glass.css';
import './styles/sections.css';
import './styles/ui.css';

import { store } from './state.js';
import { initLiquidGlass } from './ui/liquidGlass.js';
import { initNav } from './ui/nav.js';
import { initReveals } from './ui/reveals.js';
import { initPointerFx } from './ui/pointer.js';
import { initMisc } from './ui/misc.js';
import { pickTier, probeGpu } from './gl/gpu.js';
import portraitSample from './assets/portrait-sample.webp';

// Loading strategy
// 1. HTML + CSS paint the page; the hero intro is pure CSS, so the largest
//    text is visible on the first frame (LCP never waits for JavaScript)
// 2. this module wires light UI (observers, springs) — no animation framework
// 3. after `load` and an idle slot: Liquid Glass maps, smooth scroll, and the
//    WebGL engine (its maths runs in a worker, its shaders compile in parallel)

const root = document.documentElement;
const $ = (s) => document.querySelector(s);

const idle = (timeout = 1200) =>
  new Promise((resolve) => {
    if ('requestIdleCallback' in window) requestIdleCallback(() => resolve(), { timeout });
    else setTimeout(resolve, 150);
  });
const loaded = () =>
  new Promise((resolve) => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', () => resolve(), { once: true });
  });

let lenis = null;
let engine = null;

async function startLenis() {
  if (lenis || !store.motion || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const { default: Lenis } = await import('lenis');
  if (lenis || !store.motion) return;
  lenis = new Lenis({ duration: 1.15, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), anchors: false, autoRaf: false });
}

function stopLenis() {
  lenis?.destroy();
  lenis = null;
}

// ------------------------------------------------------------------ particles
// No (hardware) WebGL: the nano-halftone portrait, drawn into a canvas so a
// late decorative image never becomes the page's LCP element
function showStaticPortrait() {
  root.classList.remove('has-gl');
  root.classList.add('no-gl');
  const canvas = $('.hero__fallback');
  if (canvas && !canvas.dataset.drawn) {
    canvas.dataset.drawn = '1';
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.src = canvas.dataset.src;
  }
  $('#hud-step').textContent = '50';
  $('#hud-sigma').textContent = '0.000';
  $('#hud-n').textContent = '12,518';
}

async function bootGL() {
  const gpu = await probeGpu();
  if (!gpu.ok) return showStaticPortrait();
  const canvas = $('#gl');
  const hudStep = $('#hud-step');
  const hudSigma = $('#hud-sigma');
  const chipName = $('#chip-formation');
  const chipSigma = $('#chip-sigma');
  try {
    const { Engine } = await import('./gl/Engine.js');
    const e = new Engine(canvas, {
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
    await e.init(portraitSample);
    engine = e;
    $('#hud-n').textContent = e.count.toLocaleString('en-US');
    root.classList.add('has-gl');
    e.startIntro();

    // keep section offsets fresh when layout settles (fonts, images, resize)
    let t = 0;
    const refresh = () => {
      clearTimeout(t);
      t = setTimeout(() => engine?.refresh(), 120);
    };
    new ResizeObserver(refresh).observe(document.body);
    window.addEventListener('resize', () => {
      engine?.resize();
      refresh();
    });
    canvas.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault();
      engine = null;
      showStaticPortrait();
    });
  } catch (err) {
    console.warn('[portfolio] WebGL particles unavailable — showing the static portrait.', err);
    engine = null;
    showStaticPortrait();
  }
}

// In-page links: sections use content-visibility, so render them all for a
// moment to measure the exact target, then glide there and hand focus over
let cvTimer = 0;
function goTo(hash) {
  const target = hash === '#top' ? document.getElementById('top') : document.querySelector(hash);
  if (!target) return;
  root.classList.add('cv-all');
  requestAnimationFrame(() => {
    const y = hash === '#top' ? 0 : target.getBoundingClientRect().top + window.scrollY;
    if (lenis) lenis.scrollTo(y, { duration: 1.2 });
    else window.scrollTo({ top: y, behavior: store.motion ? 'smooth' : 'auto' });
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    clearTimeout(cvTimer);
    cvTimer = setTimeout(() => root.classList.remove('cv-all'), 1800);
  });
}

// ------------------------------------------------------------------ boot
function boot() {
  const glass = initLiquidGlass(store);
  const nav = initNav(store);
  // second half of the UI wiring runs in its own task (keeps each task short)
  let reveals = { measure() {}, apply() {} };
  let misc = { tick() {} };
  setTimeout(() => {
    reveals = initReveals(store);
    initPointerFx(store);
    misc = initMisc();
  }, 0);

  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href^="#"]');
    if (!a || a.classList.contains('skip-link') || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
    const hash = a.getAttribute('href');
    if (hash.length < 2) return;
    e.preventDefault();
    history.pushState(null, '', hash);
    goTo(hash);
  });

  store.subscribe((s, patch) => {
    if (!('motion' in patch)) return;
    if (s.motion) startLenis();
    else stopLenis();
    engine?.setMotion(s.motion);
  });

  // one frame loop for everything: smooth scroll → reads → GL → writes
  let last = performance.now();
  let lastY = window.scrollY;
  let scrolled = false;
  const frame = (now) => {
    const dt = Math.min(0.1, Math.max(0.0001, (now - last) / 1000));
    last = now;
    lenis?.raf(now);
    const y = lenis ? lenis.scroll : window.scrollY;
    const v = lenis ? lenis.velocity : y - lastY;
    lastY = y;
    if (y > 40 !== scrolled) {
      scrolled = y > 40;
      root.classList.toggle('is-scrolled', scrolled);
    }
    reveals.measure();
    engine?.update(now / 1000, dt, y, v);
    reveals.apply();
    nav.tick(dt);
    misc.tick(v);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // the GPU probe runs in a worker immediately (warms the GPU channel off the
  // main thread); everything heavy waits for load + an idle slot
  const gpuReady = probeGpu();
  loaded()
    .then(() => idle(900))
    .then(() => gpuReady)
    .then((gpu) => {
      glass.start(gpu);
      startLenis();
      return idle(600);
    })
    .then(bootGL);
}

try {
  boot();
} catch (err) {
  // Never leave content hidden behind a failed enhancement layer
  console.error('[portfolio] boot failed', err);
  root.dataset.motion = 'reduced';
}
