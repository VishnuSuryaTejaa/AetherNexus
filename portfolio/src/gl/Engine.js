// Nano-particle engine — raw WebGL2, no framework.
//
// Performance model
// · formations are computed in a Web Worker (zero-copy transfer back)
// · shaders compile in parallel (KHR_parallel_shader_compile) before the first
//   frame, so linking never blocks the main thread
// · one HDR target at a GPU-appropriate pixel ratio, bloom at quarter
//   resolution (2 cheap separable blurs), one grading pass
// · frame pacing: 60 fps while something moves, 30 fps at rest — the canvas is
//   also the backdrop every glass element re-blurs, so idle frames are halved
import { buildFormations, mulberry32 } from './formations.js';
import { TouchTexture } from './touch.js';
import particleVert from './shaders/particles.vert.glsl?raw';
import particleFrag from './shaders/particles.frag.glsl?raw';
import dustVert from './shaders/dust.vert.glsl?raw';
import dustFrag from './shaders/dust.frag.glsl?raw';
import screenVert from './shaders/screen.vert.glsl?raw';
import brightFrag from './shaders/bright.frag.glsl?raw';
import blurFrag from './shaders/blur.frag.glsl?raw';
import finalFrag from './shaders/final.frag.glsl?raw';

const CAM_Z = 10;
const FOV = (35 * Math.PI) / 180;
const TAN_HALF = Math.tan(FOV / 2);
const NAMES = ['x₀ · portrait', 'x₁ · the gap', 'x₂ · galaxy', 'x₃ · latent space', 'x₄ · signal'];
const GAINS = [1.08, 0.46, 0.28, 0.42, 0.52];
const SIZE_K = [0, 2.72, 0.76, 4.2, 1.34]; // per-formation size constant (see layout)

// Karras et al. (2022) noise schedule — the intro literally follows it
// Quality ladder for slow GPUs; each step returns whether it changed anything
const DEGRADE = [
  (e) => e.setDpr(Math.min(e.rdpr, 1.5)),
  (e) => {
    if (!e.bloom) return false;
    e.bloom = false;
    return true;
  },
  (e) => e.setDpr(Math.min(e.rdpr, 1.25)),
  (e) => {
    if (e.drawCount < e.count) return false;
    e.drawCount = Math.floor(e.count * 0.7);
    return true;
  },
  (e) => e.setDpr(1),
];
const SIGMA_MAX = 2.6;
const SIGMA_MIN = 0.002;
const RHO = 7;
const STEPS = 50;
const INTRO_DUR = 3.0;
const karras = (t) => {
  const a = Math.pow(SIGMA_MAX, 1 / RHO);
  const b = Math.pow(SIGMA_MIN, 1 / RHO);
  return Math.pow(a + t * (b - a), RHO);
};

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (current, target, lambda, dt) => current + (target - current) * (1 - Math.exp(-lambda * dt));
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const hexLinear = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => toLinear(c / 255));
};
// tone 0 → violet, .34 → electric blue, .68 → frost, 1 → cyan-ice
const PALETTE = new Float32Array(['#8f7bff', '#4f8dff', '#eaf3ff', '#7fd6ff'].flatMap(hexLinear));

/* ------------------------------------------------------------ mat3 (column-major) */
function rotX(o, t) {
  const c = Math.cos(t);
  const s = Math.sin(t);
  o.set([1, 0, 0, 0, c, s, 0, -s, c]);
  return o;
}
function rotY(o, t) {
  const c = Math.cos(t);
  const s = Math.sin(t);
  o.set([c, 0, -s, 0, 1, 0, s, 0, c]);
  return o;
}
function rotZ(o, t) {
  const c = Math.cos(t);
  const s = Math.sin(t);
  o.set([c, s, 0, -s, c, 0, 0, 0, 1]);
  return o;
}
function mul(o, a, b) {
  for (let col = 0; col < 3; col++) {
    const b0 = b[col * 3];
    const b1 = b[col * 3 + 1];
    const b2 = b[col * 3 + 2];
    for (let row = 0; row < 3; row++) o[col * 3 + row] = a[row] * b0 + a[3 + row] * b1 + a[6 + row] * b2;
  }
  return o;
}

/* ------------------------------------------------------------ GL helpers */
function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return s;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  return { p, v, f, u: new Map() };
}

// Wait for the driver to finish linking without blocking the main thread
async function linked(gl, progs) {
  const ext = gl.getExtension('KHR_parallel_shader_compile');
  if (ext) {
    const t0 = performance.now();
    while (!progs.every((x) => gl.getProgramParameter(x.p, ext.COMPLETION_STATUS_KHR)) && performance.now() - t0 < 8000) {
      await new Promise((r) => setTimeout(r, 16));
    }
  }
  for (const x of progs) {
    if (!gl.getProgramParameter(x.p, gl.LINK_STATUS)) {
      throw new Error(`shader: ${gl.getProgramInfoLog(x.p)} ${gl.getShaderInfoLog(x.v)} ${gl.getShaderInfoLog(x.f)}`);
    }
  }
}

function target(gl, w, h, float) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, float ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA, float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) {
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(tex);
    if (float) return target(gl, w, h, false);
    throw new Error('framebuffer incomplete');
  }
  return { tex, fb, w, h };
}

function release(gl, t) {
  if (!t) return;
  gl.deleteFramebuffer(t.fb);
  gl.deleteTexture(t.tex);
}

/* ------------------------------------------------------------ formations */
const nextTask = () => new Promise((r) => setTimeout(r, 0));

// Main-thread fallback: decode + resample here, maths in the worker if possible
async function pixelsHere(url, grid) {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = c.height = grid;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, grid, grid);
  return ctx.getImageData(0, 0, grid, grid).data;
}

function runWorker(msg, transfer = []) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./formations.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      worker.terminate();
      if (e.data?.error) reject(new Error(e.data.error));
      else resolve(e.data);
    };
    worker.onerror = (err) => {
      worker.terminate();
      reject(err);
    };
    worker.postMessage(msg, transfer);
  });
}

async function formations(url, grid) {
  const absolute = new URL(url, location.href).href;
  // 1. everything in the worker (fetch, decode, resample, maths)
  if (typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap === 'function') {
    try {
      return await runWorker({ url: absolute, grid, seed: 0x5eed });
    } catch {
      /* fall through */
    }
  }
  // 2. decode here, maths in the worker; 3. everything here
  const pixels = await pixelsHere(absolute, grid);
  try {
    const copy = pixels.slice();
    return await runWorker({ pixels: copy.buffer, grid, seed: 0x5eed }, [copy.buffer]);
  } catch {
    return buildFormations(pixels, grid);
  }
}

const LABELS = [
  { f: 1, text: 'Research', sub: 'σ high', tone: 'violet', local: [-0.95, 0, 0], r: 0.78 },
  { f: 1, text: 'Production', sub: 'σ → 0', tone: 'ice', local: [0.95, 0, 0], r: 0.62 },
  { f: 3, text: 'Latent space', sub: '', tone: 'frost', local: [0, 0, 0], r: 1.25 },
];

export class Engine {
  constructor(canvas, { tier, motion, anchors, sections, labelsRoot, onIntro, onStatus }) {
    this.canvas = canvas;
    this.tier = tier;
    this.motion = motion;
    this.anchors = anchors;
    this.sectionEls = sections;
    this.labelsRoot = labelsRoot;
    this.onIntro = onIntro;
    this.onStatus = onStatus;

    this.time = 0;
    this.morph = 0;
    this.snapIndex = 0;
    this.pendingSnap = null;
    this.fade = 0;
    this.fadeTarget = 1;
    this.introT = motion ? 0 : 1;
    this.introStart = null;
    this.introPending = false;
    this.sigma = motion ? SIGMA_MAX : 0;
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0, wx: 9999, wy: 9999, fine: false };
    this.sections = [];
    this.w = 0;
    this.h = 0;
    this.dpr = tier.dpr;
    this.bloom = tier.bloom;
    this.lastInput = -10;
    this.frameAcc = 0;
    this.probe = { n: 0, acc: 0, stage: 0, fps: 0, healthy: 0, done: false };
    this.statusTimer = 0;
    this.lastStatus = '';

    // per-formation transforms
    this.off = new Float32Array(15);
    this.scl = new Float32Array([1, 1, 1, 1, 1]);
    this.sizes = new Float32Array([2, 2, 2, 2, 2]);
    this.gains = new Float32Array(GAINS);
    this.rot = new Float32Array(45);
    for (let i = 0; i < 5; i++) this.rot.set([1, 0, 0, 0, 1, 0, 0, 0, 1], i * 9);
    this._a = new Float32Array(9);
    this._b = new Float32Array(9);
    this._c = new Float32Array(9);
    this._d = new Float32Array(9);
    this._B = new Float32Array(9);
    this._T = new Float32Array(9);
    this.proj = new Float32Array(16);
    this.view = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -CAM_Z, 1]);
  }

  async init(sampleUrl) {
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      // The system's default GPU — the one the probe measured. Asking for
      // 'high-performance' makes dual-GPU Macs switch to the discrete chip,
      // which blocks this call for ~0.2 s (and costs battery) for no visible gain
      failIfMajorPerformanceCaveat: true,
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.float = !!gl.getExtension('EXT_color_buffer_float');

    // Compile everything in parallel with the worker maths
    const P = {
      particles: program(gl, particleVert, particleFrag),
      dust: program(gl, dustVert, dustFrag),
      final: program(gl, screenVert, finalFrag),
      bright: program(gl, screenVert, brightFrag),
      blur: program(gl, screenVert, blurFrag),
    };
    this.P = P;
    await nextTask();
    const [data] = await Promise.all([formations(sampleUrl, this.tier.grid), linked(gl, Object.values(P))]);
    if (gl.isContextLost()) throw new Error('context lost');
    await nextTask();

    // ---- particle buffers
    this.count = data.count;
    this.drawCount = data.count;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const attr = (loc, arr, size) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    data.positions.forEach((p, i) => attr(i, p, 3));
    attr(5, data.color, 4);
    attr(6, data.tone, 4);
    attr(7, data.rand, 4);
    attr(8, data.eps, 3);

    // ---- ambient dust
    const dn = this.tier.dust;
    const dpos = new Float32Array(dn * 3);
    const dseed = new Float32Array(dn * 4);
    const r = mulberry32(7);
    for (let i = 0; i < dn; i++) {
      dpos[i * 3] = (r() * 2 - 1) * 1.15;
      dpos[i * 3 + 1] = (r() * 2 - 1) * 1.15;
      dpos[i * 3 + 2] = -8 + r() * 12;
      for (let k = 0; k < 4; k++) dseed[i * 4 + k] = r();
    }
    this.dustCount = dn;
    this.dustVao = gl.createVertexArray();
    gl.bindVertexArray(this.dustVao);
    attr(0, dpos, 3);
    attr(1, dseed, 4);
    this.screenVao = gl.createVertexArray();
    gl.bindVertexArray(null);
    await nextTask();

    // ---- touch texture (noise brush)
    this.touch = new TouchTexture();
    this.touchTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.touchTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.uploadTouch();

    this.buildLabels();
    this.bindPointer();
    this.resize();
    this.refresh();
    return this;
  }

  // ------------------------------------------------------------------ public
  startIntro() {
    if (!this.motion) {
      this.introT = 1;
      this.sigma = 0;
      this.onIntro?.(STEPS, 0, true);
      return;
    }
    this.introPending = true;
    this.introT = 0;
  }

  setMotion(on) {
    this.motion = on;
    if (!on) {
      this.introT = 1;
      this.sigma = 0;
      this.snapIndex = Math.round(this.morph);
      this.onIntro?.(STEPS, 0, true);
    }
  }

  refresh() {
    const y = window.scrollY;
    this.sections = this.sectionEls.map((el) => ({ f: Number(el.dataset.formation), top: el.getBoundingClientRect().top + y }));
    // portrait + ring anchors scroll with the page: their document rects are
    // cached on first use (lazily — reading the ring now would force the
    // skipped contact section to lay out)
    this.docRects = new Map();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (w === this.w && h === this.h && this.rtScene) return;
    this.w = w;
    this.h = h;
    const gl = this.gl;
    // effective pixel ratio: the requested one, within the tier's pixel budget
    this.rdpr = Math.max(0.75, Math.min(this.dpr, Math.sqrt((this.tier.mp * 1e6) / (w * h))));
    const W = Math.max(1, Math.round(w * this.rdpr));
    const H = Math.max(1, Math.round(h * this.rdpr));
    this.canvas.width = W;
    this.canvas.height = H;
    release(gl, this.rtScene);
    release(gl, this.rtA);
    release(gl, this.rtB);
    this.rtScene = target(gl, W, H, this.float);
    const qw = Math.max(1, Math.round(W / 4));
    const qh = Math.max(1, Math.round(H / 4));
    this.rtA = target(gl, qw, qh, this.float);
    this.rtB = target(gl, qw, qh, this.float);

    const aspect = w / h;
    const f = 1 / TAN_HALF;
    const near = 0.1;
    const far = 100;
    this.proj.set([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
    this.aspect = aspect;
    this.halfH = CAM_Z * TAN_HALF;
    this.halfW = this.halfH * aspect;
    this.k = (2 * this.halfH) / h; // world units per CSS px at z = 0
    this.touch.resize(aspect);
    this.mobile = w < 760;
    for (let i = 0; i < 5; i++) this.gains[i] = GAINS[i] * (this.mobile ? (i === 0 ? 0.72 : 0.9) : 1);
    this.forceFrame = true;
  }

  update(time, dt, scrollY, velocity) {
    if (!this.gl || this.gl.isContextLost()) return;
    dt = Math.min(dt, 0.1);
    this.time = time;
    this.scrollY = scrollY;
    if (Math.abs(velocity || 0) > 0.05) this.lastInput = time;

    // ---- frame pacing: 60 fps while something moves, 30 fps at rest
    const target = this.targetMorph(scrollY);
    const moving =
      this.introT < 1 || this.forceFrame || Math.abs(this.morph - target) > 0.003 || time - this.lastInput < 2.5 || this.fade < 0.99 || this.pendingSnap !== null;
    const fps = moving ? this.tier.fpsActive : this.tier.fpsIdle;
    this.frameAcc += dt;
    if (fps < 60 && this.frameAcc < 1 / fps - 0.004) return;
    dt = Math.min(this.frameAcc, 0.1);
    this.frameAcc = 0;
    this.forceFrame = false;

    // ---- intro: reverse diffusion along the Karras schedule
    if (this.introPending) {
      this.introPending = false;
      this.introStart = time;
    }
    if (this.introStart !== null && this.introT < 1) {
      this.introT = clamp((time - this.introStart) / INTRO_DUR, 0, 1);
      this.sigma = this.introT >= 1 ? 0 : karras(this.introT);
      this.onIntro?.(Math.round(this.introT * STEPS), this.sigma, this.introT >= 1);
    }

    // ---- scroll → formation
    if (this.motion) {
      this.morph = damp(this.morph, target, 4.5, dt);
    } else {
      const idx = Math.round(target);
      if (idx !== this.snapIndex && this.pendingSnap === null) {
        this.pendingSnap = idx;
        this.fadeTarget = 0;
      }
      if (this.pendingSnap !== null && this.fade < 0.03) {
        this.snapIndex = this.pendingSnap;
        this.pendingSnap = null;
        this.fadeTarget = 1;
      }
      this.morph = this.snapIndex;
    }
    this.fade = damp(this.fade, this.fadeTarget, this.motion ? 2.2 : 10, dt);

    // ---- pointer parallax (auto-sway on touch screens)
    const p = this.pointer;
    if (!p.fine) {
      p.tx = Math.sin(time * 0.25) * 0.35;
      p.ty = Math.cos(time * 0.2) * 0.2;
    }
    const pm = this.motion ? 1 : 0;
    p.x = damp(p.x, p.tx * pm, 3, dt);
    p.y = damp(p.y, p.ty * pm, 3, dt);

    this.layout(time);
    this.updateLabels();
    this.reportStatus(dt);
    if (this.touch.update(dt)) this.uploadTouch();
    const shimmer = this.motion ? Math.min(0.16, Math.abs(velocity || 0) * 0.0025) : 0;
    this.render(time, scrollY, this.sigma + shimmer);
    this.probeFps(dt, fps);
  }

  // ------------------------------------------------------------------ render
  uni(prog, name) {
    let l = prog.u.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(prog.p, name);
      prog.u.set(name, l);
    }
    return l;
  }

  uploadTouch() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.touchTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.touch.canvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  render(time, scrollY, sigma) {
    const gl = this.gl;
    const { particles: Pp, dust: Pd, final: Pf, bright: Pb, blur: Pz } = this.P;
    const S = this.rtScene;

    gl.bindFramebuffer(gl.FRAMEBUFFER, S.fb);
    gl.viewport(0, 0, S.w, S.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    // particles
    gl.useProgram(Pp.p);
    gl.uniformMatrix4fv(this.uni(Pp, 'uProj'), false, this.proj);
    gl.uniformMatrix4fv(this.uni(Pp, 'uView'), false, this.view);
    gl.uniform1f(this.uni(Pp, 'uTime'), time);
    gl.uniform1f(this.uni(Pp, 'uMorph'), this.morph);
    gl.uniform1f(this.uni(Pp, 'uSigma'), sigma);
    gl.uniform1f(this.uni(Pp, 'uPixelRatio'), this.rdpr);
    gl.uniform1f(this.uni(Pp, 'uCamZ'), CAM_Z);
    gl.uniform1fv(this.uni(Pp, 'uSizes'), this.sizes);
    gl.uniform1fv(this.uni(Pp, 'uGains'), this.gains);
    gl.uniform3fv(this.uni(Pp, 'uOff'), this.off);
    gl.uniform1fv(this.uni(Pp, 'uScl'), this.scl);
    gl.uniformMatrix3fv(this.uni(Pp, 'uRot'), false, this.rot);
    gl.uniform2f(this.uni(Pp, 'uPointer'), this.pointer.wx, this.pointer.wy);
    gl.uniform1f(this.uni(Pp, 'uTouchAmt'), this.motion ? 1 : 0);
    gl.uniform1f(this.uni(Pp, 'uMotion'), this.motion ? 1 : 0);
    gl.uniform1f(this.uni(Pp, 'uFade'), this.fade);
    gl.uniform3fv(this.uni(Pp, 'uPal'), PALETTE);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.touchTex);
    gl.uniform1i(this.uni(Pp, 'uTouch'), 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.POINTS, 0, this.drawCount);

    // ambient dust
    gl.useProgram(Pd.p);
    gl.uniformMatrix4fv(this.uni(Pd, 'uProj'), false, this.proj);
    gl.uniformMatrix4fv(this.uni(Pd, 'uView'), false, this.view);
    gl.uniform1f(this.uni(Pd, 'uTime'), time);
    gl.uniform1f(this.uni(Pd, 'uScroll'), scrollY / Math.max(1, window.innerHeight));
    gl.uniform1f(this.uni(Pd, 'uPixelRatio'), this.rdpr);
    gl.uniform1f(this.uni(Pd, 'uCamZ'), CAM_Z);
    gl.uniform1f(this.uni(Pd, 'uTanHalf'), TAN_HALF);
    gl.uniform1f(this.uni(Pd, 'uAspect'), this.aspect);
    gl.uniform1f(this.uni(Pd, 'uMotion'), this.motion ? 1 : 0);
    gl.uniform1f(this.uni(Pd, 'uFade'), this.fade);
    gl.uniform3fv(this.uni(Pd, 'uIce'), PALETTE.subarray(9, 12));
    gl.uniform3fv(this.uni(Pd, 'uAccent'), PALETTE.subarray(0, 3));
    gl.bindVertexArray(this.dustVao);
    gl.drawArrays(gl.POINTS, 0, this.dustCount);
    gl.disable(gl.BLEND);

    gl.bindVertexArray(this.screenVao);
    gl.activeTexture(gl.TEXTURE0);

    // bloom at quarter resolution
    if (this.bloom) {
      const A = this.rtA;
      const B = this.rtB;
      gl.bindFramebuffer(gl.FRAMEBUFFER, A.fb);
      gl.viewport(0, 0, A.w, A.h);
      gl.useProgram(Pb.p);
      gl.bindTexture(gl.TEXTURE_2D, S.tex);
      gl.uniform1i(this.uni(Pb, 'tSrc'), 0);
      gl.uniform2f(this.uni(Pb, 'uTexel'), 1 / S.w, 1 / S.h);
      gl.uniform1f(this.uni(Pb, 'uThreshold'), 0.12);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.useProgram(Pz.p);
      gl.uniform1i(this.uni(Pz, 'tSrc'), 0);
      for (const spread of [1, 2]) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, B.fb);
        gl.bindTexture(gl.TEXTURE_2D, A.tex);
        gl.uniform2f(this.uni(Pz, 'uDir'), spread / A.w, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindFramebuffer(gl.FRAMEBUFFER, A.fb);
        gl.bindTexture(gl.TEXTURE_2D, B.tex);
        gl.uniform2f(this.uni(Pz, 'uDir'), 0, spread / A.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }

    // grade to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(Pf.p);
    gl.bindTexture(gl.TEXTURE_2D, S.tex);
    gl.uniform1i(this.uni(Pf, 'tScene'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.rtA.tex);
    gl.uniform1i(this.uni(Pf, 'tBloom'), 1);
    gl.uniform1f(this.uni(Pf, 'uBloom'), this.bloom ? (this.mobile ? 0.55 : 0.85) : 0);
    gl.uniform2f(this.uni(Pf, 'uRes'), this.canvas.width, this.canvas.height);
    gl.uniform1f(this.uni(Pf, 'uTime'), time);
    gl.uniform1f(this.uni(Pf, 'uGrain'), 0.03);
    gl.uniform1f(this.uni(Pf, 'uExposure'), 0.92);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
  }

  // ------------------------------------------------------------------ layout
  targetMorph(scrollY) {
    const vh = window.innerHeight;
    const s = this.sections;
    if (!s.length) return 0;
    let m = s[0].f;
    for (let i = 1; i < s.length; i++) {
      if (s[i].f === s[i - 1].f) continue;
      const top = s[i].top - scrollY;
      const t = clamp((vh * 0.92 - top) / (vh * 0.62), 0, 1);
      if (t <= 0) break;
      m = s[i - 1].f + (s[i].f - s[i - 1].f) * t;
    }
    return m;
  }

  rectOf(el) {
    const cacheable = el === this.anchors.portrait || el === this.anchors.ring;
    let r;
    const cached = cacheable && this.docRects?.get(el);
    if (cached) {
      r = { left: cached.left, top: cached.top - this.scrollY, width: cached.width, height: cached.height };
    } else {
      r = el.getBoundingClientRect();
      if (cacheable && this.docRects) this.docRects.set(el, { left: r.left, top: r.top + window.scrollY, width: r.width, height: r.height });
    }
    const k = this.k;
    return {
      cx: (r.left + r.width / 2 - this.w / 2) * k,
      cy: -(r.top + r.height / 2 - this.h / 2) * k,
      w: r.width * k,
      h: r.height * k,
    };
  }

  // world = pointer-parallax · base
  setRot(i, base) {
    const p = this.pointer;
    const s = i === 0 ? 1 : 0.55;
    rotY(this._a, p.x * 0.24 * s);
    rotX(this._b, -p.y * 0.14 * s);
    mul(this._c, this._a, this._b);
    this.rot.set(mul(this._d, this._c, base), i * 9);
  }

  layout(time) {
    const m = clamp(this.morph, 0, 4);
    const a = Math.min(Math.floor(m), 3);
    const t = m - a;
    // Only measure formations that actually contribute: reading an anchor in a
    // section skipped by content-visibility would force it to lay out
    const needed = new Set();
    if (t < 0.998) needed.add(a);
    if (t > 0.002) needed.add(a + 1);
    for (const l of LABELS) if (Math.abs(m - l.f) < 0.6) needed.add(l.f);
    // Coverage-normalised size: brightness per pixel stays constant whatever
    // the particle count or on-screen scale (size ∝ K · scale_px / √N)
    const sq = Math.sqrt(Math.max(1, this.drawCount));
    const thin = Math.sqrt(this.count / Math.max(1, this.drawCount)); // fewer dots → larger dots
    const sizeFor = (i) => clamp((SIZE_K[i] * (this.scl[i] / this.k)) / sq, 1.6, 6);
    const spin = this.motion ? 1 : 0;
    const B = this._B;
    const T = this._T;

    for (const i of needed) {
      if (i === 0) {
        const r = this.rectOf(this.anchors.portrait);
        this.off.set([r.cx, r.cy, 0], 0);
        this.scl[0] = r.h / 2;
        this.sizes[0] = (r.h / this.k / this.tier.grid) * 1.9 * thin;
        B.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
      } else if (i === 1) {
        const r = this.rectOf(this.anchors.gap);
        const vertical = r.h > r.w * 1.1;
        this.off.set([r.cx, r.cy, 0], 3);
        this.scl[1] = vertical ? Math.min(r.w / 1.7, r.h / 3.3) : Math.min(r.w / 3.2, r.h / 1.7);
        this.sizes[1] = sizeFor(1);
        mul(B, rotY(T, Math.sin(time * 0.25) * 0.35 * spin), rotZ(this._a, vertical ? -Math.PI / 2 : 0));
        this.gapVertical = vertical;
      } else if (i === 2) {
        this.off.set([0, -this.halfH * 0.06, 0], 6);
        this.scl[2] = Math.max(this.halfW, this.halfH) * 0.98;
        this.sizes[2] = sizeFor(2);
        mul(B, rotX(T, 1.08), rotY(this._a, time * 0.035 * spin));
      } else if (i === 3) {
        const r = this.rectOf(this.anchors.sphere);
        this.off.set([r.cx, r.cy, 0], 9);
        this.scl[3] = Math.min(r.w, r.h) / 2 / 1.75;
        this.sizes[3] = sizeFor(3);
        mul(B, rotX(T, 0.3), rotY(this._a, time * 0.07 * spin));
      } else {
        const r = this.rectOf(this.anchors.ring);
        this.off.set([r.cx, r.cy, 0], 12);
        // A tilted orbit that hugs the headline: tilt is solved so the
        // ellipse's vertical semi-axis = half the title height + a margin
        const R = Math.max(r.w * 0.5, r.h * 0.8);
        const tilt = Math.asin(clamp((r.h / 2 + 30 * this.k) / R, 0.2, 0.92));
        this.scl[4] = R;
        this.sizes[4] = sizeFor(4);
        mul(T, rotX(this._a, tilt), rotY(this._b, time * 0.12 * spin));
        mul(B, rotZ(this._a, -0.1), T);
      }
      this.setRot(i, B);
    }
  }

  buildLabels() {
    this.labels = LABELS.map((def) => {
      const el = document.createElement('div');
      el.className = `flabel flabel--${def.tone}`;
      el.innerHTML = def.sub ? `${def.text} <small>${def.sub}</small>` : def.text;
      this.labelsRoot?.appendChild(el);
      return { def, el, o: -1, w: 0 };
    });
  }

  updateLabels() {
    if (!this.labelsRoot) return;
    const m = this.morph;
    const f = 1 / TAN_HALF;
    for (const l of this.labels) {
      const { def } = l;
      const o = Math.round(clamp(1 - Math.abs(m - def.f) * 2.4, 0, 1) * this.fade * 100) / 100;
      if (o !== l.o) {
        l.el.style.opacity = String(o);
        if (l.o <= 0 && o > 0) l.w = l.el.offsetWidth || 120;
        l.o = o;
      }
      if (o <= 0) continue;
      const i = def.f;
      const R = this.rot.subarray(i * 9, i * 9 + 9);
      const [lx, ly, lz] = def.local;
      const s = this.scl[i];
      const wx = (R[0] * lx + R[3] * ly + R[6] * lz) * s + this.off[i * 3];
      const wy = (R[1] * lx + R[4] * ly + R[7] * lz) * s + this.off[i * 3 + 1];
      const wz = (R[2] * lx + R[5] * ly + R[8] * lz) * s + this.off[i * 3 + 2];
      const wClip = CAM_Z - wz;
      let x = (((f / this.aspect) * wx) / wClip * 0.5 + 0.5) * this.w;
      let y = (-((f * wy) / wClip) * 0.5 + 0.5) * this.h;
      const rpx = (def.r * s) / this.k;
      const leftAligned = i === 1 && this.gapVertical;
      if (i === 1) {
        if (this.gapVertical) x += rpx + 14;
        else y -= rpx + 8;
      } else {
        y += rpx + 10;
      }
      const lw = l.w || 120;
      const minX = leftAligned ? 12 : 12 + lw / 2;
      const maxX = leftAligned ? this.w - lw - 12 : this.w - lw / 2 - 12;
      x = clamp(x, minX, Math.max(minX, maxX));
      l.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(${leftAligned ? '0' : '-50%'}, -50%)`;
    }
  }

  reportStatus(dt) {
    this.statusTimer += dt;
    if (this.statusTimer < 0.15) return;
    this.statusTimer = 0;
    const m = clamp(this.morph, 0, 4);
    const frac = m - Math.floor(m);
    const sig = this.sigma + Math.sin(frac * Math.PI) * 0.6 * (this.motion ? 1 : 0);
    const name = NAMES[Math.round(m)];
    const text = `${name}|${sig.toFixed(2)}`;
    if (text !== this.lastStatus) {
      this.lastStatus = text;
      this.onStatus?.(name, sig);
    }
  }

  bindPointer() {
    const onMove = (x, y, fine) => {
      const p = this.pointer;
      p.fine = p.fine || fine;
      p.tx = (x / this.w) * 2 - 1;
      p.ty = (y / this.h) * 2 - 1;
      p.wx = p.tx * this.halfW;
      p.wy = -p.ty * this.halfH;
      this.lastInput = this.time;
      if (this.motion) this.touch.add(x / this.w, y / this.h);
    };
    window.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType !== 'touch') onMove(e.clientX, e.clientY, true);
      },
      { passive: true },
    );
    document.documentElement.addEventListener('pointerleave', () => {
      this.touch.lift();
      this.pointer.wx = this.pointer.wy = 9999;
    });
    const onTouch = (e) => {
      const t = e.touches[0];
      if (t) onMove(t.clientX, t.clientY, false);
    };
    window.addEventListener('touchstart', onTouch, { passive: true });
    window.addEventListener('touchmove', onTouch, { passive: true });
    window.addEventListener('touchend', () => this.touch.lift(), { passive: true });
  }

  // If frames run long for the rate they were paced at, step quality down:
  // resolution first (the portrait keeps every particle), then bloom, and the
  // particle count only as a last resort (particles are pre-shuffled, so a
  // prefix is a uniform sample). Stops probing after sustained health.
  probeFps(dt, fps) {
    const pr = this.probe;
    if (pr.done || this.introT < 1 || document.hidden) return;
    if (fps !== pr.fps) {
      pr.fps = fps;
      pr.n = 0;
      pr.acc = 0;
    }
    pr.n++;
    pr.acc += dt;
    if (pr.n < 45) return;
    const interval = pr.acc / pr.n;
    pr.n = 0;
    pr.acc = 0;
    if (interval > 0.25) return; // throttled tab — not a GPU signal
    if (interval < (1 / fps) * 1.4) {
      pr.healthy = (pr.healthy || 0) + 1;
      if (pr.healthy >= 3) pr.done = true;
      return;
    }
    pr.healthy = 0;
    // apply the next step that actually changes something
    while (pr.stage < DEGRADE.length && !DEGRADE[pr.stage++](this));
    if (pr.stage >= DEGRADE.length) pr.done = true;
  }

  setDpr(v) {
    if (v >= this.rdpr - 0.01) return false;
    this.dpr = v;
    this.w = 0;
    this.resize();
    return true;
  }
}
