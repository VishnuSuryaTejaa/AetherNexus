import { defineConfig } from 'vite';

// Preload the three latin faces the first screen needs. Vite hashes font file
// names, so the links are injected after bundling.
const CRITICAL_FONTS = [/geist-latin-wght-normal/, /instrument-serif-latin-400-italic/, /geist-mono-latin-wght-normal/];

function preloadCriticalFonts() {
  return {
    name: 'preload-critical-fonts',
    enforce: 'post',
    transformIndexHtml(html, ctx) {
      if (!ctx.bundle) return html;
      const tags = Object.keys(ctx.bundle)
        .filter((f) => f.endsWith('.woff2') && CRITICAL_FONTS.some((r) => r.test(f)))
        .map((f) => ({
          tag: 'link',
          attrs: { rel: 'preload', href: `./${f}`, as: 'font', type: 'font/woff2', crossorigin: '' },
          injectTo: 'head',
        }));
      return { html, tags };
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [preloadCriticalFonts()],
  server: { port: 5199, strictPort: true },
  preview: { port: 5200, strictPort: true },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    modulePreload: { polyfill: false },
  },
});
