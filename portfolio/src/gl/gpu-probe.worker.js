// Creates (and immediately releases) a WebGL2 context off the main thread.
// The first context in a page pays the GPU-channel set-up cost (hundreds of
// ms on integrated GPUs); doing it here keeps that off the main thread and
// leaves the engine's own context creation warm (~10 ms).
self.onmessage = () => {
  let ok = false;
  let renderer = '';
  try {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2', { failIfMajorPerformanceCaveat: true });
    if (gl) {
      ok = true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      renderer = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    ok = false;
  }
  self.postMessage({ ok, renderer });
};
