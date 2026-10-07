# Hairline SVG direction

Use one detailed, interactive illustration at a time. Start from an existing wallet image and preserve its meaning.

The first example develops the wallet security section's **Audit log** image into four layered paper records. The folded corner, binding holes, ruled entries, and thin paper edges identify the object without words inside the drawing.

The second example develops **Scoped credentials** into four cut metal keys on a shared ring. The user approved this animation on 2026-10-07. Preserve its geometry and interaction as the reference for the remaining examples. Each example has its own review page.

## Replacement status

The security section contains four custody illustrations and one threshold-signing illustration. Review each replacement separately before frontpage integration.

| Existing asset     | Replacement status                                                                             |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| Scoped credentials | Keychain approved.                                                                             |
| Audit log          | Paper-record example available for review.                                                     |
| Policy engine      | Interlock concept approved. Three-layer sieve available as another policy-filtering direction. |
| Split-key custody  | Not started.                                                                                   |
| Threshold signing  | Not started.                                                                                   |

## Reference and engine

- [Hairline figures](https://hairline.lucasmarkes.com/figures)
- [Official creation skill](https://hairline.lucasmarkes.com/skill)
- [Upstream source](https://github.com/lucasmarkes/hairline)

Use the `hairline-create` skill. Its unchanged kernel supplies projection, springs, pointer handling, drawing primitives, and theme styles. Its unchanged bench supplies the review page. The source figure contains the wallet-specific geometry and interaction.

The kernel and bench use the MIT license. Keep `HAIRLINE-LICENSE.txt` beside the generated page.

## Drawing

- Use the engine's 400 × 320 coordinate system and isometric camera.
- Build recognizable objects from rounded outlines and specific physical details.
- Keep outer outlines stronger than internal rules and creases.
- Use opaque surfaces. Paint from back to front so nearer sheets cover farther sheets.
- Use the engine's stroke classes. Keep color, line weight, and theme behavior in the shared engine.
- Highlight one object. Transfer the outline highlight to the selected record.
- Keep words, numbers, arrows, and interface controls outside the SVG drawing.
- Compose a complete resting pose that remains recognizable at 240px.

Retain the wallet site's typography and spacing when integrating approved artwork. Keep the current example isolated on its review page until its appearance and movement are accepted.

## Audit log interaction

Moving horizontally separates the sheets. Each sheet moves around the stack's center, so the composition remains centered as it opens. Moving over an exposed sheet transfers the highlighted outline and updates the short record readout.

Pointer exit returns the stack to its resting spacing. The intensity slider controls the maximum separation. Its low, middle, and high values are 18, 26, and 34 world units.

The shared spring follows continuous pointer input. Its default stiffness is 100, damping is 18, and mass is 1. The engine stops its frame loop when the spring settles and respects the operating system's reduced-motion preference.

Hit testing uses the target position, from the front sheet to the back sheet. It excludes covered sheets and the cut corner. Testing a moving sheet's current position can cause unstable selection, so use the target geometry consistently.

The figure updates paths only when the sheet spacing changes. Theme and outline transitions come from the shared engine.

## Source and rebuild

The source image lives in `apps/wallet-console/src/components/h2/sections.tsx`, in `H2Security` under **Audit log**.

The replacement review page has these files:

- `apps/wallet-console/showcase/motion/audit-log.js` — editable figure.
- `apps/wallet-console/showcase/motion/index.html` — generated, self-contained page.
- `apps/wallet-console/showcase/motion/HAIRLINE-LICENSE.txt` — upstream license.

Edit only the figure when changing the artwork. Rebuild with the installed skill:

```sh
node "$HOME/.codex/skills/hairline-create/build.mjs" \
  apps/wallet-console/showcase/motion/audit-log.js \
  apps/wallet-console/showcase/motion/index.html
```

Do not format or manually edit the generated HTML. The validator checks that its kernel and bench remain unchanged.

The local review URL is `/dashboard-static/showcase/motion/`. The page contains one figure with intensity and theme controls.

## Scoped credentials example

The keychain preserves the circular heads and patterned shafts from the wallet's existing **Scoped credentials** illustration. Four cut patterns distinguish the keys. Recessed channels, thin metal edges, and slotted heads give the object physical detail.

Hovering a key slides it forward along its shaft. Nearby keys rotate slightly away, with a 35ms delay per key of distance. Pointer exit retracts the selected key and restores the resting fan. The bright outline follows selection, and the readout names the selected key.

The shared ring is a torus: a circular metal tube with a round cross-section. Its centreline radius is 26 world units, and its tube radius is 2.6. Projected surface contours show its depth. Ring sections sit between the key layers, so each opaque face hides the metal beneath it.

The ring passes through elongated openings in the key heads. These openings permit limited travel while the keys remain attached. Their width and rounded ends leave clearance around the tube throughout the full slide. An even-odd fill rule leaves a real hole through each face.

The intensity slider controls travel at 12, 18, or 24 world units. Selection uses the resting key angles, so a moving key cannot change its own hover target. The shared 700ms tween handles selection changes and reverses from the current pose.

This is an illustration of distinct credentials. Selecting a key does not grant permission or represent a signing ceremony.

Edit `apps/wallet-console/showcase/motion/credentials/scoped-credentials.js`, then rebuild:

```sh
node "$HOME/.codex/skills/hairline-create/build.mjs" \
  apps/wallet-console/showcase/motion/credentials/scoped-credentials.js \
  apps/wallet-console/showcase/motion/credentials/index.html
```

Review it at `/dashboard-static/showcase/motion/credentials/`. From `.artifacts/scoped-credentials`, run the repeatable visual check:

```sh
node "$HOME/.codex/skills/hairline-create/look.mjs" \
  ../../apps/wallet-console/showcase/motion/credentials/scoped-credentials.js \
  --answer 0,90,9 --edge 70,100,3 --zoom answer
```

Inspect the tooth contours, ring, and openings at full size. Select each key, switch quickly between keys, and leave the figure. Check that the selected key stays attached and all keys remain inside the frame at maximum travel.

## Three-layer sieve example

The graded sieve replaces the rejected single-plate shape sorter. Three circular screens sit on four slender support rods above a collection plate. Dense perforations, machined rims, hexagonal fasteners, and thin screen material give it the form of a laboratory screening assembly. The grains are uneven, tapered fragments with visible facets.

The screens have progressively smaller round openings. Their aperture radii are 9, 4.6, and 2.4 world units. The fragment sizes are 12, 7, 3.8, and 2 units before their irregular outlines are applied. Twelve fragments form four groups: two coarse fragments stop at the upper screen, three medium fragments stop at the middle screen, two small fragments stop at the lower screen, and five fines reach the collector. The finer feed positions sit toward the front so their final positions remain visible.

Hovering lowers the fragments through four successive stages. Each stage includes a short pause at the screen. A fragment stops when its size exceeds the next opening. The frame stays rigid. A highlighted fine grain carries the eye through the screens, then transfers the highlight to the collector. Pointer exit reverses the same path from its current position.

The 1700ms tween gives the three screening stages time to read. The intensity slider controls the outward stagger at 30, 60, or 90 milliseconds per grid step. The stationary stage is the hover target. The kernel supplies its standard easing, reduced motion, and offscreen sleep. Grain paths update only when their height changes.

Each screen combines a five-unit structural rim with a 0.8-unit perforated sheet. The visible bore is the intersection of the projected upper and lower openings. Each fragment draws in separate vertical bands between screens. This keeps the opaque plates in front of the material beneath them. The rods and their fasteners also follow the back-to-front order.

The sieve remains a review alternative alongside the selected interlock. Its metaphor is successive filtering: each layer applies a tighter condition. Review this direction before frontpage integration.

Edit `apps/wallet-console/showcase/motion/policy/graded-sieve.js`, then rebuild:

```sh
node "$HOME/.codex/skills/hairline-create/build.mjs" \
  apps/wallet-console/showcase/motion/policy/graded-sieve.js \
  apps/wallet-console/showcase/motion/policy/index.html
```

Review it at `/dashboard-static/showcase/motion/policy/`. From `.artifacts/graded-sieve`, run:

```sh
node "$HOME/.codex/skills/hairline-create/look.mjs" \
  ../../apps/wallet-console/showcase/motion/policy/graded-sieve.js \
  --answer 0,0,136 --edge 43,20,83 --zoom answer
```

Inspect the contact sheet, motion sheet, and enlarged answer. Follow a fine fragment through all three screens. Check that larger fragments stay on their correct screen. Enter and leave during motion to check reversal. Inspect the rod connections, aperture walls, both themes, and both slider extremes.

The fixed frame and dense perforations dominate the 240px view. The automated changed-ink metric therefore reports a small response. This is deliberate: the grains carry the motion while the machine stays fixed. Inspect the finer material at full size when judging the filtering sequence.

## Combination interlock

The user selected the combination interlock for **Policy engine** on 2026-10-07 and requested more mechanical detail. Three independently rotated discs share an axle. Each disc has a radial slot. All three slots must align before a rigid bar can pass through the assembly. Each disc represents a required policy condition.

The wheels use the original circular grooves and radial tick marks requested in the reference screenshot. Raised axle collars, rounded bearing supports, a slotted retaining cap, and four mounting holes give the assembly depth. Rounded slot corners leave clearance around the bar.

Hovering the figure aligns the discs, then advances the bar. Pointer exit withdraws the bar before the discs rotate back. One reversible timeline controls both actions. The discs finish rotating at progress 0.58. The bar starts moving at 0.64. This gap preserves clearance when the pointer changes direction during motion.

The bar outline comes from the projected rounded cross-sections at both ends. Its long edges therefore meet the rounded ends exactly. The bar draws in sections between the discs, without artificial end caps at those divisions. Rear slot walls draw behind each bar section. Exterior walls and front faces draw above it. This order hides rear construction lines while preserving the visible thickness of each wheel. Three-unit axle collars keep the wheels separated.

The center disc starts first. The two outer discs follow together. The resting angles are 65, −48, and 110 degrees. Slots measure 13 units across. The bar measures eight units across and six units high, and travels 75 units. Its height stays fixed throughout the animation.

The intensity slider controls the complete sequence duration at 900, 1200, or 1500 milliseconds. The longer duration makes both mechanical phases visible. The kernel supplies its standard ease curve, reduced-motion behavior, and frame-loop sleep. Changing the slider preserves the current pose. The fixed stage is the hover target. One highlighted outline moves from the center disc to the bar.

Keep the refined interlock on its review page until the user approves the additional detail. This example shows a conjunction: every required condition must permit passage. It does not represent threshold signing or an actual wallet authorization decision.

Edit `apps/wallet-console/showcase/motion/interlock/combination-interlock.js`, then rebuild:

```sh
node "$HOME/.codex/skills/hairline-create/build.mjs" \
  apps/wallet-console/showcase/motion/interlock/combination-interlock.js \
  apps/wallet-console/showcase/motion/interlock/index.html
```

Review it at `/dashboard-static/showcase/motion/interlock/`. From `.artifacts/combination-interlock`, run:

```sh
node "$HOME/.codex/skills/hairline-create/look.mjs" \
  ../../apps/wallet-console/showcase/motion/interlock/combination-interlock.js \
  --answer 9,0,68 --edge 43,20,43 --zoom answer
```

Inspect `hairline-interlock-look.png`, `hairline-interlock-motion.png`, and `hairline-interlock-answer.png`. Check the radial markings, slot walls, axle collars, bearing thickness, and connected bar ends. Look closely for rear lines crossing the bar or gaps at its rounded corners. Enter and leave during movement. Confirm the bar retracts before the discs turn. Check both themes, 240px width, and both slider extremes. The automated review passed frame bounds, readouts, console checks, and settling. Browser interaction also confirmed return to rest and repeated interruptions.

## Visual verification

Run the skill's browser review after each figure change. From `.artifacts/audit-log`, run:

```sh
node "$HOME/.codex/skills/hairline-create/look.mjs" \
  ../../apps/wallet-console/showcase/motion/audit-log.js \
  --answer 245,170 --edge 310,160 --zoom answer
```

Inspect the contact sheet, the 240px views, and the motion sequence. Confirm all of these conditions:

- The folded paper and printed rows remain recognizable at 240px.
- Rest and expanded poses remain centered and inside the frame.
- Near sheets hide farther sheets throughout movement.
- Only the selected record has the highlighted outline.
- Pointer movement settles without flicker or repeated animation.
- The readout identifies the exposed record under the pointer.
- Both themes preserve the geometry and visual hierarchy.
- Slider extremes remain inside the frame.
- The browser console contains no errors or warnings.

The review script saves repeatable visual artifacts. Its automatic checks cover bounds, readout, console errors, and settling. Human visual review still determines whether the illustration feels right.

Before production integration, check keyboard access, reduced motion, and physical touch behavior in the host component. Keep essential explanations in adjacent HTML. Decorative motion must never determine wallet authentication, signing, or transaction state.
