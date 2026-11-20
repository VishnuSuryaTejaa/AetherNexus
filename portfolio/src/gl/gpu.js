// GPU probe shared by the particle engine and the Liquid Glass layer.
//
// The probe runs in a worker (OffscreenCanvas) so the expensive first-context
// GPU set-up never blocks the main thread. `failIfMajorPerformanceCaveat`
// makes software rasterisers (SwiftShader, llvmpipe, blocklisted drivers)
// refuse the context — those visitors get the static portrait instead of a
// stuttering one. Browsers without WebGL in workers fall back to a
// main-thread probe.
let cached = null;
let pending = null;

function classify(ok, renderer) {
  const r = String(renderer || '').toLowerCase();
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const software = /swiftshader|llvmpipe|softpipe|software|basic render/.test(r);
  // Discrete GPUs and Apple silicon; integrated Intel / mobile GPUs are "weak"
  const strong = !coarse && /apple m\d|apple gpu|nvidia|geforce|rtx|quadro|radeon|amd|arc a\d/.test(r);
  return { ok: ok && !software, renderer: r, coarse, strong };
}

function probeMainThread() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (!gl) return classify(false, '');
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return classify(true, renderer);
  } catch {
    return classify(false, '');
  }
}

export function probeGpu() {
  if (cached) return Promise.resolve(cached);
  if (pending) return pending;
  pending = new Promise((resolve) => {
    const finish = (info) => {
      cached = info;
      resolve(info);
    };
    if (typeof OffscreenCanvas === 'undefined' || typeof Worker === 'undefined' || !('WebGL2RenderingContext' in window)) {
      return finish('WebGL2RenderingContext' in window ? probeMainThread() : classify(false, ''));
    }
    let worker;
    try {
      worker = new Worker(new URL('./gpu-probe.worker.js', import.meta.url), { type: 'module' });
    } catch {
      return finish(probeMainThread());
    }
    const fallback = () => {
      worker.terminate();
      finish(probeMainThread());
    };
    const timer = setTimeout(fallback, 5000);
    worker.onerror = () => {
      clearTimeout(timer);
      fallback();
    };
    worker.onmessage = (e) => {
      clearTimeout(timer);
      worker.terminate();
      // No WebGL inside workers (older Safari) ≠ no WebGL — confirm on the main thread
      finish(e.data.ok ? classify(true, e.data.renderer) : probeMainThread());
    };
    worker.postMessage(0);
  });
  return pending;
}

export const gpuInfo = () => cached;

// Particle budget per class. grid → particles ≈ 0.51·grid² (the cut-out covers
// about half the square). The canvas renders at the display's own pixel ratio
// (capped at 2, and at `mp` megapixels so 4K/5K screens start in budget) so the
// portrait stays crisp on Retina screens; fps is the cap while something
// moves / at rest. Measured on a 2880×1800 canvas: Intel UHD 630 ≈ 10 ms of
// GPU per frame at the integrated budget, Radeon Pro 555X ≈ 5.5 ms at high.
// The engine draws on the system's default GPU, the same one probed here.
export function pickTier() {
  const g = cached || classify(true, '');
  const long = Math.max(window.innerWidth, window.innerHeight);
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 8;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (g.coarse || long < 900) {
    const lowEnd = cores <= 4 || mem <= 3;
    return lowEnd
      ? { name: 'mobile-low', grid: 210, dust: 900, dpr: Math.min(dpr, 1.5), mp: 1.6, bloom: false, fpsIdle: 30, fpsActive: 30 }
      : { name: 'mobile', grid: 290, dust: 1600, dpr, mp: 2.6, bloom: true, fpsIdle: 30, fpsActive: 30 };
  }
  if (g.strong && cores >= 8 && long >= 1280) return { name: 'ultra', grid: 420, dust: 4200, dpr, mp: 9, bloom: true, fpsIdle: 30, fpsActive: 60 };
  if (g.strong) return { name: 'high', grid: 380, dust: 3400, dpr, mp: 7, bloom: true, fpsIdle: 30, fpsActive: 60 };
  // Integrated GPUs (e.g. Intel UHD): still Retina-sharp, slightly fewer particles
  return { name: 'integrated', grid: 340, dust: 2600, dpr, mp: 5.4, bloom: true, fpsIdle: 30, fpsActive: 60 };
}
