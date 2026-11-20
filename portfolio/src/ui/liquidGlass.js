// Liquid Glass for the web — two layers generated per element from one
// physical model: a squircle bezel (Apple's preferred surface profile).
//
// 1. Volumetric bezel shading — every browser.
//    The bezel's surface normals are lit from above (iOS 27's vertical light
//    angle): a bright specular rim where the edge faces the light, a softer
//    internal reflection on the opposite edge and a faint inner shadow that
//    gives the glass thickness. Rendered once per size into a PNG that sits in
//    the element's background stack (--lg-spec).
//
// 2. Refraction — Chromium (the only engine that accepts an SVG filter as a
//    backdrop-filter). The same normals bend the backdrop through Snell's law
//    (n = 1.5) via an feDisplacementMap; smaller controls also split R/G/B for
//    the faint dispersion fringe real glass shows at its rim.

const IOR = 1.5;
const SAMPLES = 128;
const MAP_SCALE = 0.5; // displacement is smooth — half resolution is plenty
const SPEC_MAX = 560; // longest side of a shading map, in px (the crisp rim is CSS)
const DISPERSION_MAX_AREA = 180000; // px² — larger panels skip the RGB split (GPU budget)

// Direction *towards* the light, in screen space (y points down): above, a touch left
const LX = -0.34;
const LY = -0.94;

export function isChromium() {
  const brands = navigator.userAgentData?.brands;
  return Array.isArray(brands) && brands.some((b) => /Chromium/i.test(b.brand));
}

// Surface height across the bezel (x: 0 = rim → 1 = flat top)
const squircle = (x) => Math.pow(1 - Math.pow(1 - x, 4), 0.25);

function refractionProfile(bezel, thickness) {
  const out = new Float32Array(SAMPLES);
  const e = 1e-3;
  for (let i = 0; i < SAMPLES; i++) {
    const x = i / (SAMPLES - 1);
    const x0 = Math.max(0, x - e);
    const x1 = Math.min(1, x + e);
    const slope = ((squircle(x1) - squircle(x0)) / (x1 - x0)) * (thickness / bezel);
    const thetaI = Math.atan(slope);
    const thetaT = Math.asin(Math.sin(thetaI) / IOR);
    const travel = thickness * (squircle(x) + 0.15);
    out[i] = Math.tan(thetaI - thetaT) * travel; // lateral shift (px), pointing inwards
  }
  return out;
}

function sampleProfile(profile, t) {
  const f = Math.min(1, Math.max(0, t)) * (SAMPLES - 1);
  const i = Math.floor(f);
  const j = Math.min(SAMPLES - 1, i + 1);
  return profile[i] + (profile[j] - profile[i]) * (f - i);
}

// Walk the bezel band of a rounded rectangle. Calls fn(index, t, nx, ny) for
// every pixel inside the bezel: t = 0 at the rim → 1 where the glass is flat,
// (nx, ny) = outward surface direction in the screen plane.
function walkBezel(W, H, scale, w, h, radius, bezel, fn) {
  const hw = w / 2;
  const hh = h / 2;
  const r = Math.min(radius, hw, hh);
  // Rows away from the top/bottom bands only touch the bezel near the left and
  // right edges, so visit just those two strips (~7× fewer pixels on big panels)
  const band = Math.max(r, bezel) + 1;
  const strip = Math.min(W, Math.ceil(bezel * scale) + 2);
  for (let py = 0; py < H; py++) {
    const y = (py + 0.5) / scale - hh;
    const qy = Math.abs(y) - (hh - r);
    const full = Math.abs(y) >= hh - band;
    for (let px = 0; px < W; px++) {
      if (!full && px === strip && W - strip > strip) px = W - strip;
      const x = (px + 0.5) / scale - hw;
      const qx = Math.abs(x) - (hw - r);
      let dist;
      let nx;
      let ny;
      if (qx > 0 && qy > 0) {
        const l = Math.hypot(qx, qy) || 1;
        dist = l - r;
        nx = (qx / l) * Math.sign(x);
        ny = (qy / l) * Math.sign(y);
      } else if (qx > qy) {
        dist = qx - r;
        nx = Math.sign(x);
        ny = 0;
      } else {
        dist = qy - r;
        nx = 0;
        ny = Math.sign(y);
      }
      const inner = -dist;
      if (inner >= 0 && inner < bezel) fn(py * W + px, inner / bezel, nx, ny);
    }
  }
}

function canvasFor(W, H) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  // CPU-backed canvas: putImageData + toDataURL on a GPU canvas forces a
  // readback stall (~25 ms each); in software it is a couple of milliseconds
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return { canvas, ctx, img: ctx.createImageData(W, H) };
}

/* ------------------------------------------------------------------ shading */
function shadingMap(w, h, radius, bezel, power) {
  const s = Math.min(1, SPEC_MAX / Math.max(w, h));
  const W = Math.max(2, Math.round(w * s));
  const H = Math.max(2, Math.round(h * s));
  const { canvas, ctx, img } = canvasFor(W, H);
  const d = img.data;
  walkBezel(W, H, s, w, h, radius, bezel, (i, t, nx, ny) => {
    const facing = nx * LX + ny * LY; // > 0: the edge faces the light
    const key = facing > 0 ? Math.pow(facing, 1.6) : 0;
    const back = facing < 0 ? Math.pow(-facing, 2.2) : 0;
    const rim = Math.exp(-t * 8.5); // hugs the outer edge
    const band = Math.exp(-((t - 0.36) ** 2) / 0.03); // a ring just inside the rim
    const hi = power * (rim * (0.66 * key + 0.32 * back) + band * 0.12 * key);
    const sh = power * band * 0.22 * back;
    const k = i * 4;
    if (hi >= sh) {
      d[k] = 255;
      d[k + 1] = 248;
      d[k + 2] = 238;
      d[k + 3] = Math.min(255, hi * 255);
    } else {
      d[k] = 4;
      d[k + 1] = 5;
      d[k + 2] = 8;
      d[k + 3] = Math.min(255, sh * 255);
    }
  });
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

/* ------------------------------------------------------------------ refraction */
function displacementMap(w, h, radius, bezel, strength) {
  const W = Math.max(2, Math.round(w * MAP_SCALE));
  const H = Math.max(2, Math.round(h * MAP_SCALE));
  const profile = refractionProfile(bezel, bezel);
  let maxD = 0;
  for (let i = 0; i < SAMPLES; i++) maxD = Math.max(maxD, profile[i]);
  maxD = Math.max(0.5, maxD * strength);

  const { canvas, ctx, img } = canvasFor(W, H);
  const d = img.data;
  d.fill(128); // neutral: no displacement
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
  walkBezel(W, H, MAP_SCALE, w, h, radius, bezel, (i, t, nx, ny) => {
    const mag = sampleProfile(profile, t) * strength;
    const k = i * 4;
    d[k] = 128 + ((-nx * mag) / maxD) * 127;
    d[k + 1] = 128 + ((-ny * mag) / maxD) * 127;
  });
  ctx.putImageData(img, 0, 0);
  return { url: canvas.toDataURL('image/png'), scale: maxD * 2 };
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

/* ------------------------------------------------------------------ runtime */
export function initLiquidGlass(store) {
  const root = document.documentElement;
  const dyn = document.createElement('style');
  dyn.id = 'glass-dynamic';
  document.head.appendChild(dyn);

  const refract = isChromium() && CSS.supports('backdrop-filter', 'url(#x)');
  root.classList.add(refract ? 'lg-refract' : 'lg-fallback');

  const defs = document.getElementById('lg-defs');
  const entries = new Map();
  let uid = 0;
  let current = null;

  const values = (gi) => ({
    blurClear: +(3 + gi * 14).toFixed(1),
    blurPanel: +(14 + gi * 26).toFixed(1),
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

  // Sizes and radii come from the ResizeObserver callback (layout is already
  // clean there), so building never forces a synchronous layout
  const metrics = new Map();

  function build(el) {
    const m = metrics.get(el);
    if (!m) return;
    const { w, h } = m;
    if (w < 12 || h < 12) return;
    const radius = Math.min(m.radius, w / 2, h / 2);
    let entry = entries.get(el);
    if (entry && entry.w === w && entry.h === h && entry.r === radius) return;
    if (!entry) {
      entry = { id: `lgf${uid++}` };
      entries.set(el, entry);
    }
    Object.assign(entry, { w, h, r: radius });

    const panel = el.classList.contains('glass--panel');
    const bezel = Math.max(8, Math.min(radius > 0 ? radius * 0.92 : 18, 36, Math.min(w, h) / 2 - 1));

    // 1 · volumetric shading (all browsers)
    el.style.setProperty('--lg-spec', `url("${shadingMap(w, h, radius, bezel, panel ? 0.78 : 1)}")`);

    // 2 · refraction (Chromium)
    if (refract && el.hasAttribute('data-lg')) {
      if (!entry.filter) {
        entry.filter = svg('filter', {
          id: entry.id,
          filterUnits: 'userSpaceOnUse',
          primitiveUnits: 'userSpaceOnUse',
          'color-interpolation-filters': 'sRGB',
        });
        defs.appendChild(entry.filter);
      }
      const strength = Number(el.dataset.lgStrength || 2.1);
      const { url, scale } = displacementMap(w, h, radius, bezel, strength);
      const std = panel ? current.blurPanel : current.blurClear * 0.32;
      entry.blur = writeFilter(entry.filter, { w, h, url, scale, std, dispersion: w * h <= DISPERSION_MAX_AREA });
      refractStyle(el, entry);
    }
  }

  // Build queue with a per-frame time budget, so generation never janks a frame
  const pending = new Set();
  let raf = 0;
  const flush = () => {
    raf = 0;
    const t0 = performance.now();
    for (const el of pending) {
      pending.delete(el);
      build(el);
      if (performance.now() - t0 > 8) break;
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

  // The observer's first notification measures the element and queues it
  const observed = new WeakSet();
  function observe(el) {
    if (observed.has(el)) return;
    observed.add(el);
    ro.observe(el);
  }

  function setIntensity(gi) {
    current = values(gi);
    applyCss(current);
    entries.forEach((entry, el) => {
      if (entry.filter) refractStyle(el, entry);
    });
  }

  setIntensity(store.gi);
  document.querySelectorAll('.glass').forEach(observe);
  store.subscribe((s, patch) => {
    if ('gi' in patch) setIntensity(s.gi);
  });

  return { refract, observe };
}
