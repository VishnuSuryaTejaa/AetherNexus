// Liquid Glass maps — pure maths, no DOM, so they run in a worker.
// Both maps come from one physical model: a squircle bezel (Apple's preferred
// surface profile) around a rounded rectangle.
//  · shading: the bezel's normals lit from above (iOS 27 vertical light) →
//    specular rim, internal reflection, inner shadow for thickness
//  · displacement: the same normals bending the backdrop through Snell's law

const IOR = 1.5;
const SAMPLES = 128;
const MAP_SCALE = 0.5; // displacement is smooth — half resolution is plenty
const SPEC_MAX = 560; // longest side of a shading map (the crisp rim is CSS)
// Direction *towards* the light, in screen space (y points down): above, a touch left
const LX = -0.34;
const LY = -0.94;

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
    out[i] = Math.tan(thetaI - thetaT) * thickness * (squircle(x) + 0.15); // inward shift (px)
  }
  return out;
}

function sampleProfile(profile, t) {
  const f = Math.min(1, Math.max(0, t)) * (SAMPLES - 1);
  const i = Math.floor(f);
  const j = Math.min(SAMPLES - 1, i + 1);
  return profile[i] + (profile[j] - profile[i]) * (f - i);
}

// Walk the bezel band only. fn(index, t, nx, ny): t = 0 at the rim → 1 where
// the glass is flat; (nx, ny) = outward surface direction in the screen plane.
function walkBezel(W, H, scale, w, h, radius, bezel, fn) {
  const hw = w / 2;
  const hh = h / 2;
  const r = Math.min(radius, hw, hh);
  // rows away from the top/bottom bands only meet the bezel near the left and
  // right edges, so visit just those two strips (~7× fewer pixels on panels)
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

export function shadingPixels(w, h, radius, bezel, power) {
  const s = Math.min(1, SPEC_MAX / Math.max(w, h));
  const W = Math.max(2, Math.round(w * s));
  const H = Math.max(2, Math.round(h * s));
  const data = new Uint8ClampedArray(W * H * 4);
  walkBezel(W, H, s, w, h, radius, bezel, (i, t, nx, ny) => {
    const facing = nx * LX + ny * LY; // > 0: the edge faces the light
    const key = facing > 0 ? Math.pow(facing, 1.6) : 0;
    const back = facing < 0 ? Math.pow(-facing, 2.2) : 0;
    const rim = Math.exp(-t * 8.5); // hugs the outer edge
    const ring = Math.exp(-((t - 0.36) ** 2) / 0.03); // just inside the rim
    const hi = power * (rim * (0.66 * key + 0.32 * back) + ring * 0.12 * key);
    const sh = power * ring * 0.22 * back;
    const k = i * 4;
    if (hi >= sh) {
      data[k] = 240;
      data[k + 1] = 246;
      data[k + 2] = 255;
      data[k + 3] = hi * 255;
    } else {
      data[k] = 2;
      data[k + 1] = 5;
      data[k + 2] = 14;
      data[k + 3] = sh * 255;
    }
  });
  return { W, H, data };
}

export function displacementPixels(w, h, radius, bezel, strength) {
  const W = Math.max(2, Math.round(w * MAP_SCALE));
  const H = Math.max(2, Math.round(h * MAP_SCALE));
  const profile = refractionProfile(bezel, bezel);
  let maxD = 0;
  for (let i = 0; i < SAMPLES; i++) maxD = Math.max(maxD, profile[i]);
  maxD = Math.max(0.5, maxD * strength);
  const data = new Uint8ClampedArray(W * H * 4).fill(128); // neutral: no displacement
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  walkBezel(W, H, MAP_SCALE, w, h, radius, bezel, (i, t, nx, ny) => {
    const mag = sampleProfile(profile, t) * strength;
    const k = i * 4;
    data[k] = 128 + ((-nx * mag) / maxD) * 127;
    data[k + 1] = 128 + ((-ny * mag) / maxD) * 127;
  });
  return { W, H, data, scale: maxD * 2 };
}
