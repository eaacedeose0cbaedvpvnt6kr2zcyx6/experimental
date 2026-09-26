# Point-Cloud Stories

Two scroll-driven Arabic stories told in 3D, built as dense point clouds with a clay layer and a scan-style wireframe:

| Page | File | Shots | Scenes |
| --- | --- | --- | --- |
| الإسراء والمعراج | `public/stories/isra-miraj.html` | 23 | 20 |
| موسى وفرعون | `public/stories/musa-firaun.html` | 28 | 24 |

Both pages share one engine: `public/stories/engine.js`. The old path `/isra-miraj/` redirects to the new page.

---

## Stack

| Layer | What is used |
| --- | --- |
| 3D | **Three.js r128** (UMD from cdnjs) |
| Shaders | **GLSL** throughout, in `ShaderMaterial`s: point cloud, clay depth splats, clay shading, depth of field, bloom, tone mapping, 3D text |
| Animation | **GSAP 3.12.5**: `ScrollTrigger` (scroll scrubbing), `ScrollToPlugin` (chapter moves), timelines (intro, wandering light, camera return) |
| Geometry | Procedural. Every building, person, tree and wave is sampled by JavaScript functions. No model files, no scans |
| Text | DOM for body text; canvas-rasterised Arabic turned into particles for the 3D headings |

No build step. Open the HTML files through any static server.

---

## What the viewer sees

- A dark, muted palette with warm highlights; no saturated colour.
- **Clay render**: points become a solid, lit surface (the look of a white architectural model).
- **Scan wireframe**: contour and grid lines on surfaces, finer up close, plus white crease and silhouette edges.
- **Point cloud on top**: a fainter layer of glowing points over the clay.
- **Depth**: ambient occlusion on two radii, rim light, eye-dome lighting and a key light from above.
- **Displacement map**: a stone relief (noise plus cracks) pushes each point along its surface normal.
- **Depth of field**: a real per-pixel blur by distance from the focal plane, focused on the subject.
- **Moving glow**: a warm light drifts to random places around the subject, and soft patches of light bloom and fade at random.
- **Motion in the cloud itself**: the tawaf crowd circles the Kaaba, heaven rings turn, leaves and grass sway, sand drifts, rivers flow, crowds walk, the sea churns, rain falls, flames flicker.
- **People**: robed figures (stand, walk, raise, sit, bow). Prophets and angels appear only as **light figures**: a human silhouette of glow with an aura and no features.
- **Captions**: one caption at a time. Headings are written letter by letter as extruded 3D particles, and body words turn in from depth. Captions move around the frame (corners, centred, or heading and body split apart).
- **Free rotation**: a «تدوير حر» button. Drag to orbit, wheel or pinch to zoom, Esc to leave. A mouse drag in story mode also turns the view, and it eases back afterwards.
- The story starts on the first scroll. A click anywhere moves to the next moment, and the rail on the left jumps between chapters.

---

## Rendering pipeline (per frame)

```
scroll ──GSAP ScrollTrigger──► story progress ──► shot index u (eased between captions)
                                                    │
                    ┌───────────────────────────────┴──────────────────────────────┐
                    ▼                                                              ▼
        scene slots A/B (GPU buffers)                               camera path (Catmull-Rom through
        morph weight uW between them                                shot keyframes) + slow orbit + user yaw/pitch/zoom
                    │
   1. Clay depth pass ── points as sphere-cap splats, depth-tested ──► rtDepth (log2 depth, albedo, light-figure flag)
   2. Clay shading ─── EDL + normals from depth + AO + rim + key light + lamp + orb + glow patches
                       + grid/contour wireframe + edges + fog ─────────────────────────────► rtMain (HDR)
   3. Glow points, neighbour strokes, far stars, orb cloud (additive) ──────────────────────► rtMain
   4. Depth of field ── half-res gather blur (28 taps, circle of confusion from rtDepth) ─► rtDofH
                        blend with sharp frame by CoC ──────────────────────────────────────► rtDof
   5. Caption scrims (multiply) + 3D heading particles ─────────────────────────────────────► rtDof
   6. Bloom (bright pass, 2 blur scales) + exponential tone map + vignette + dither ─────────► screen
```

The clay and depth-of-field layers need half-float render targets. The engine tests a real half-float framebuffer at start-up (this matters on phones). If the test fails, the page falls back to glowing points only.

---

## Data model

### A point

Each point is a `vec4` per scene slot, plus one packed normal:

| Channel | Meaning |
| --- | --- |
| `xyz` | World position (scene offset already applied) |
| `w` | `brightness (0..3.9) + 4 × motionClass + 128 × spacingCode` |
| `nA` / `nB` | Octahedral-packed surface normal (two bytes in one float) |

- `spacingCode` (0..63) is the point's own neighbour spacing on a log scale, measured from how crowded its hash-grid cell is. Splats grow only where points are sparse, so gaps close without blurring dense detail.
- Normals come for free: every primitive that shades itself calls `shadeN(nx,ny,nz)`, and `set()` records that normal with the next point.

### Motion classes (`w` / 4)

| # | Motion | # | Motion |
| --- | --- | --- | --- |
| 0 | still (gets displacement) | 10 | swarm |
| 1 | circles the centre (tawaf) | 11 | slither (serpents, ropes) |
| 2 / 3 | slow turn either way | 12 | sea waves |
| 4 | far sky drift | 13 | walking toward −z |
| 5 | wind sway | 14 | churning water wall |
| 6 | light flowing outward | 15 | rain |
| 7 | sand blowing along +x | 16 | flame |
| 8 | motes rising | 17 | river ripple |
| 9 | streaming into the centre | 18 | light being (glow only, never clay) |

Classes 4, 6, 8, 9, 10, 15, 16 and 18 stay glowing points. All others also become clay.

### Scenes and shots

```js
PointStory.run({
  scenes: {
    kaaba: { at:[0,0,0], build: genKaaba },                 // build() returns a sampler
    vessels: { at:[0,0,-1220], build: genVessels, scale:.2 } // scale: small objects get finer strokes and grid
  },
  shots: [                                                  // one per <section class="cap">
    { scene:'kaaba', cam:[30,9,34], tgt:[0,6,0] },
    { scene:'vessels', cam:[2.2,1.8,3.6], tgt:[0,1.1,0], grain:.18, orbit:.4, dof:1 }
  ]
});
```

| Shot option | Effect |
| --- | --- |
| `cam`, `tgt` | Camera and look-at, relative to the scene's `at` |
| `grain` | Base point size and camera sway for close-ups (default 1) |
| `orbit` | Strength of the slow automatic orbit; lower it in tight interiors (default 1) |
| `dof` | Depth-of-field strength (default 1) |

### Scene memory

- Only two scenes live on the GPU at once (slots A and B). The engine swaps scenes in as the reader scrolls and morphs between them.
- Upcoming scenes are built in the background in ~9 ms slices and kept in a small cache (8 on desktop, 5 on phones).
- Far chapter jumps land at once, and the cloud regathers around the new subject.

---

## Writing a scene

A sampler places **one point per call**. `mix()` picks a part by weight; a part may `return false` to reject and resample.

```js
const { set, shadeN, box, cyl, dome, figure, light, terrain, palm, stars, mix, R, rn, TAU } = PointStory.H;

function genWell(){
  return mix([
    [.25, () => cyl(0,0,0, 1.4, .9, .6)],                                          // stone ring
    [.08, () => set(rn(-1,1), -.8, rn(-1,1), .5, 17)],                             // water, rippling
    [.30, () => terrain((x,z)=>.4*Math.sin(x*.1+z*.07), -50,50,-40,40, .7)],       // ground
    [.20, () => figure(3,2,0,1.75,.8,0,-1,0,'stand')],                             // a shepherd (clay)
    [.04, () => light(4,1.3,0,1.85,0,-1,'stand',1.8)],                             // a prophet, as light only
    [.13, () => stars(0,0,0,200)]
  ]);
}
```

### Helpers in `PointStory.H`

| Group | Helpers |
| --- | --- |
| Primitives | `box`, `cyl`, `dome`, `sphere`, `ellip`, `disk`, `ring`, `rod`, `pyramid`, `column` |
| Nature | `terrain`, `tree` (bark and leaves), `palm`, `reed`, `cloud`, `stars` |
| People | `figure` (poses: stand, walk, raise, sit, bow), `person`, `prostrate`, `sheep` |
| Light | `light` (prophets and angels as glow silhouettes), `flame` |
| Utilities | `set`, `shadeN`, `mix`, `archOpen`, `R`, `rn`, `gs`, `fr`, `inBall`, `smooth` |

---

## Caption markup

```html
<section class="cap cap--side" data-pos="sa">                 <!-- optional layout: br tr bl tl bc sa sb -->
  <p class="tw kicker" data-tw="30">٠٥ · بيت المقدس</p>
  <h2 class="tw tw3d" data-tw="11">المسجد الأقصى</h2>         <!-- tw3d: drawn as 3D particles -->
  <p class="tw verse-sm" data-tw="20">…آية…</p>
  <p class="tw" data-tw="34">…النص…</p>                         <!-- data-tw: letters per second -->
</section>
```

- Captions and shots must match one to one, in order.
- The rail buttons use `data-go="<shot index>"`.
- Without `data-pos`, layouts rotate automatically.

---

## Performance

| | Desktop (8+ cores) | Desktop | Phone |
| --- | --- | --- | --- |
| Points per scene | 450k | 300k | 110k |
| Neighbour strokes | 20k | 20k | 6k |
| Cached scenes | 8 | 8 | 5 |

- **Adaptive quality**: after 5 s, if frames average slower than 40 fps, the engine lowers render scale and point count in steps (up to three).
- **LOD**: far points thin out, and the survivors carry their light and grow their splats.
- `prefers-reduced-motion` turns off motion, the intro, the drifting light and the typing.

---

## Content sources

- Quran verses are quoted by sura and verse.
- Hadith reports cite al-Bukhari and Muslim where the text says so. Two sayings are attributed to Ibn Abbas: «قضى أكثرهما وأطيبهما», which al-Bukhari reports, and «كانوا أول النهار سحرة…», which comes from tafsir.
- Abu Bakr's reply is from al-Mustadrak.
- **Please review** before publishing:
  - The diacritics of every verse.
  - The few descriptive links added between events.

---

## Testing locally

```bash
cd public/stories && python3 -m http.server 8766
# open http://localhost:8766/isra-miraj.html  and  /musa-firaun.html
```

Headless Chromium with SwiftShader renders the pages, but very slowly at these point counts. Wait 30 to 45 s per shot before judging a screenshot.
