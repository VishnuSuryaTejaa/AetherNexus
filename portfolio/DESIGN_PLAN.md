# Portfolio redesign — design plan

**Owner:** V. Vishnu Surya Teja · AI/ML Engineer
**Concept:** *Signal from Noise*: the page generates itself the way a diffusion model does.
**Date:** 20 Nov 2026

---

## 1. Research: what today's best portfolios do

Benchmarks taken from the 2026 Awwwards portfolio listings:

| Site | Recognition | What stands out |
|---|---|---|
| **Agence F+** (fplus.ai) | Nominee · Aug 2026 | A real-time WebGL particle field morphs behind every page. The team assembles from clouds of 2D particles on scroll, and a cursor-reactive "flywheel" marquee spins. Built on Nuxt SSG, Three.js, GSAP and Lenis. |
| **Valentin Gassend** | Honorable Mention · May 2026 | Immersive WebGL with GSAP, an infinite-scroll gallery, a custom loader and page transitions, and a Lab page and 404 treated as design work. The palette is restrained (#F3F3F3 / #F6E3E3). |
| **Carter Ogunsola** | SOTD + Developer Award · 19 Nov 2026 | Current top developer portfolio. Design details weren't published in the listing. |
| **Léo Parpeix — Portfolio 2026** | SOTD + Developer Award · Sep 2026 | Only the award is confirmed. |
| **HAOQI.DESIGN** | SOTD + Developer Award · Aug 2026 | Only the award is confirmed. |

**Patterns they share**
- A WebGL scene sits behind the content.
- Content assembles on scroll.
- Reveals run on GSAP and Lenis smooth scroll.
- Loaders and transitions are custom.
- Cursor-reactive details.
- One accent on a restrained palette.
- Secondary pages get crafted too.

**Where they fall short (our opening)**
1. **The particles are decoration.** They say nothing about the person.
2. **Usability scores trail creativity scores.** Text sits over busy WebGL, visitors get no control over effects, and mobile and reduced-motion support come as afterthoughts.
3. **Loaders block content.** Heavy stacks delay the first readable paint.
4. **Projects are shown as pictures, not decisions.** Recruiters look for judgment, ownership and impact, and that gets buried under spectacle.

## 2. Our answer

| Weakness | Our design move |
|---|---|
| Decorative particles | **The particle system is a diffusion model.** The portrait is denoised from Gaussian noise (σ → 0 over 50 "steps"). Each later section re-generates a new formation from noise. The cursor is a noise brush: it adds σ locally, and the particles denoise back. The motif is the engineer's own craft. |
| Legibility vs. spectacle | **iOS 27 Liquid Glass.** Content panels use the denser "regular" glass and controls use "clear" glass, so copy stays legible over the live particle field. |
| Blocking loaders | **No splash screen.** HTML text is readable in the first paint. The hand-written WebGL2 engine (≈ 13 KB gzip) loads after first paint, and the denoise intro plays *behind* text that's already visible. |
| Pictures, not decisions | **Evidence-first project cards.** Each card shows a one-line problem, an animated architecture diagram, key decisions and a headline metric. |
| Mobile afterthought | **A native iOS pattern on phones.** A floating Liquid Glass tab bar sits at the bottom, and its selection is a drop of liquid that flows from tab to tab, as in iOS 26/27. |
| Accessibility | Honours `prefers-reduced-motion` (formations snap, the liquid selection jumps). Uses semantic landmarks, a skip link, visible focus and AA contrast. Content stays real HTML for SEO. |

## 3. Information architecture (all content from the résumé)

1. **Hero:** name, role line, positioning sentence, "Open to AI/ML engineering roles" status, and CTAs (View work, Résumé). The live particle portrait sits in a viewfinder HUD showing seed, step, σ and N.
2. **About: "The gap".** The résumé's own thesis gets a word-by-word scroll reveal: *"I follow the gap between what foundation models can do in research and what holds up in production…"* Below it: a full-stack ML pipeline (Data → Train → Retrieve → Orchestrate → Ship) and four proof stats: 88 % recall, < 300 ms voice latency, ~70 % less search effort, 6+ production apps.
3. **Selected work:** TalentOps, LexiGuard, Vorkos and Data Vacuum, as sticky stacked Liquid Glass cards, each with a bespoke animated SVG architecture diagram.
4. **Experience:** AIML Intern @ Altrosyn (2026) and Full-Stack AI Developer @ Mallurus Industry (2024–25), with a timeline that draws as you scroll. Education: SAI University, B.Tech CDS (AIML), 2023–27.
5. **Capabilities:** eight skill groups in a bento grid of glass tiles. Each one links to the project that proves it.
6. **Contact:** "Let's build something that *holds up* in production." Copy-to-clipboard email, LinkedIn, GitHub, résumé, and a live IST clock.

The phone number is deliberately left off the page; the résumé PDF stays available for download.

## 4. Visual system

**Palette: moonlight.** Navy shadows rise through electric blue to frost highlights, with a violet rim light: cool and precise, so the portrait reads like a photograph lit by a screen at night.

| Token | Hex | Use |
|---|---|---|
| night | `#05070D` | page |
| ink | `#0C1120` | panels |
| accent | `#6AA8FF` | primary accent, live states |
| accent-2 | `#A18BFF` | violet rim light, highlights |
| accent-deep | `#3D6BFF` | prominent (tinted) buttons |
| frost | `#EAF3FF` | brightest particles |
| ice | `#8FD6FF` | noise tint, secondary |
| text / muted | `#EEF2F8` / `#8E97A8` | copy |

**Type**
- **Geist Variable:** display and UI. Large and tight: −0.04 em tracking.
- **Instrument Serif Italic:** accent words, for human warmth.
- **Geist Mono:** HUD and data labels, for engineering precision.
- All three are self-hosted, so the site makes no third-party requests.

**Layout:** a 12-column grid, 1320 px max, 16 px mobile gutters. Radii are concentric (outer = inner + padding), following Apple's concentricity rule.

## 5. Liquid Glass material (iOS 27 refinement)

Built in layers, all derived from one physical model, a convex-squircle bezel (Apple's preferred surface profile):

1. **Volumetric bezel shading (every browser).** Each glass element gets its own shading map, generated at its exact size. The bezel's surface normals are lit from above (iOS 27's vertical light angle). That gives a bright specular rim where the edge faces the light, a softer internal reflection on the opposite edge, and a faint inner shadow for thickness. This is what separates Liquid Glass from flat "glassmorphism".
2. **Refraction (Chromium, fine pointers).** The same normals bend the backdrop through Snell's law (n = 1.5) via an SVG displacement map used as a `backdrop-filter`. On strong GPUs, smaller controls also split R/G/B for the faint dispersion fringe real glass shows at its rim.
3. **Tint fill:** a light white fill (α ≈ 0.1). iOS 27 dark glass is lighter, so we tint with light rather than black. Dense content panels use the stronger "regular" glass for legibility.
4. **Specular hairline + darkened edge:** a 1 px rim brightest at the top-left, plus the 0.5 px darkened outer ring that is new in iOS 27. Shadows are kept minimal.
5. **Touch response (no pointer tracking).** Glass lights up from the exact point you press it and bulges with a spring (iOS 26/27 behaviour).
6. **Scroll edge:** a soft tonal fade under the floating nav, with no frost of its own, so the nav's refraction of the content sliding beneath it stays visible.

Maps are generated in a Web Worker from ResizeObserver measurements (only for glass near the viewport), so they never force a layout.

### 5a. Navigation: glass groups and a liquid selection

- **Structure.** The desktop bar is three floating glass pieces, like iOS 27 toolbar groups: the monogram, a capsule of section links, and the tinted Résumé button. On phones the monogram and Résumé sit in the top corners and the sections move to the bottom tab bar.
- **The selection is a drop of gel.** When the active section changes, a stiff *head* races to the new item while a soft *tail* drains after it. The drop stretches, pinches a waist, necks into a capillary thread on long moves, squashes against the capsule wall if it overshoots, and lands with a jelly wobble. Pressing an item makes the gel swell and jiggle.
- **How it's drawn.** The outline is a 1-D thickness profile r(x): two round-capped pills plus the thread, joined with smooth maxima so every join is a meniscus. It is rendered as plain SVG paths (body, rim, gloss, shade), so it stays vector-crisp at any zoom. No filters are used, and nothing runs once the drop settles.

## 6. Nano-particle engine

- **Stack:** hand-written WebGL2 (no Three.js), GLSL ES 3.00 shaders linked in parallel (`KHR_parallel_shader_compile`). One points draw call. Morphing is stateless and runs on the GPU, so it is deterministic and scrubs perfectly back and forth.
- **Off the main thread:** a Web Worker fetches and decodes the portrait and builds every formation. A second worker probes the GPU (`OffscreenCanvas`), and software rasterisers get the static portrait instead of a stuttering one.
- **Formations** (each a vec3 attribute):
  - Portrait: 2.5D relief from luminance plus a head ellipsoid.
  - The Gap: a research nebula, a production lattice, and procedural bridge streams flowing between them.
  - Galaxy: a dim spiral behind dense text.
  - Latent sphere: a Fibonacci shell plus orbit rings.
  - Signal ring: the contact portal.
- **Transition = a diffusion step:** `x = mix(A, B, ease(tᵢ)) + σ(t)·εᵢ`. σ peaks mid-transition, with a per-particle stagger.
- **Intro = reverse diffusion** on the Karras schedule (σ 2.6 → 0.002, ρ = 7), 50 steps over 3 s, while the HUD counts the steps.
- **Noise brush:** the cursor paints a fading screen-space touch texture. It adds local σ, a push and an ice-blue tint, then the particles re-denoise. It works on every formation, and on touch screens too.
- **Ambient dust:** 0.9–4.2 k nano particles with infinite scroll parallax.
- **Post-processing:** HDR (RGBA16F) render target, quarter-resolution bloom (bright pass plus separable blur), ACES tone mapping, vignette and film grain.
- **Adaptive quality:**
  - Five budgets, from ≈ 22 k particles (low-end phones) to ≈ 90 k (strong desktop GPUs), chosen by GPU class, cores, memory and viewport.
  - The engine draws on the system's default GPU. Asking for the high-performance one makes dual-GPU Macs switch chips, which blocked the main thread for ~0.2 s on every load (≈ 0.7 s under Lighthouse's 4× CPU throttling) and costs battery.
  - The canvas renders at the display's own pixel ratio (up to 2×) within a per-budget megapixel cap, so the portrait is Retina-sharp and 4K/5K screens still start in budget.
  - Frames are paced at 60 fps in motion and 30 fps at rest.
  - If frames still run long, an FPS probe steps down: resolution first, then bloom, then particle count. Particles are pre-shuffled, so a prefix is a uniform subsample, and dot size compensates so brightness holds.
  - Measured at 2880 × 1800: Intel UHD 630 ≈ 10 ms of GPU per frame (59 k particles), Radeon Pro 555X ≈ 5.5 ms (74 k).
- **Fallbacks:** without WebGL2, a static "nano-halftone" portrait. With reduced motion, formations snap per section with a short fade, and there's no jitter, drift or brush.

## 7. Creative portrait treatment

1. **Live particle portrait.** The transparent cutout is resampled into a jittered grid of particles, one per cell:
   - Size and brightness follow light.
   - A moonlight gradient map runs navy → electric blue → frost.
   - A violet rim light is detected from the alpha edge.
   - A focus falloff keeps the face as the hero.
   - The portrait breathes and twinkles at under a third of the abstract formations' rate, so it holds still enough to read like a photograph.
2. **Static "nano-halftone" portrait.** It's generated offline with the same palette, plus a dissolving lower edge, as if the particles are drifting off. It serves as the no-WebGL fallback and the social / Open Graph card.

## 8. Motion spec

| Element | Motion |
|---|---|
| Smooth scroll | Lenis (loaded after first paint, fine pointers only); off under reduced motion |
| Headline reveal | CSS keyframes: masked lines rise (transform only, so LCP never waits on JS), staggered |
| Thesis statement | Words brighten from a 40 % floor to 100 %, scrubbed by scroll |
| Glass cards | Opacity + translate only; filters are never animated on glass, which would break the backdrop |
| Project deck | Sticky stack; covered cards recede in two stages and fade |
| Nav selection | Liquid drop: head spring k 430 / ζ 0.66, tail k 100 / ζ 0.94; ≈ 0.45 s between neighbours, ≈ 0.6 s across the bar |
| Stats | Count-ups (latency counts *down* 1200 → 300 ms) |
| CTAs | Magnetic pull, max 6 px |

## 9. Performance budget

- First readable paint < 1 s on broadband, LCP < 2 s, no layout shift.
- JS ≈ 30 KB gzip in total: the main bundle (≈ 10.5 KB) runs first; the WebGL engine (≈ 12.6 KB) and Lenis (≈ 5.4 KB) load after first paint.
- Frame rate: 60 fps in motion on integrated laptop GPUs at full Retina resolution; 30 fps pacing on phones and at rest.
- Self-hosted fonts (latin subset, critical faces preloaded); WebP images; sections below the fold use `content-visibility: auto`.

## 10. Build plan

1. Scaffold `portfolio/` (Vite 8, vanilla ES modules: no framework, so less JS).
2. Process the photo: sampling texture, nano-halftone portrait, OG card, favicon.
3. Particle engine: raw WebGL2, worker-built formations, shaders, touch texture, scroll mapping, GPU budgets, post-processing.
4. Liquid Glass: CSS material, worker-generated shading and refraction maps, glass-group nav with the liquid selection, mobile tab bar.
5. Sections and content, with animated SVG architecture diagrams.
6. Motion layer: CSS intro, IntersectionObserver reveals, scroll-scrubbed effects, magnetic CTAs, press illumination.
7. Responsive layout, accessibility, reduced motion, fallbacks.
8. Verify: production build, desktop and mobile in a browser, console clean, frame-rate and Lighthouse checks.
