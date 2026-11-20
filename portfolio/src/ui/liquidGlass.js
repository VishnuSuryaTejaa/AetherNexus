// Liquid Glass for the web — two layers generated per element from one
// physical model, a squircle bezel (see glassMaps.js):
//
// 1. Volumetric bezel shading — every browser. A PNG in the element's
//    background stack (--lg-spec): specular rim lit from above (iOS 27's
//    vertical light), internal reflection below, inner shadow for thickness.
// 2. Refraction — Chromium only (the one engine that accepts an SVG filter as
//    a backdrop-filter): an feDisplacementMap bends the backdrop through
//    Snell's law; strong GPUs also split R/G/B for a faint dispersion fringe.
//
// Maps are generated in a worker (OffscreenCanvas) and arrive as blob URLs, so
// the main thread only measures (in a ResizeObserver) and sets a variable.
import { displacementPixels, shadingPixels } from './glassMaps.js';

const REFRACT_MAX_AREA = 200000; // px² — big content panels keep CSS frost only (GPU budget)

export function isChromium() {
  const brands = navigator.userAgentData?.brands;
  return Array.isArray(brands) && brands.some((b) => /Chromium/i.test(b.brand));
}

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

const CHANNELS = [
  ['r', 0.9, '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0'],
  ['g', 1.0, '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0'],
  ['b', 1.12, '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'],
];

function writeFilter(filter, { w, h, url, scale, std, dispersion }) {
  filter.replaceChildren();
  for (const [k, v] of [
    ['x', 0],
    ['y', 0],
    ['width', w],
    ['height', h],
  ])
    filter.setAttribute(k, String(v));
  const blur = svg('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: std, edgeMode: 'duplicate', result: 'b' });
  const map = svg('feImage', { href: url, x: 0, y: 0, width: w, height: h, preserveAspectRatio: 'none', result: 'm' });
  filter.append(blur, map);
  if (!dispersion) {
    filter.append(svg('feDisplacementMap', { in: 'b', in2: 'm', scale: scale.toFixed(2), xChannelSelector: 'R', yChannelSelector: 'G' }));
  } else {
    for (const [c, k, values] of CHANNELS) {
      filter.append(
        svg('feDisplacementMap', { in: 'b', in2: 'm', scale: (scale * k).toFixed(2), xChannelSelector: 'R', yChannelSelector: 'G', result: `d${c}` }),
        svg('feColorMatrix', { in: `d${c}`, type: 'matrix', values, result: `c${c}` }),
      );
    }
    filter.append(svg('feBlend', { in: 'cr', in2: 'cg', mode: 'screen', result: 'crg' }), svg('feBlend', { in: 'crg', in2: 'cb', mode: 'screen' }));
  }
  return blur;
}

// Main-thread fallback encoder (browsers without OffscreenCanvas in workers)
function encodeHere({ W, H, data }) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.getContext('2d', { willReadFrequently: true }).putImageData(new ImageData(data, W, H), 0, 0);
  return c.toDataURL('image/png');
}

export function initLiquidGlass(store) {
  const root = document.documentElement;
  const dyn = document.createElement('style');
  dyn.id = 'glass-dynamic';
  document.head.appendChild(dyn);

  let refract = false;
  let dispersion = false;
  let current = null;
  let uid = 0;
  const defs = document.getElementById('lg-defs');
  const entries = new Map(); // el → { id, w, h, r, version, filter, blur, urls }
  const byId = new Map(); // id → el
  const metrics = new Map(); // el → { w, h, radius } from the ResizeObserver

  const values = (gi) => ({
    blurClear: +(3 + gi * 14).toFixed(1),
    blurPanel: +(12 + gi * 18).toFixed(1),
    sat: +(1.6 + gi * 0.35).toFixed(2),
  });

  function applyCss(v) {
    dyn.textContent =
      `.glass{-webkit-backdrop-filter:blur(${v.blurClear}px) saturate(${v.sat}) brightness(1.06);backdrop-filter:blur(${v.blurClear}px) saturate(${v.sat}) brightness(1.06)}` +
      `.glass--panel{-webkit-backdrop-filter:blur(${v.blurPanel}px) saturate(${v.sat - 0.15}) brightness(1.02);backdrop-filter:blur(${v.blurPanel}px) saturate(${v.sat - 0.15}) brightness(1.02)}`;
  }

  // Refraction keeps clear controls *clear*: a light frost so the lensing reads,
  // while dense panels keep their full diffusion for legibility.
  function refractStyle(el, entry) {
    const panel = el.classList.contains('glass--panel');
    const std = panel ? current.blurPanel : current.blurClear * 0.32;
    if (entry.blur) entry.blur.setAttribute('stdDeviation', std.toFixed(2));
    el.style.backdropFilter = `url(#${entry.id}) saturate(${panel ? current.sat - 0.15 : current.sat}) brightness(${panel ? 1.02 : 1.07})`;
    return std;
  }

  function setUrl(entry, key, value) {
    const old = entry.urls?.[key];
    if (old && old.startsWith('blob:')) URL.revokeObjectURL(old);
    (entry.urls ||= {})[key] = value;
    return value;
  }

  // Apply a finished map pair to its element
  function apply(el, entry, res) {
    const spec = res.spec instanceof Blob ? URL.createObjectURL(res.spec) : res.spec;
    el.style.setProperty('--lg-spec', `url("${setUrl(entry, 'spec', spec)}")`);
    if (res.disp) {
      if (!entry.filter) {
        entry.filter = svg('filter', {
          id: entry.id,
          filterUnits: 'userSpaceOnUse',
          primitiveUnits: 'userSpaceOnUse',
          'color-interpolation-filters': 'sRGB',
        });
        defs.appendChild(entry.filter);
      }
      const url = setUrl(entry, 'disp', res.disp instanceof Blob ? URL.createObjectURL(res.disp) : res.disp);
      const panel = el.classList.contains('glass--panel');
      const std = panel ? current.blurPanel : current.blurClear * 0.32;
      entry.blur = writeFilter(entry.filter, { w: entry.w, h: entry.h, url, scale: res.scale, std, dispersion });
      refractStyle(el, entry);
    } else if (entry.filter) {
      // grew past the refraction budget: fall back to the CSS frost
      entry.filter.remove();
      entry.filter = null;
      entry.blur = null;
      setUrl(entry, 'disp', null);
      el.style.backdropFilter = '';
    }
  }

  // ---- worker results land a few per frame, so style recalcs stay small
  const ready = [];
  let readyRaf = 0;
  const drain = () => {
    readyRaf = 0;
    for (const res of ready.splice(0, 4)) {
      const el = byId.get(res.id);
      const entry = el && entries.get(el);
      if (!entry || res.version !== entry.version || res.error) continue; // stale or failed
      apply(el, entry, res);
    }
    if (ready.length) readyRaf = requestAnimationFrame(drain);
  };

  // ---- worker
  let worker = null;
  const useWorker = typeof OffscreenCanvas !== 'undefined' && typeof Worker !== 'undefined';
  function getWorker() {
    if (worker || !useWorker) return worker;
    try {
      worker = new Worker(new URL('./glass.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        ready.push(e.data);
        if (!readyRaf) readyRaf = requestAnimationFrame(drain);
      };
    } catch {
      worker = null;
    }
    return worker;
  }

  function build(el) {
    const m = metrics.get(el);
    if (!m || m.w < 12 || m.h < 12) return;
    const { w, h } = m;
    const radius = Math.min(m.radius, w / 2, h / 2);
    let entry = entries.get(el);
    if (entry && entry.w === w && entry.h === h && entry.r === radius) return;
    if (!entry) {
      entry = { id: `lgf${uid++}`, version: 0 };
      entries.set(el, entry);
      byId.set(entry.id, el);
    }
    Object.assign(entry, { w, h, r: radius });
    entry.version++;
    const panel = el.classList.contains('glass--panel');
    const bezel = Math.max(8, Math.min(radius > 0 ? radius * 0.92 : 18, 36, Math.min(w, h) / 2 - 1));
    const strength = refract && el.hasAttribute('data-lg') && w * h <= REFRACT_MAX_AREA ? Number(el.dataset.lgStrength || 2.1) : 0;
    const job = { id: entry.id, version: entry.version, w, h, radius, bezel, power: panel ? 0.78 : 1, strength };
    const wk = getWorker();
    if (wk) {
      wk.postMessage(job);
      return;
    }
    const res = { spec: encodeHere(shadingPixels(w, h, radius, bezel, job.power)) };
    if (strength) {
      const d = displacementPixels(w, h, radius, bezel, strength);
      res.disp = encodeHere(d);
      res.scale = d.scale;
    }
    apply(el, entry, res);
  }

  // Sizes come from the ResizeObserver (layout is already clean there), so
  // nothing here forces a synchronous layout
  const pending = new Set();
  let raf = 0;
  const flush = () => {
    raf = 0;
    const t0 = performance.now();
    for (const el of pending) {
      pending.delete(el);
      build(el);
      if (performance.now() - t0 > 6) break;
    }
    if (pending.size) raf = requestAnimationFrame(flush);
  };
  const queue = (el) => {
    pending.add(el);
    if (!raf) raf = requestAnimationFrame(flush);
  };
  const ro = new ResizeObserver((list) => {
    for (const e of list) {
      const box = e.borderBoxSize?.[0];
      const el = e.target;
      metrics.set(el, {
        w: Math.round(box ? box.inlineSize : el.offsetWidth),
        h: Math.round(box ? box.blockSize : el.offsetHeight),
        radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0,
      });
      queue(el);
    }
  });

  // Glass is measured only as it approaches the viewport: a ResizeObserver on
  // an element inside a content-visibility-skipped section would force that
  // whole section to lay out just to report a size
  const observed = new WeakSet();
  const near = new IntersectionObserver(
    (list) => {
      for (const e of list) {
        if (!e.isIntersecting) continue;
        near.unobserve(e.target);
        ro.observe(e.target); // its first notification measures and queues it
      }
    },
    { rootMargin: '60% 0px' },
  );
  function observe(el) {
    if (observed.has(el)) return;
    observed.add(el);
    near.observe(el);
  }

  function setIntensity(gi) {
    current = values(gi);
    applyCss(current);
    entries.forEach((entry, el) => {
      if (entry.filter) refractStyle(el, entry);
    });
  }

  setIntensity(store.gi);
  store.subscribe((st, patch) => {
    if ('gi' in patch) setIntensity(st.gi);
  });

  // Called once the page is loaded and the GPU probe has answered (main.js)
  function start(gpu) {
    refract = isChromium() && !!gpu && !gpu.coarse && CSS.supports('backdrop-filter', 'url(#x)');
    dispersion = refract && !!gpu?.strong;
    root.classList.add(refract ? 'lg-refract' : 'lg-fallback');
    document.querySelectorAll('.glass').forEach(observe);
  }

  return { start, observe };
}
