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
| Legibility vs. spectacle | **iOS 27 Liquid Glass.** It includes Apple's new Clear ↔ Tinted intensity slider, so visitors control contrast. Content panels use the denser "regular" glass and controls use "clear" glass. |
| Blocking loaders | **No splash screen.** HTML text is readable in the first paint. Three.js loads lazily, and the denoise intro plays *behind* text that's already visible. |
| Pictures, not decisions | **Evidence-first project cards.** Each card shows a one-line problem, an animated architecture diagram, key decisions and a headline metric. |
| Mobile afterthought | **A native iOS pattern on phones.** A floating Liquid Glass tab bar sits at the bottom, with a gel "droplet" selection and a separate round control button, as in iOS 26/27. |
| Accessibility | Honours `prefers-reduced-motion` plus an in-page Motion switch. Uses semantic landmarks, a skip link, visible focus and AA contrast. Content stays real HTML for SEO. |

## 3. Information architecture (all content from the résumé)

1. **Hero:** name, role line, positioning sentence, "Open to AI/ML engineering roles" status, and CTAs (View work, Résumé). The live particle portrait sits in a viewfinder HUD showing seed, step, σ and N.
2. **About: "The gap".** The résumé's own thesis gets a word-by-word scroll reveal: *"I follow the gap between what foundation models can do in research and what holds up in production…"* Below it: a full-stack ML pipeline (Data → Train → Retrieve → Orchestrate → Ship) and four proof stats: 88 % recall, < 300 ms voice latency, ~70 % less search effort, 6+ production apps.
3. **Selected work:** TalentOps, LexiGuard, Vorkos and Data Vacuum, as sticky stacked Liquid Glass cards, each with a bespoke animated SVG architecture diagram.
4. **Experience:** AIML Intern @ Altrosyn (2026) and Full-Stack AI Developer @ Mallurus Industry (2024–25), with a timeline that draws as you scroll. Education: SAI University, B.Tech CDS (AIML), 2023–27.
5. **Capabilities:** eight skill groups in a bento grid of glass tiles. Each one links to the project that proves it.
6. **Contact:** "Let's build something that *holds up* in production." Copy-to-clipboard email, LinkedIn, GitHub, résumé, and a live IST clock.

The phone number is deliberately left off the page; the résumé PDF stays available for download.

## 4. Visual system

**Palette: golden hour × blue hour.** It comes straight from the photo: warm key light, the ember stitch on the collar, the cream tee, and a cool rim light.

| Token | Hex | Use |
|---|---|---|
| night | `#07080B` | page |
| ink | `#0E1016` | panels |
| ember | `#FF6B2C` | primary accent, live states |
| amber | `#FFB35C` | highlights, metrics |
| cream | `#FFF1DC` | brightest particles |
| ice | `#8FD0FF` | rim light, noise, secondary |
| text / muted | `#F5F0E8` / `#9C978F` | copy |

**Type**
- **Geist Variable:** display and UI. Large and tight: −0.04 em tracking.
- **Instrument Serif Italic:** accent words, for human warmth.
- **Geist Mono:** HUD and data labels, for engineering precision.
- All three are self-hosted, so the site makes no third-party requests.

**Layout:** a 12-column grid, 1320 px max, 16 px mobile gutters. Radii are concentric (outer = inner + padding), following Apple's concentricity rule.

## 5. Liquid Glass material (iOS 27 refinement)

Built in layers, all derived from one physical model, a convex-squircle bezel (Apple's preferred surface profile):

1. **Volumetric bezel shading (every browser).** Each glass element gets its own shading map, generated at its exact size. The bezel's surface normals are lit from above (iOS 27's vertical light angle). That gives a bright specular rim where the edge faces the light, a softer internal reflection on the opposite edge, and a faint inner shadow for thickness. This is what separates Liquid Glass from flat "glassmorphism".
2. **Refraction (Chromium).** The same normals bend the backdrop through Snell's law (n = 1.5) via an SVG displacement map used as a `backdrop-filter`. Smaller controls also split R/G/B for the faint dispersion fringe real glass shows at its rim. Clear controls keep only a light frost so the lensing stays visible.
3. **Tint fill:** white α ≈ 0.03 → 0.18, driven by the intensity slider. iOS 27 dark glass is lighter, so we tint with light rather than black. Dense content panels use the stronger "regular" glass for legibility.
4. **Specular hairline + darkened edge:** a 1 px rim brightest at the top-left, plus the 0.5 px darkened outer ring that is new in iOS 27. Shadows are kept minimal.
5. **Touch response (no pointer tracking).** Glass lights up from the exact point you press it and bulges with a spring (iOS 26/27 behaviour). The gel droplet indicator squashes and stretches between nav items.
6. **Intensity slider:** Clear ↔ Tinted, defaulting to the midpoint as Apple does. It persists between visits.
7. **Scroll edge:** a soft tonal fade under the floating nav, with no frost of its own, so the nav's refraction of the content sliding beneath it stays visible.

Maps are generated off the critical path (about 5 ms each, at most 8 ms of work per frame) from ResizeObserver measurements, so they never force a layout.

## 6. Nano-particle engine

- **Stack:** Three.js r187 (WebGL2). One `THREE.Points` draw call with a custom `ShaderMaterial`. Morphing is stateless and runs on the GPU, so it is deterministic and scrubs perfectly back and forth.
- **Formations** (each a vec3 attribute):
  - Portrait: 2.5D relief from luminance plus a head ellipsoid.
  - The Gap: a research nebula, a production lattice, and procedural bridge streams flowing between them.
  - Galaxy: a dim spiral behind dense text.
  - Latent sphere: a Fibonacci shell plus orbit rings.
  - Signal ring: the contact portal.
- **Transition = a diffusion step:** `x = mix(A, B, ease(tᵢ)) + σ(t)·εᵢ`. σ peaks mid-transition, with a per-particle stagger.
- **Intro = reverse diffusion:** σ eases 2.6 → 0 over about 2.8 s, while the HUD counts steps 01 → 50.
- **Noise brush:** the cursor paints a fading screen-space touch texture. It adds local σ, a push and an ice-blue tint, then the particles re-denoise. It works on every formation, and on touch screens too.
- **Ambient dust:** 2–6 k nano particles with infinite scroll parallax, so every section has living background motion.
- **Post-processing:** HDR render target, bloom, subtle chromatic aberration, vignette, film grain and ACES tone mapping.
- **Adaptive quality:**
  - Four tiers (≈18 k → 90 k particles), chosen by GPU, cores, memory and viewport.
  - A 1.5 s FPS probe thins the draw range if frames drop. Particles are pre-shuffled, so a prefix is a uniform subsample.
  - DPR is clamped to ≤ 1.75.
  - Rendering pauses when the tab is hidden.
- **Fallbacks:** without WebGL2, a static "nano-halftone" portrait. With reduced motion, formations snap per section with a short fade, and there's no jitter, drift or brush.

## 7. Creative portrait treatment

1. **Live particle portrait.** The transparent cutout is resampled into a jittered grid of particles:
   - Size and brightness follow light.
   - A golden-hour gradient map runs ember → amber → cream.
   - An ice-blue rim light is detected from the alpha edge.
   - A focus falloff keeps the face as the hero.
2. **Static "nano-halftone" portrait.** It's generated offline with the same palette, plus a dissolving lower edge, as if the particles are drifting off. It serves as the no-WebGL fallback and the social / Open Graph card.

## 8. Motion spec

| Element | Motion |
|---|---|
| Smooth scroll | Lenis, 1.1 s exponential-out; disabled under reduced motion |
| Headline reveal | Masked lines rise, 0.9 s power4.out, 0.08 stagger |
| Thesis statement | Words brighten 12 % → 100 %, scrubbed by scroll |
| Glass cards | Opacity + translate only; filters are never animated on glass, which would break the backdrop |
| Project deck | Sticky stack; covered cards scale to 0.94 and fade |
| Nav droplet | Leading edge 0.35 s, trailing edge 0.6 s elastic (liquid stretch) |
| Stats | Count-ups (latency counts *down* 1200 → 300 ms) |
| CTAs | Magnetic pull, max 6 px |

## 9. Performance budget

- First readable paint: < 1 s on broadband. LCP < 2 s.
- JS ≈ 260 KB gzip total. Three.js is lazy-loaded after first paint.
- Frame rate: 60 fps on an M1-class laptop, ≥ 45 fps on recent phones (lower tier).
- Self-hosted fonts (latin subset); WebP images.

## 10. Build plan

1. Scaffold `portfolio/` (Vite 8, vanilla ES modules: no framework, so less JS).
2. Process the photo: sampling texture, nano-halftone portrait, OG card, favicon.
3. Particle engine: formations, shaders, touch texture, scroll mapping, quality tiers, post-processing.
4. Liquid Glass: CSS material, Chromium refraction generator, iOS 27 intensity control, gel droplet nav and mobile tab bar.
5. Sections and content, with animated SVG architecture diagrams.
6. Motion layer: Lenis, GSAP ScrollTrigger and SplitText, magnetic CTAs, press illumination.
7. Responsive layout, accessibility, reduced motion, fallbacks.
8. Verify: production build, desktop and mobile in a browser, console clean, frame-rate check.
