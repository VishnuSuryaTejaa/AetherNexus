// Liquid selection — the nav highlight is a drop of gel, not a sliding pill.
// A stiff head races to the new item while a soft tail drains after it; the
// drop stretches, necks into a thread between the two and lands with a jelly
// wobble. The outline is a 1-D thickness profile r(x): two round-capped pills
// plus a capillary thread, blended with smooth maxima so every join is a
// meniscus. It is drawn as plain SVG paths — vector-crisp, no filters, and no
// work at all once the drop has settled.

const SAMPLES = 72; // points per edge
let uid = 0;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Smooth maximum: joins two thickness profiles with a fillet of size k
function smax(a, b, k) {
  if (k < 0.01) return Math.max(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

// Half-thickness at x of a pill centred on c (half-width w, end radius r)
function pill(x, c, w, r) {
  const d = Math.abs(x - c) - (w - r);
  if (d <= 0) return r;
  return d < r ? Math.sqrt(r * r - d * d) : 0;
}

class Spring {
  constructor(k, zeta, eps) {
    this.k = k;
    this.c = 2 * Math.sqrt(k) * zeta;
    this.eps = eps;
    this.x = 0;
    this.v = 0;
    this.t = 0;
  }

  snap(v = this.t) {
    this.x = this.t = v;
    this.v = 0;
  }

  step(dt) {
    this.v += (this.k * (this.t - this.x) - this.c * this.v) * dt;
    this.x += this.v * dt;
  }

  get settled() {
    return Math.abs(this.t - this.x) < this.eps && Math.abs(this.v) < this.eps * 8;
  }
}

const f = (n) => n.toFixed(2);

export class Liquid {
  constructor(root, store) {
    this.root = root;
    this.store = store;
    this.links = [...root.querySelectorAll('a[data-section]')];
    const id = `lq${uid++}`;
    root.insertAdjacentHTML(
      'afterbegin',
      `<svg class="liquid" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fff" stop-opacity=".22"/>
            <stop offset=".55" stop-color="#fff" stop-opacity=".07"/>
            <stop offset="1" stop-color="#d6e6ff" stop-opacity=".13"/>
          </linearGradient>
          <linearGradient id="${id}r" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fff" stop-opacity=".95"/>
            <stop offset=".32" stop-color="#fff" stop-opacity=".16"/>
            <stop offset=".7" stop-color="#fff" stop-opacity=".05"/>
            <stop offset="1" stop-color="#fff" stop-opacity=".42"/>
          </linearGradient>
          <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#fff" stop-opacity=".46"/>
            <stop offset=".6" stop-color="#fff" stop-opacity=".08"/>
            <stop offset="1" stop-color="#fff" stop-opacity="0"/>
          </linearGradient>
          <linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#020614" stop-opacity="0"/>
            <stop offset="1" stop-color="#020614" stop-opacity=".3"/>
          </linearGradient>
        </defs>
        <path class="liquid__edge"/>
        <path class="liquid__body" fill="url(#${id}f)" stroke="url(#${id}r)"/>
        <path class="liquid__shade" fill="url(#${id}s)"/>
        <path class="liquid__gloss" fill="url(#${id}g)"/>
      </svg>`,
    );
    this.svg = root.firstElementChild;
    [this.pEdge, this.pBody, this.pShade, this.pGloss] = this.svg.querySelectorAll('path');

    // head: stiff, a touch of overshoot · tail: soft, drains after it
    this.head = { c: new Spring(430, 0.66, 0.12), w: new Spring(430, 0.74, 0.12) };
    this.tail = { c: new Spring(100, 0.94, 0.12), w: new Spring(120, 0.9, 0.12) };
    this.grow = new Spring(250, 0.58, 0.003); // drip in / dry up
    this.wob = new Spring(330, 0.2, 0.002); // vertical jelly
    this.springs = [this.head.c, this.head.w, this.tail.c, this.tail.w, this.grow, this.wob];
    this.xs = new Float32Array(SAMPLES + 1);
    this.rs = new Float32Array(SAMPLES + 1);
    this.cy = 0;
    this.R = 0;
    this.minX = 0;
    this.maxX = 0;
    this.active = null;
    this.idle = true;

    if (window.matchMedia('(hover: hover)').matches) {
      this.links.forEach((a) => a.addEventListener('pointerenter', () => this.to(a)));
      root.addEventListener('pointerleave', () => this.to(this.active));
    }
    // pressing the gel makes it swell, then it jiggles back
    root.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.store.motion || !e.target.closest?.('a[data-section]')) return;
        this.wob.v += 2.4;
        this.idle = false;
      },
      { passive: true },
    );
  }

  to(link, snap = false) {
    const reduced = !this.store.motion;
    if (!link || link.offsetParent === null) {
      this.grow.t = 0;
      if (reduced || snap) this.grow.snap(0);
      this.idle = false;
      return;
    }
    const c = link.offsetLeft + link.offsetWidth / 2;
    const w = link.offsetWidth / 2;
    this.cy = link.offsetTop + link.offsetHeight / 2;
    this.R = link.offsetHeight / 2;
    const first = this.links[0];
    const last = this.links[this.links.length - 1];
    this.minX = first.offsetLeft;
    this.maxX = last.offsetLeft + last.offsetWidth;
    const fresh = snap || reduced || this.grow.x < 0.05;
    for (const part of [this.head, this.tail]) {
      if (fresh) {
        part.c.snap(c);
        part.w.snap(w);
      } else {
        part.c.t = c;
        part.w.t = w;
      }
    }
    this.grow.t = 1;
    if (reduced || snap) this.grow.snap(1);
    this.idle = false;
  }

  // Keep a pill inside the capsule: liquid that overshoots squashes against
  // the wall (and bulges a little) instead of passing through the glass
  fit(c, w, r) {
    const hw = Math.max(w, r);
    let left = c - hw;
    let right = c + hw;
    const over = Math.max(0, this.minX - left, right - this.maxX);
    left = Math.max(left, this.minX);
    right = Math.min(right, this.maxX);
    const rr = Math.min(r * (1 + Math.min(0.12, over / (this.R * 4))), (this.maxX - this.minX) / 2);
    // it can't squash narrower than a round drop — then it rests on the wall
    if (right - left < 2 * rr) {
      if (left <= this.minX) right = left + 2 * rr;
      else left = right - 2 * rr;
    }
    return { c: (left + right) / 2, w: (right - left) / 2, r: rr };
  }

  setActive(id) {
    let link = this.links.find((a) => a.dataset.section === id) || null;
    if (!link && id === 'about') link = this.links.find((a) => a.dataset.section === 'top') || null;
    for (const a of this.links) {
      const on = a === link;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    }
    this.active = link;
    if (!this.root.matches(':hover')) this.to(link);
  }

  tick(dt) {
    if (this.idle) return;
    if (!this.store.motion) {
      this.springs.forEach((s) => s.snap());
      this.wob.snap(0);
    } else {
      // two substeps keep the stiff head stable when frames run long
      const h = Math.min(dt, 1 / 30) / 2;
      for (let i = 0; i < 2; i++) {
        this.head.c.step(h);
        this.head.w.step(h);
        this.tail.c.step(h);
        this.tail.w.step(h);
        this.grow.step(h);
        // a fast drop flattens; when it stops, the release overshoots — jelly
        this.wob.t = -clamp(Math.abs(this.head.c.v) / 4200, 0, 0.14);
        this.wob.step(h);
      }
    }
    const done = this.springs.every((s) => s.settled);
    if (done) this.springs.forEach((s) => s.snap());
    this.draw();
    if (done) this.idle = true;
  }

  draw() {
    const g = clamp(this.grow.x, 0, 1.2);
    if (g < 0.02 || this.R <= 0) {
      this.svg.style.display = 'none';
      return;
    }
    this.svg.style.display = '';
    const { head: H, tail: T, R, xs, rs } = this;
    const sep = Math.abs(H.c.x - T.c.x);
    const s = clamp(sep / (R * 3.4), 0, 1); // how stretched the drop is
    const s2 = s * s; // shape effects fade fast as the two halves rejoin
    const jel = 1 + this.wob.x;
    // the head swells as liquid gathers in it while the tail thins and
    // shortens as it drains; a taller drop is a narrower one (volume)
    const squeeze = (0.6 + 0.4 * Math.min(g, 1)) * (1 - 0.55 * this.wob.x);
    const head = this.fit(H.c.x, H.w.x * squeeze, R * g * (1 + 0.07 * s2) * jel);
    const tail = this.fit(T.c.x, T.w.x * (1 - 0.5 * s) * squeeze, R * g * (1 - 0.36 * s2) * jel);
    const kPills = R * 0.6 * s; // meniscus between overlapping pills (0 at rest)
    const thread = R * g * (0.6 - 0.36 * s); // capillary thread between the two
    const kThread = R * 0.42;
    const waist = R * g * 0.36 * s2; // the pull pinches a waist between the two
    const a = Math.min(head.c, tail.c);
    const b = Math.max(head.c, tail.c);
    const x0 = Math.min(head.c - head.w, tail.c - tail.w);
    const x1 = Math.max(head.c + head.w, tail.c + tail.w);
    const span = x1 - x0;

    for (let i = 0; i <= SAMPLES; i++) {
      const u = i / SAMPLES;
      // denser towards the round ends, where the outline turns fastest
      const x = x0 + span * (0.4 * u + 0.6 * (0.5 - 0.5 * Math.cos(Math.PI * u)));
      let r = smax(pill(x, head.c, head.w, head.r), pill(x, tail.c, tail.w, tail.r), kPills);
      if (b - a > 0.5 && x > a && x < b) {
        const bump = Math.sin((Math.PI * (x - a)) / (b - a));
        r = smax(r - waist * bump * bump, thread * (1 - 0.3 * bump), kThread);
      }
      xs[i] = x;
      rs[i] = r;
    }
    rs[0] = 0;
    rs[SAMPLES] = 0;

    const cy = this.cy;
    // outline: along the top edge, back along the bottom
    let body = `M${f(xs[0])} ${f(cy)}`;
    for (let i = 1; i <= SAMPLES; i++) body += `L${f(xs[i])} ${f(cy - rs[i])}`;
    for (let i = SAMPLES - 1; i > 0; i--) body += `L${f(xs[i])} ${f(cy + rs[i])}`;
    body += 'Z';
    // gloss: a band under the top surface; shade: thickness at the bottom
    let gloss = '';
    let glossBack = '';
    let shade = '';
    let shadeBack = '';
    for (let i = 0; i <= SAMPLES; i++) {
      const r = rs[i];
      const x = f(xs[i]);
      const lo = cy - r * 0.16;
      const hi = Math.min(lo, cy - r + Math.min(1, r * 0.4));
      gloss += `${i ? 'L' : 'M'}${x} ${f(hi)}`;
      glossBack = `L${x} ${f(lo)}${glossBack}`;
      const sTop = cy + r * 0.34;
      const sBot = Math.max(sTop, cy + r - Math.min(0.8, r * 0.4));
      shade += `${i ? 'L' : 'M'}${x} ${f(sTop)}`;
      shadeBack = `L${x} ${f(sBot)}${shadeBack}`;
    }
    this.pEdge.setAttribute('d', body);
    this.pBody.setAttribute('d', body);
    this.pGloss.setAttribute('d', `${gloss}${glossBack}Z`);
    this.pShade.setAttribute('d', `${shade}${shadeBack}Z`);
  }
}
