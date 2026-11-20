// Generates Liquid Glass maps off the main thread and returns PNG blobs.
import { displacementPixels, shadingPixels } from './glassMaps.js';

async function encode({ W, H, data }) {
  const canvas = new OffscreenCanvas(W, H);
  canvas.getContext('2d').putImageData(new ImageData(data, W, H), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

self.onmessage = async (e) => {
  const { id, version, w, h, radius, bezel, power, strength } = e.data;
  const out = { id, version };
  try {
    out.spec = await encode(shadingPixels(w, h, radius, bezel, power));
    if (strength) {
      const d = displacementPixels(w, h, radius, bezel, strength);
      out.disp = await encode(d);
      out.scale = d.scale;
    }
  } catch (err) {
    out.error = String(err);
  }
  self.postMessage(out);
};
