import {
  AddEquation,
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  Matrix3,
  Matrix4,
  OneFactor,
  PerspectiveCamera,
  Points,
  Scene,
  ShaderMaterial,
  Sphere,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { buildFormations, mulberry32 } from './formations.js';
import { TouchTexture } from './touch.js';
import particleVert from './shaders/particles.vert.glsl?raw';
import particleFrag from './shaders/particles.frag.glsl?raw';
import dustVert from './shaders/dust.vert.glsl?raw';
import dustFrag from './shaders/dust.frag.glsl?raw';
import finalFrag from './shaders/final.frag.glsl?raw';

const CAM_Z = 10;
const FOV = 35;
const TAN_HALF = Math.tan(((FOV / 2) * Math.PI) / 180);
const NAMES = ['x₀ · portrait', 'x₁ · the gap', 'x₂ · galaxy', 'x₃ · latent space', 'x₄ · signal'];
const GAINS = [1.08, 0.46, 0.28, 0.42, 0.52];
// Per-formation size constant (see sizeFor in layout)
const SIZE_K = [0, 2.72, 0.76, 4.2, 1.34];

// Karras et al. (2022) noise schedule — the intro literally follows it
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

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

const LABELS = [
  { f: 1, key: 'research', text: 'Research', sub: 'σ high', tone: 'amber', local: [-0.95, 0, 0], r: 0.78 },
  { f: 1, key: 'production', text: 'Production', sub: 'σ → 0', tone: 'ice', local: [0.95, 0, 0], r: 0.62 },
  { f: 3, key: 'latent', text: 'Latent space', sub: '', tone: 'cream', local: [0, 0, 0], r: 1.25 },
];

export class ParticleEngine {
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
    this.sigma = motion ? SIGMA_MAX : 0;
    this.pointer = { x: 0, y: 0, tx: 0, ty: 0, wx: 9999, wy: 9999, fine: false };
    this.sections = [];
    this.w = 0;
    this.h = 0;
    this.probe = { frames: 0, acc: 0, stage: 0, wait: 0 };
    this.lastStatus = '';
    this.statusTimer = 0;

    this._m4 = new Matrix4();
    this._p4 = new Matrix4();
    this._t4 = new Matrix4();
    this._v3 = new Vector3();
  }

  async init(imageUrl) {
    const img = await loadImage(imageUrl);
    const data = buildFormations(img, this.tier.grid);
    this.count = data.count;

    const renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
    });
    renderer.setClearColor(0x000000, 1);
    this.renderer = renderer;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.tier.dpr);
    renderer.setPixelRatio(this.dpr);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(FOV, 1, 0.1, 100);
    this.camera.position.set(0, 0, CAM_Z);

    this.touch = new TouchTexture();
    const palette = ['#ff6b2c', '#ffb35c', '#fff1dc', '#8fd0ff'].map((h) => new Color(h));

    // ---------------------------------------------------------------- particles
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(data.positions[0], 3));
    for (let i = 1; i < 5; i++) geo.setAttribute(`aP${i}`, new BufferAttribute(data.positions[i], 3));
    geo.setAttribute('aColor', new BufferAttribute(data.color, 4));
    geo.setAttribute('aTone', new BufferAttribute(data.tone, 4));
    geo.setAttribute('aRand', new BufferAttribute(data.rand, 4));
    geo.setAttribute('aEps', new BufferAttribute(data.eps, 3));
    geo.boundingSphere = new Sphere(new Vector3(), 1e4);
    this.geometry = geo;

    this.uniforms = {
      uTime: { value: 0 },
      uMorph: { value: 0 },
      uSigma: { value: this.sigma },
      uPixelRatio: { value: this.dpr },
      uCamZ: { value: CAM_Z },
      uSizes: { value: [2, 2, 2, 2, 2] },
      uGains: { value: GAINS.slice() },
      uOff: { value: Array.from({ length: 5 }, () => new Vector3()) },
      uScl: { value: [1, 1, 1, 1, 1] },
      uRot: { value: Array.from({ length: 5 }, () => new Matrix3()) },
      uTouch: { value: this.touch.texture },
      uPointer: { value: new Vector2(9999, 9999) },
      uTouchAmt: { value: this.motion ? 1 : 0 },
      uMotion: { value: this.motion ? 1 : 0 },
      uFade: { value: 0 },
      uPal: { value: palette },
    };

    const additive = {
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendEquation: AddEquation,
      blendSrc: OneFactor,
      blendDst: OneFactor,
    };

    this.points = new Points(
      geo,
      new ShaderMaterial({ vertexShader: particleVert, fragmentShader: particleFrag, uniforms: this.uniforms, ...additive }),
    );
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    // ---------------------------------------------------------------- ambient dust
    const dn = this.tier.dust;
    const dpos = new Float32Array(dn * 3);
    const dseed = new Float32Array(dn * 4);
    const r = mulberry32(7);
    for (let i = 0; i < dn; i++) {
      dpos[i * 3] = (r() * 2 - 1) * 1.15;
      dpos[i * 3 + 1] = (r() * 2 - 1) * 1.15;
      dpos[i * 3 + 2] = -8 + r() * 12;
      dseed[i * 4] = r();
      dseed[i * 4 + 1] = r();
      dseed[i * 4 + 2] = r();
      dseed[i * 4 + 3] = r();
    }
    const dgeo = new BufferGeometry();
    dgeo.setAttribute('position', new BufferAttribute(dpos, 3));
    dgeo.setAttribute('aSeed', new BufferAttribute(dseed, 4));
    dgeo.boundingSphere = new Sphere(new Vector3(), 1e4);
    this.dustUniforms = {
      uTime: { value: 0 },
      uScroll: { value: 0 },
      uPixelRatio: { value: this.dpr },
      uCamZ: { value: CAM_Z },
      uTanHalf: { value: TAN_HALF },
      uAspect: { value: 1 },
      uMotion: { value: this.motion ? 1 : 0 },
      uFade: { value: 0 },
      uIce: { value: palette[3] },
      uAmber: { value: palette[1] },
    };
    this.dust = new Points(
      dgeo,
      new ShaderMaterial({ vertexShader: dustVert, fragmentShader: dustFrag, uniforms: this.dustUniforms, ...additive }),
    );
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);

    // ---------------------------------------------------------------- post
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.tier.bloom) {
      this.bloom = new UnrealBloomPass(new Vector2(512, 512), 0.62, 0.5, 0.12);
      this.composer.addPass(this.bloom);
    }
    this.finalPass = new ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uRes: { value: new Vector2(1, 1) },
        uTime: { value: 0 },
        uGrain: { value: 0.03 },
        uExposure: { value: 0.92 },
      },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: finalFrag,
    });
    this.composer.addPass(this.finalPass);

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
    const v = on ? 1 : 0;
    this.uniforms.uMotion.value = v;
    this.uniforms.uTouchAmt.value = v;
    this.dustUniforms.uMotion.value = v;
    if (!on) {
      this.introT = 1;
      this.sigma = 0;
      this.snapIndex = Math.round(this.morph);
      this.onIntro?.(STEPS, 0, true);
    }
  }

  refresh() {
    const y = window.scrollY;
    this.sections = this.sectionEls.map((el) => ({
      f: Number(el.dataset.formation),
      top: el.getBoundingClientRect().top + y,
    }));
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(this.dpr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.halfH = CAM_Z * TAN_HALF;
    this.halfW = this.halfH * this.camera.aspect;
    this.k = (2 * this.halfH) / h; // world units per CSS px at z = 0
    this.finalPass.uniforms.uRes.value.set(w * this.dpr, h * this.dpr);
    this.dustUniforms.uAspect.value = this.camera.aspect;
    this.touch.resize(w / h);
    this.mobile = w < 760;
    // Small screens pack the same light into fewer pixels — calm it down
    GAINS.forEach((g, i) => {
      this.uniforms.uGains.value[i] = g * (this.mobile ? (i === 0 ? 0.72 : 0.9) : 1);
    });
    if (this.bloom) this.bloom.strength = this.mobile ? 0.42 : 0.62;
  }

  update(time, dt, scrollY, velocity) {
    if (!this.renderer) return;
    dt = Math.min(dt, 0.1);
    this.time = time;
    const U = this.uniforms;

    // ---- intro: reverse diffusion along the Karras schedule
    if (this.introPending) {
      this.introPending = false;
      this.introStart = time;
    }
    if (this.introStart !== null && this.introT < 1) {
      this.introT = clamp((time - this.introStart) / INTRO_DUR, 0, 1);
      this.sigma = karras(this.introT);
      if (this.introT >= 1) this.sigma = 0;
      this.onIntro?.(Math.round(this.introT * STEPS), this.sigma, this.introT >= 1);
    }

    // ---- scroll → formation
    const target = this.targetMorph(scrollY);
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

    const shimmer = this.motion ? Math.min(0.16, Math.abs(velocity || 0) * 0.0025) : 0;
    U.uSigma.value = this.sigma + shimmer;
    U.uMorph.value = this.morph;
    U.uTime.value = time;
    U.uFade.value = this.fade;
    U.uPointer.value.set(p.wx, p.wy);

    this.layout(time);

    this.dustUniforms.uTime.value = time;
    this.dustUniforms.uScroll.value = scrollY / Math.max(1, window.innerHeight);
    this.dustUniforms.uFade.value = this.fade;
    this.finalPass.uniforms.uTime.value = time;

    this.touch.update(dt);
    this.updateLabels();
    this.reportStatus(dt);
    this.composer.render(dt);
    this.probeFps(dt);
  }

  // ------------------------------------------------------------------ internals
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
    const r = el.getBoundingClientRect();
    const k = this.k;
    return {
      cx: (r.left + r.width / 2 - this.w / 2) * k,
      cy: -(r.top + r.height / 2 - this.h / 2) * k,
      w: r.width * k,
      h: r.height * k,
    };
  }

  setRot(i, base) {
    // world = pointer-parallax · base
    const p = this.pointer;
    const strength = i === 0 ? 1 : 0.55;
    this._p4.makeRotationY(p.x * 0.24 * strength);
    this._t4.makeRotationX(-p.y * 0.14 * strength);
    this._p4.multiply(this._t4).multiply(base);
    this.uniforms.uRot.value[i].setFromMatrix4(this._p4);
  }

  layout(time) {
    const U = this.uniforms;
    const m = clamp(this.morph, 0, 4);
    const a = Math.min(Math.floor(m), 3);
    const needed = new Set([a, a + 1]);
    for (const l of LABELS) if (Math.abs(m - l.f) < 0.6) needed.add(l.f);
    // Coverage-normalised size: brightness per pixel stays constant whatever
    // the particle count or on-screen scale (size ∝ K · scale_px / √N)
    const sq = Math.sqrt(Math.max(1, this.count));
    const sizeFor = (i) => clamp((SIZE_K[i] * (U.uScl.value[i] / this.k)) / sq, 1.6, 6);
    const M = this._m4;

    for (const i of needed) {
      if (i === 0) {
        const r = this.rectOf(this.anchors.portrait);
        U.uOff.value[0].set(r.cx, r.cy, 0);
        U.uScl.value[0] = r.h / 2;
        U.uSizes.value[0] = (r.h / this.k / this.tier.grid) * 2.05;
        M.identity();
        this.setRot(0, M);
      } else if (i === 1) {
        const r = this.rectOf(this.anchors.gap);
        const vertical = r.h > r.w * 1.1;
        U.uOff.value[1].set(r.cx, r.cy, 0);
        U.uScl.value[1] = vertical ? Math.min(r.w / 1.7, r.h / 3.3) : Math.min(r.w / 3.2, r.h / 1.7);
        U.uSizes.value[1] = sizeFor(1);
        this._t4.makeRotationY(Math.sin(time * 0.25) * 0.35 * (this.motion ? 1 : 0));
        M.makeRotationZ(vertical ? -Math.PI / 2 : 0).premultiply(this._t4);
        this.gapVertical = vertical;
        this.setRot(1, M);
      } else if (i === 2) {
        U.uOff.value[2].set(0, -this.halfH * 0.06, 0);
        U.uScl.value[2] = Math.max(this.halfW, this.halfH) * 0.98;
        U.uSizes.value[2] = sizeFor(2);
        M.makeRotationY(time * 0.035 * (this.motion ? 1 : 0)).premultiply(this._t4.makeRotationX(1.08));
        this.setRot(2, M);
      } else if (i === 3) {
        const r = this.rectOf(this.anchors.sphere);
        U.uOff.value[3].set(r.cx, r.cy, 0);
        U.uScl.value[3] = Math.min(r.w, r.h) / 2 / 1.75;
        U.uSizes.value[3] = sizeFor(3);
        M.makeRotationY(time * 0.07 * (this.motion ? 1 : 0)).premultiply(this._t4.makeRotationX(0.3));
        this.setRot(3, M);
      } else if (i === 4) {
        const r = this.rectOf(this.anchors.ring);
        U.uOff.value[4].set(r.cx, r.cy, 0);
        // A tilted orbit that hugs the headline: tilt is solved so the
        // ellipse's vertical semi-axis = half the title height + a margin
        const R = Math.max(r.w * 0.5, r.h * 0.8);
        const tilt = Math.asin(clamp((r.h / 2 + 30 * this.k) / R, 0.2, 0.92));
        U.uScl.value[4] = R;
        U.uSizes.value[4] = sizeFor(4);
        M.makeRotationY(time * 0.12 * (this.motion ? 1 : 0))
          .premultiply(this._t4.makeRotationX(tilt))
          .premultiply(this._p4.makeRotationZ(-0.1));
        this.setRot(4, M);
      }
    }
  }

  buildLabels() {
    this.labels = LABELS.map((def) => {
      const el = document.createElement('div');
      el.className = `flabel flabel--${def.tone}`;
      el.innerHTML = def.sub ? `${def.text} <small>${def.sub}</small>` : def.text;
      this.labelsRoot?.appendChild(el);
      return { def, el, o: -1 };
    });
  }

  updateLabels() {
    if (!this.labelsRoot) return;
    const m = this.morph;
    for (const l of this.labels) {
      const { def } = l;
      const w = clamp(1 - Math.abs(m - def.f) * 2.4, 0, 1) * this.fade;
      const o = Math.round(w * 100) / 100;
      if (o !== l.o) {
        l.el.style.opacity = String(o);
        l.o = o;
      }
      if (o <= 0) continue;
      const i = def.f;
      const U = this.uniforms;
      const v = this._v3.set(def.local[0], def.local[1], def.local[2]);
      v.applyMatrix3(U.uRot.value[i]).multiplyScalar(U.uScl.value[i]).add(U.uOff.value[i]);
      v.project(this.camera);
      let x = (v.x * 0.5 + 0.5) * this.w;
      let y = (-v.y * 0.5 + 0.5) * this.h;
      const rpx = (def.r * U.uScl.value[i]) / this.k;
      if (i === 1) {
        if (this.gapVertical) x += rpx + 14;
        else y -= rpx + 8;
      } else {
        y += rpx + 10;
      }
      // Keep every label fully inside the viewport
      const lw = l.el.offsetWidth || 120;
      const leftAligned = i === 1 && this.gapVertical;
      const minX = leftAligned ? 12 : 12 + lw / 2;
      const maxX = leftAligned ? this.w - lw - 12 : this.w - lw / 2 - 12;
      x = clamp(x, minX, Math.max(minX, maxX));
      l.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(${leftAligned ? '0' : '-50%'}, -50%)`;
    }
  }

  reportStatus(dt) {
    this.statusTimer += dt;
    if (this.statusTimer < 0.12) return;
    this.statusTimer = 0;
    const m = clamp(this.morph, 0, 4);
    const frac = m - Math.floor(m);
    const sig = this.uniforms.uSigma.value + Math.sin(frac * Math.PI) * 0.6 * (this.motion ? 1 : 0);
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
      if (this.motion) this.touch.add(x / this.w, y / this.h);
    };
    window.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType === 'touch') return;
        onMove(e.clientX, e.clientY, true);
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

  // Thin the draw range / DPR / bloom if frames are slow. Particles are
  // pre-shuffled, so a prefix of the buffer is still a uniform sample.
  probeFps(dt) {
    const pr = this.probe;
    if (pr.stage >= 2 || this.introT < 1 || document.hidden) return;
    pr.wait += dt;
    if (pr.wait < 1.2) return;
    pr.frames++;
    pr.acc += dt;
    if (pr.frames < 90) return;
    const fps = pr.frames / pr.acc;
    pr.frames = 0;
    pr.acc = 0;
    pr.wait = 0;
    if (fps >= 50) {
      pr.stage = 2;
      return;
    }
    pr.stage++;
    if (pr.stage === 1) {
      this.geometry.setDrawRange(0, Math.floor(this.count * 0.65));
      this.dpr = Math.max(1, this.dpr - 0.5);
    } else {
      if (this.bloom) this.bloom.enabled = false;
      this.geometry.setDrawRange(0, Math.floor(this.count * 0.45));
      this.dpr = 1;
    }
    this.renderer.setPixelRatio(this.dpr);
    this.uniforms.uPixelRatio.value = this.dpr;
    this.dustUniforms.uPixelRatio.value = this.dpr;
    this.w = 0;
    this.resize();
  }
}
