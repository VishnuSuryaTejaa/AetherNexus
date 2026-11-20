// Particle formations. Every particle owns one position per formation; the GPU
// morphs between them like a diffusion step (x = mix(A, B, t) + σ·ε).
//   0 portrait   — 2.5D relief sampled from the cut-out photo
//   1 the gap    — research nebula ↔ production lattice + procedural bridge
//   2 galaxy     — dim spiral behind text-heavy sections
//   3 latent     — Fibonacci sphere + orbit rings
//   4 signal     — contact portal ring

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rand) {
  let spare = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    let u;
    let v;
    let s;
    do {
      u = rand() * 2 - 1;
      v = rand() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const m = Math.sqrt((-2 * Math.log(s)) / s);
    spare = v * m;
    return u * m;
  };
}

const smoothstep = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

// Moonlight gradient map (sRGB 0–255): navy shadows → electric blue → frost
// highlights, identical to the offline halftone; violet rim light
const STOPS = [
  [0.0, [6, 10, 24]],
  [0.18, [14, 28, 72]],
  [0.38, [36, 78, 200]],
  [0.58, [86, 146, 255]],
  [0.78, [178, 214, 255]],
  [1.0, [246, 250, 255]],
];
const RIM = [176, 150, 255];

function gradientMap(l) {
  l = Math.min(1, Math.max(0, l));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [p0, c0] = STOPS[i];
    const [p1, c1] = STOPS[i + 1];
    if (l <= p1) {
      let t = (l - p0) / (p1 - p0);
      t = t * t * (3 - 2 * t);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
  }
  return STOPS[STOPS.length - 1][1].slice();
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * norm;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc * norm;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

function shuffle(count, rand, arrays) {
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    for (const { data, size } of arrays) {
      for (let k = 0; k < size; k++) {
        const a = i * size + k;
        const b = j * size + k;
        const t = data[a];
        data[a] = data[b];
        data[b] = t;
      }
    }
  }
}

function rotate(p, rx, ry, rz) {
  let [x, y, z] = p;
  if (rx) {
    const c = Math.cos(rx);
    const s = Math.sin(rx);
    [y, z] = [y * c - z * s, y * s + z * c];
  }
  if (ry) {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    [x, z] = [x * c + z * s, -x * s + z * c];
  }
  if (rz) {
    const c = Math.cos(rz);
    const s = Math.sin(rz);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  return [x, y, z];
}

/* ------------------------------------------------------------ 0. portrait */
// `px` is the cut-out photo resampled to grid×grid RGBA (Uint8ClampedArray).
// Pure maths — no DOM — so it runs inside a Web Worker.
export function samplePortrait(px, grid, rand) {
  const n = grid * grid;
  const alpha = new Float32Array(n);
  for (let i = 0; i < n; i++) alpha[i] = px[i * 4 + 3] / 255;
  const alphaWide = boxBlur(alpha, grid, grid, Math.max(2, Math.round(grid / 70)));

  const pos = [];
  const col = [];
  for (let y = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const i = y * grid + x;
      const a = alpha[i];
      if (a < 0.3) continue;
      const r = px[i * 4] / 255;
      const g = px[i * 4 + 1] / 255;
      const b = px[i * 4 + 2] / 255;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      const u = (x + 0.5 + (rand() - 0.5) * 0.85) / grid;
      const v = (y + 0.5 + (rand() - 0.5) * 0.85) / grid;
      const focus = 0.58 + 0.42 * Math.exp(-((u - 0.52) ** 2 / 0.07 + (v - 0.4) ** 2 / 0.11));
      const l2 = Math.min(1, Math.pow(lum, 0.85) * focus * 1.18);
      const rim = Math.max(0, 1 - Math.abs(alphaWide[i] - 0.5) * 2.4);

      const gm = gradientMap(l2);
      let cr = gm[0] * 0.9 + r * 255 * 0.1;
      let cg = gm[1] * 0.9 + g * 255 * 0.1;
      let cb = gm[2] * 0.9 + b * 255 * 0.1;
      cr = cr * (1 - rim * 0.75) + RIM[0] * rim * 0.75;
      cg = cg * (1 - rim * 0.75) + RIM[1] * rim * 0.75;
      cb = cb * (1 - rim * 0.75) + RIM[2] * rim * 0.75;

      // 2.5D relief: head ellipsoid + shoulders + a touch of luminance
      const hx = (u - 0.52) / 0.3;
      const hy = (v - 0.4) / 0.42;
      const head = Math.sqrt(Math.max(0, 1 - hx * hx - hy * hy));
      const bx = (u - 0.5) / 0.62;
      const by = (v - 1.0) / 0.42;
      const body = Math.sqrt(Math.max(0, 1 - bx * bx - by * by));
      const z = 0.3 * head + 0.12 * body + 0.05 * (l2 - 0.4);

      // Contrast curve keeps facial detail; the tee/jacket below the face recedes
      const lower = 1 - 0.42 * smoothstep(0.66, 1.0, v);
      const bright = Math.min(1, 0.08 + 0.98 * Math.pow(l2, 1.22) * lower + rim * 0.62) * smoothstep(0.3, 0.7, a);

      pos.push((u - 0.5) * 2, (0.5 - v) * 2, z);
      col.push(toLinear(cr / 255), toLinear(cg / 255), toLinear(cb / 255), bright);
    }
  }

  const count = pos.length / 3;
  const P = Float32Array.from(pos);
  const C = Float32Array.from(col);
  // Shuffle so any prefix (draw range) is a uniform subsample
  shuffle(count, rand, [
    { data: P, size: 3 },
    { data: C, size: 4 },
  ]);
  return { count, pos: P, col: C };
}

/* ------------------------------------------------------------ 1. the gap */
function gap(N, rand, gauss) {
  const pos = new Float32Array(N * 3);
  const tone = new Float32Array(N);
  const kind = new Float32Array(N);
  const L = 6;
  const half = 0.34;
  const step = (2 * half) / (L - 1);
  for (let i = 0; i < N; i++) {
    const k = rand();
    let p;
    let t;
    if (k < 0.4) {
      // research: warm, chaotic, swirling nebula
      let x = gauss() * 0.3;
      let y = gauss() * 0.3;
      const z = gauss() * 0.3;
      const ang = Math.hypot(x, y, z) * 4.0;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      [x, y] = [x * c - y * s, x * s + y * c];
      p = [x - 0.95, y, z];
      t = 0.06 + rand() * 0.42;
    } else if (k < 0.72) {
      // production: cool, ordered lattice (edges of a 6³ grid)
      const axis = Math.floor(rand() * 3);
      const a = Math.floor(rand() * L);
      const b = Math.floor(rand() * L);
      const q = [0, 0, 0];
      q[axis] = -half + rand() * 2 * half;
      q[(axis + 1) % 3] = -half + a * step;
      q[(axis + 2) % 3] = -half + b * step;
      const r = rotate(q, 0.45, 0.6, 0);
      p = [r[0] + 0.95 + gauss() * 0.003, r[1] + gauss() * 0.003, r[2] + gauss() * 0.003];
      t = 0.9 + rand() * 0.1;
    } else {
      // bridge: (s0, phase, amplitude) — animated procedurally in the shader
      p = [rand(), rand() * Math.PI * 2, (rand() * 2 - 1) * 0.5];
      kind[i] = 1;
      t = 0.5;
    }
    pos[i * 3] = p[0];
    pos[i * 3 + 1] = p[1];
    pos[i * 3 + 2] = p[2];
    tone[i] = t;
  }
  return { pos, tone, kind };
}

/* ------------------------------------------------------------ 2. galaxy */
function galaxy(N, rand, gauss) {
  const pos = new Float32Array(N * 3);
  const tone = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let x;
    let y;
    let z;
    let t;
    if (rand() < 0.14) {
      x = gauss() * 0.13;
      y = gauss() * 0.07;
      z = gauss() * 0.13;
      t = 0.42 + rand() * 0.2;
    } else {
      const r = 0.08 + Math.pow(rand(), 0.7) * 0.95;
      const arm = Math.floor(rand() * 3);
      const th = r * 4.4 + (arm * Math.PI * 2) / 3 + gauss() * 0.22 * (1.15 - r * 0.5);
      x = Math.cos(th) * r + gauss() * 0.025;
      z = Math.sin(th) * r + gauss() * 0.025;
      y = gauss() * 0.03 * (1.1 - r);
      t = rand() < 0.72 ? 0.84 + rand() * 0.16 : 0.18 + rand() * 0.3;
    }
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;
    tone[i] = t;
  }
  return { pos, tone };
}

/* ------------------------------------------------------------ 3. latent sphere */
function latent(N, rand, gauss) {
  const pos = new Float32Array(N * 3);
  const tone = new Float32Array(N);
  const shellN = Math.floor(N * 0.6);
  const cloudN = Math.floor(N * 0.12);
  const GA = Math.PI * (3 - Math.sqrt(5));
  const rings = [
    { R: 1.3, rx: 1.15, rz: 0.0, t: 0.32 },
    { R: 1.48, rx: 1.35, rz: 0.55, t: 0.96 },
    { R: 1.68, rx: 1.05, rz: -0.7, t: 0.4 },
  ];
  for (let i = 0; i < N; i++) {
    let p;
    let t;
    if (i < shellN) {
      const y = 1 - (2 * (i + 0.5)) / shellN;
      const r = Math.sqrt(1 - y * y);
      const th = i * GA;
      const j = 1 + gauss() * 0.008;
      p = [Math.cos(th) * r * j, y * j, Math.sin(th) * r * j];
      t = 0.42 + 0.52 * (0.5 + 0.5 * y);
    } else if (i < shellN + cloudN) {
      p = [gauss() * 0.3, gauss() * 0.3, gauss() * 0.3];
      t = 0.22 + rand() * 0.22;
    } else {
      const ring = rings[i % 3];
      const th = rand() * Math.PI * 2;
      p = rotate([Math.cos(th) * ring.R, gauss() * 0.006, Math.sin(th) * ring.R], ring.rx, 0, ring.rz);
      t = ring.t + rand() * 0.04;
    }
    pos[i * 3] = p[0];
    pos[i * 3 + 1] = p[1];
    pos[i * 3 + 2] = p[2];
    tone[i] = t;
  }
  shuffle(N, rand, [
    { data: pos, size: 3 },
    { data: tone, size: 1 },
  ]);
  return { pos, tone };
}

/* ------------------------------------------------------------ 4. signal ring */
function signal(N, rand, gauss) {
  const pos = new Float32Array(N * 3);
  const tone = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const k = rand();
    const th = rand() * Math.PI * 2;
    let R;
    let y;
    let t;
    if (k < 0.66) {
      R = 1 + gauss() * 0.028;
      y = gauss() * 0.028;
      t = rand() < 0.75 ? 0.12 + rand() * 0.36 : 0.92 + rand() * 0.08;
    } else if (k < 0.82) {
      R = 0.62 + rand() * 0.36;
      y = gauss() * 0.015;
      t = 0.55 + rand() * 0.15;
    } else {
      R = 1.04 + Math.abs(gauss()) * 0.24;
      y = gauss() * 0.045;
      t = 0.85 + rand() * 0.15;
    }
    pos[i * 3] = Math.cos(th) * R;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = Math.sin(th) * R;
    tone[i] = t;
  }
  return { pos, tone };
}

/* ------------------------------------------------------------ assemble */
export function buildFormations(px, grid, seed = 0x5eed) {
  const rand = mulberry32(seed);
  const gauss = gaussian(rand);
  const portrait = samplePortrait(px, grid, rand);
  const N = portrait.count;

  const g = gap(N, rand, gauss);
  const gx = galaxy(N, rand, gauss);
  const lt = latent(N, rand, gauss);
  const sg = signal(N, rand, gauss);

  const tone = new Float32Array(N * 4);
  const randA = new Float32Array(N * 4);
  const eps = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    tone[i * 4] = g.tone[i];
    tone[i * 4 + 1] = gx.tone[i];
    tone[i * 4 + 2] = lt.tone[i];
    tone[i * 4 + 3] = sg.tone[i];
    randA[i * 4] = rand(); // stagger
    randA[i * 4 + 1] = rand(); // size / brightness jitter
    randA[i * 4 + 2] = rand(); // phase
    randA[i * 4 + 3] = g.kind[i]; // 1 = bridge particle in "the gap"
    eps[i * 3] = gauss();
    eps[i * 3 + 1] = gauss();
    eps[i * 3 + 2] = gauss() * 0.6;
  }

  return {
    count: N,
    positions: [portrait.pos, g.pos, gx.pos, lt.pos, sg.pos],
    color: portrait.col,
    tone,
    rand: randA,
    eps,
  };
}
