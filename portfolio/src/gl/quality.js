// Adaptive quality tiers. `grid` is the portrait sampling resolution: the
// cut-out covers ~55% of the square, so particles ≈ 0.55 · grid².
export const TIERS = [
  { name: 'low', grid: 180, dust: 1200, dpr: 1.25, bloom: false },
  { name: 'mid', grid: 240, dust: 2200, dpr: 1.5, bloom: true },
  { name: 'high', grid: 300, dust: 3400, dpr: 1.75, bloom: true },
  { name: 'ultra', grid: 380, dust: 4800, dpr: 2, bloom: true },
];

export function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

function gpuName() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return String(name || '').toLowerCase();
  } catch {
    return '';
  }
}

export function pickTier() {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const long = Math.max(window.innerWidth, window.innerHeight);
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 8;
  const gpu = gpuName();

  let t = 2;
  if (coarse || long < 900) t = 1;
  if (cores <= 4 || mem <= 4) t = Math.min(t, 1);
  if (cores <= 2 || mem <= 2) t = 0;
  if (!coarse && cores >= 8 && mem >= 8 && long >= 1280) t = 3;
  if (/swiftshader|llvmpipe|software|basic render/.test(gpu)) t = 0;
  else if (/intel/.test(gpu) && !/arc/.test(gpu)) t = Math.min(t, 2);
  if (/apple m\d|apple gpu|rtx|radeon pro|geforce/.test(gpu) && !coarse && long >= 1280) t = 3;

  return { index: t, ...TIERS[t], gpu };
}
