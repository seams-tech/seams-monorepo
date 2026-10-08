# Hairline SVG direction

Use one detailed, interactive illustration at a time. Start from an existing wallet image and preserve its meaning.

The first example develops the wallet security section's **Audit log** image into four layered paper records. The folded corner, binding holes, ruled entries, and thin paper edges identify the object without words inside the drawing.

The second example develops **Scoped credentials** into four cut metal keys on a shared ring. The user approved this animation on 2026-10-07. Preserve its geometry and interaction as the reference for the remaining examples. Each example has its own review page.

## Replacement status

The security section contains four custody illustrations and one threshold-signing illustration. Review each replacement separately before frontpage integration.

| Existing asset     | Replacement status                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------- |
| Scoped credentials | Keychain approved.                                                                          |
| Audit log          | Replaced as a selling point by Self-hostable. Server-cartridge mockup available for review. |
| Policy engine      | Interlock and three-layer sieve animations approved.                                        |
| Split-key custody  | Not started.                                                                                |
| Threshold signing  | Not started.                                                                                |

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

The graded sieve replaces the rejected single-plate shape sorter. Three circular screens sit on four slender support rods above a collection plate. Dense perforations, machined rims, hexagonal fasteners, and thin screen material give it the form of a laboratory screening assembly.

The particles are thin, unbranded metal tokens. Each token has a beveled rim. The three larger sizes also have one faint inset ring. Small starting tilts settle level before the tokens reach the upper screen.

The screens have progressively smaller round openings. Their aperture radii are 9, 4.6, and 2.4 world units. The token radii are 10.5, 7, 3.8, and 2 units. The largest pair has one unit of clearance between their rims. Thickness is 0.3 times the radius. The upper 30% of the thickness tapers to 90% of the full radius.

Twelve tokens form four groups: two large tokens stop at the upper screen, three medium tokens stop at the middle screen, two small tokens stop at the lower screen, and five smallest tokens reach the collector. The smallest token positions sit toward the front so their final positions remain visible.

Hovering lowers each token continuously to its final layer. Tokens pass through intermediate screens without pausing or tracing. A token stops when its size exceeds the next opening. The smallest tokens stop on the collector. The frame stays rigid.

Once a token reaches its terminal position, a dark stroke traces its actual outer contour once. The completed outline holds briefly, then clears. Tokens trace independently, including those on the collector. Pointer exit removes the traces and reverses the same path from its current position.

The 3500ms tween gives the fall and terminal trace time to read. Deeper destinations have later arrival points within that tween. The intensity slider controls the outward stagger at 30, 60, or 90 milliseconds per grid step. The stationary stage is the hover target. The kernel supplies its standard easing, reduced motion, and offscreen sleep. Token geometry updates only when its height changes. A separate outline path reveals successive contour points after landing. It updates only when the visible point count changes. Reduced motion goes directly to the sorted pose without tracing.

Each screen combines a five-unit structural rim with a 0.8-unit perforated sheet. The visible bore is the intersection of the projected upper and lower openings. Each token draws in separate vertical bands between screens. This keeps the opaque plates in front of the material beneath them. The rods and their fasteners also follow the back-to-front order.

The user approved the sieve assembly and selected machined tokens to replace its fragments. The sieve remains a review alternative alongside the selected interlock. Its metaphor is successive filtering: each layer applies a tighter condition. Review this direction before frontpage integration.

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

Inspect the contact sheet, motion sheet, and enlarged answer. Follow a small token through all three screens without intermediate pauses or traces. Capture intermediate frames to check that each outline starts only after its token lands, including the collector. Check that larger tokens stay on their correct screen. Enter and leave during motion to check reversal. Inspect the rod connections, aperture walls, both themes, and both slider extremes.

The fixed frame and dense perforations dominate the 240px view. The automated changed-ink metric therefore reports a small response. This is deliberate: the tokens carry the motion while the machine stays fixed. Inspect the smallest tokens at full size when judging the filtering sequence.

## Combination interlock

The user selected the combination interlock for **Policy engine** on 2026-10-07 and requested more mechanical detail. Three independently rotated discs share an axle. Each disc has a radial slot. All three slots must align before a rigid bar can pass through the assembly. Each disc represents a required policy condition.

The wheels use the original circular grooves and radial tick marks requested in the reference screenshot. Raised axle collars, rounded bearing supports, a slotted retaining cap, and four mounting holes give the assembly depth. Rounded slot corners leave clearance around the bar.

Hovering the figure aligns the discs, then advances the bar. Pointer exit withdraws the bar before the discs rotate back. One reversible timeline controls both actions. The discs finish rotating at progress 0.58. The bar starts moving at 0.64. This gap preserves clearance when the pointer changes direction during motion.

The bar outline comes from the projected rounded cross-sections at both ends. Its long edges therefore meet the rounded ends exactly. A faint longitudinal crease separates the top and side faces, and meets the rounded end profile. The bar draws in sections between the discs, without artificial end caps at those divisions. Rear slot walls draw behind each bar section. Exterior walls and front faces draw above it. This order hides rear construction lines while preserving the visible thickness of each wheel. Three-unit axle collars keep the wheels separated.

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

## Self-hostable example

The fourth example replaces Audit log as a frontpage selling point. The approved copy is:

> **Your infrastructure. Your control.**
> Run threshold signing on your own serverless infrastructure.

A compact datacenter rack holds six closely stacked, closed server units. The third server from the top rests partly withdrawn. Simple pull handles, three indicator outlines, three ventilation slots, and mounting posts supply the detail. The short cabinet has a solid side panel, top, base, and small feet. The supplied reference sets the camera: a mirrored 60-degree azimuth and 0.28 elevation factor show the wider front and the side panel on the right. This intentionally replaces the default isometric view to match that reference. Thirteen-unit server faces sit on a fourteen-unit pitch, leaving narrow gaps. Recessed handles and small mounting fasteners add restrained detail.

Hovering the fixed stage runs a 2400ms deployment sequence. The third server seats on its rails, its hinged pull handle folds flush, then its three indicators start in order. Leaving reverses this sequence: the lights switch off, the handle opens, and the server withdraws. One reversible kernel tween preserves the current position when interrupted. The slider changes withdrawal distance from 20 through 26 to 32 world units. Only the selected server group translates; all other geometry stays fixed. Server geometry stops updating after settling. The shared loop continues only for visible activity lights and sleeps offscreen.

The rack draws lower bays before upper bays, then the near side wall and top. Opaque surfaces hide parts inside the cabinet. The selected front panel and handle carry the accent stroke. The small motion affects one of six servers, so the rest of the rack remains visually stable. The five installed servers have steady power lights and two activity lights each. The withdrawn server stays dark until its handle closes. Its three indicators then start in order before joining normal activity. Activity pulses last 340 milliseconds, with distinct periods and phase offsets across bays. Lamps use the existing monochrome dot palette, with no glow. Only lamp classes change during idle activity. Reduced-motion mode applies the final pose immediately, keeps enabled lights steady, and stops the ambient loop. A shallow top-panel seam and telescoping rails add detail to the withdrawn unit. The handle has thickness and an open center.

Edit `apps/wallet-console/showcase/motion/self-hostable/server-rack.js`, then rebuild:

```sh
node "$HOME/.codex/skills/hairline-create/build.mjs" \
  apps/wallet-console/showcase/motion/self-hostable/server-rack.js \
  apps/wallet-console/showcase/motion/self-hostable/index.html
```

Review at `/dashboard-static/showcase/motion/self-hostable/`. From `.artifacts/self-hostable`, run:

```sh
node "$HOME/.codex/skills/hairline-create/look.mjs" \
  ../../apps/wallet-console/showcase/motion/self-hostable/server-rack.js \
  --answer 42,0,56 --edge 42,30,56 --zoom rest
```

Inspect the six occupied bays, rail alignment, and cabinet occlusion during insertion. Check both themes, 240px width, slider extremes, and interrupted hover transitions. Verify that the handle closes only after insertion, and the selected lamps start only after the handle closes. Check the reverse order on exit. Installed power lights stay steady, activity lights blink independently, and reduced-motion mode freezes enabled lamps. The reference camera makes the sliding motion more compact; the single-server movement remains intentional. This preview remains separate from frontpage integration.

## Device linking: two phones in a pairing dock

Two recognizable phones share a slim dock. The first phone is seated with a circular screen motif. The second rests above its connector. Rounded bezels, an earpiece, a home indicator, shallow docking recesses, and a small status lamp provide restrained detail. The three-quarter camera matches the approved phone mockup.

Hovering the fixed stage lowers the second phone. After it seats, a short pause precedes a miniature of phone 1 drawn on its screen. The dock indicator then illuminates. Leaving reverses the sequence: the miniature clears before the phone rises. A single reversible 1300ms tween preserves this order through interruptions. The longer duration separates docking from confirmation. The slider sets lift to 18, 23, or 28 world units.

The miniature is an explicit user-requested screen confirmation. Its outline traces first, followed by its bezel, earpiece, home indicator, and matching circular screen motif. It rises three world units as it appears. Its paths grow geometrically in the shared animation loop. The first phone and base remain static; only the second phone's group, miniature path, and dock lamp update. The front lip hides seated phone bottoms. Reduced motion lands at the selected state, and the loop sleeps when movement ends.

Edit `apps/wallet-console/showcase/motion/delegation/device-linking.js`, then rebuild:

```sh
node "$HOME/.codex/skills/hairline-create/build.mjs" \
  apps/wallet-console/showcase/motion/delegation/device-linking.js \
  apps/wallet-console/showcase/motion/delegation/index.html
```

Review at `/dashboard-static/showcase/motion/delegation/`. From `.artifacts/device-linking`, run:

```sh
node "$HOME/.codex/skills/hairline-create/look.mjs" \
  ../../apps/wallet-console/showcase/motion/delegation/device-linking.js \
  --answer 3,28,45 --edge 3,-28,45 --zoom answer
```

Check that the confirmation never appears while the second phone is raised. Verify both themes, thumbnail size, slider extremes, rapid enter/leave/re-enter gestures, and reduced motion. The illustration remains a separate preview pending frontpage integration.

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
