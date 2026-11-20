// Builds every particle formation off the main thread: fetches and decodes the
// portrait, resamples it on an OffscreenCanvas, runs the maths (≈150 ms on a
// laptop, ~4× that on a phone) and hands the typed arrays back zero-copy.
import { buildFormations } from './formations.js';

async function pixelsFrom(url, grid) {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(grid, grid);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, grid, grid);
  bitmap.close?.();
  return ctx.getImageData(0, 0, grid, grid).data;
}

self.onmessage = async (e) => {
  const { url, pixels, grid, seed } = e.data;
  try {
    const px = pixels ? new Uint8ClampedArray(pixels) : await pixelsFrom(url, grid);
    const d = buildFormations(px, grid, seed);
    const transfer = [...d.positions.map((p) => p.buffer), d.color.buffer, d.tone.buffer, d.rand.buffer, d.eps.buffer];
    self.postMessage(d, transfer);
  } catch (err) {
    self.postMessage({ error: String(err) });
  }
};
