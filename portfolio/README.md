# V. Vishnu Surya Teja: portfolio

*Signal from Noise*. In this portfolio, the hero portrait is denoised out of Gaussian noise, the way a diffusion model generates an image. Every section then re-generates a new nano-particle formation, all under an iOS 27-style Liquid Glass interface. The design rationale and research are in [DESIGN_PLAN.md](DESIGN_PLAN.md).

## Run

```bash
npm install
```

```bash
npm run dev       # http://localhost:5199
```

```bash
npm run build     # production build → dist/
```

```bash
npm run preview   # serve dist/ on http://localhost:5200
```

`dist/` is a static site (relative paths), so it can be hosted anywhere: Vercel, Netlify, GitHub Pages or S3.

## Where things live

| What | Where |
|---|---|
| All page content (from the résumé) | `index.html` |
| Particle engine: raw WebGL2, formations worker, GPU budgets, post-processing | `src/gl/` |
| Liquid Glass: shading and refraction maps (built in a worker) | `src/ui/liquidGlass.js`, `src/ui/glassMaps.js`, `src/styles/glass.css` |
| Liquid nav selection | `src/ui/liquid.js`, `src/ui/nav.js` |
| Reveals, scroll effects, magnetic CTAs, misc UI | `src/ui/` |
| Design tokens, layout, sections | `src/styles/` |
| Portrait sampling texture, avatar | `src/assets/` |
| Résumé PDF, halftone fallback portrait, social card, favicon | `public/` |

## Before deploying

- **Social card:** set `og:image` in `index.html` to an absolute URL, for example `https://your-domain/og.jpg`.
- **Phone number:** it is intentionally not shown on the page. The downloadable résumé in `public/` still contains it.
