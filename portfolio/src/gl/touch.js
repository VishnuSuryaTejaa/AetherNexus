// Screen-space "noise brush": the pointer paints a fading trail that the
// vertex shader reads to add local σ (noise) and push particles apart.
// The engine uploads `canvas` as a texture only while the trail is alive.
export class TouchTexture {
  constructor(width = 192) {
    this.width = width;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.points = [];
    this.last = null;
    this.alive = 0; // seconds of trail left to fade
    this.dirty = true;
    this.resize(window.innerWidth / window.innerHeight);
  }

  resize(aspect) {
    const height = Math.max(48, Math.round(this.width / Math.max(0.3, aspect)));
    if (this.canvas.width === this.width && this.canvas.height === height) return;
    this.canvas.width = this.width;
    this.canvas.height = height;
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.last = null;
    this.dirty = true;
    this.resized = true;
  }

  // u, v in [0, 1], v measured from the top of the screen
  add(u, v) {
    const last = this.last;
    if (last) {
      const dx = (u - last.u) * this.canvas.width;
      const dy = (v - last.v) * this.canvas.height;
      const dist = Math.hypot(dx, dy);
      const force = Math.min(1, 0.3 + dist / 14);
      const steps = Math.min(24, Math.ceil(dist / 3));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        this.points.push({ u: last.u + (u - last.u) * t, v: last.v + (v - last.v) * t, force });
      }
    } else {
      this.points.push({ u, v, force: 0.4 });
    }
    this.last = { u, v };
  }

  lift() {
    this.last = null;
  }

  // Returns true when the texture changed and needs uploading
  update(dt) {
    if (!this.points.length && this.alive <= 0) return false;
    const { ctx, canvas } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(0,0,0,${Math.min(1, dt * 2.6)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (this.points.length) {
      ctx.globalCompositeOperation = 'lighter';
      const r = canvas.width * 0.075;
      for (const p of this.points) {
        const x = p.u * canvas.width;
        const y = p.v * canvas.height;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `rgba(255,255,255,${0.22 * p.force})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      this.points.length = 0;
      this.alive = 1.6;
    } else {
      this.alive -= dt;
      if (this.alive <= 0) {
        // fully faded: clear residue so the texture can go idle
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
    return true;
  }
}
