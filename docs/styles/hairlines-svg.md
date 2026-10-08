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

The keychain uses four house keys with solid rounded heads, small circular ring holes, shallow edge cuts, and recessed blade grooves. Each head has a 27-unit radius. Four cut patterns distinguish the keys. The complete head and blade share one outline, with a 2.2-unit metal thickness. Each handle has a shallow inset edge at radius 24, drawn only along the far half in the light-grey detail stroke. The near half stays hidden. The visible arc follows the camera direction as each key rotates and sits 0.6 units below the face. A blank rounded nameplate sits on the face. A collar rises 0.45 units above the face around the ring hole. All marks follow the key plane and remain behind nearer keys and ring sections.

Hovering a key fans it out around its fixed ring hole. Nearby keys rotate slightly away, with a 35ms delay per key of distance. Pointer exit restores the resting fan. The bright outline follows selection, and the readout names the selected key.

The shared ring is a torus: a circular metal tube with a round cross-section. Its centreline radius is 34 world units, and its tube radius is 2.6. Projected surface contours show its depth. Ring sections sit between the key layers, so each opaque face hides the metal beneath it.

The ring passes through 6.2-unit-radius openings near the back of each head. Each key rotates about that opening, keeping it centred on the ring throughout motion. An even-odd fill rule leaves a real hole through each face.

The intensity slider sets fan rotation to 6, 10, or 14 degrees. Selection uses the resting key angles, so a moving key cannot change its own hover target. The shared 700ms tween handles selection changes and reverses from the current pose.

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

Inspect the tooth contours, ring, and openings at full size. Select each key, switch quickly between keys, and leave the figure. Check that the selected key stays attached and all keys remain inside the frame at maximum fan rotation.

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

Hovering the fixed stage runs a 1800ms deployment sequence. The third server seats on its rails, then its three indicators start in order. Its recessed pull handle stays fixed. Leaving reverses this sequence: the lights switch off, then the server withdraws. One reversible kernel tween preserves the current position when interrupted. The slider changes withdrawal distance from 20 through 26 to 32 world units. Only the selected server group translates; all other geometry stays fixed. Server geometry stops updating after settling. The shared loop continues only for visible activity lights and sleeps offscreen.

The rack draws lower bays before upper bays, then the near side wall and top. Opaque surfaces hide parts inside the cabinet. The selected front panel and handle carry the accent stroke. The small motion affects one of six servers, so the rest of the rack remains visually stable. The five installed servers have steady power lights and two activity lights each. The withdrawn server stays dark until it seats. Its three indicators then start in order before joining normal activity. Activity pulses last 340 milliseconds, with distinct periods and phase offsets across bays. Lamps use the existing monochrome dot palette, with no glow. Only lamp classes change during idle activity. Reduced-motion mode applies the final pose immediately, keeps enabled lights steady, and stops the ambient loop. A shallow top-panel seam and telescoping rails add detail to the withdrawn unit.

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

Inspect the six occupied bays, rail alignment, and cabinet occlusion during insertion. Check both themes, 240px width, slider extremes, and interrupted hover transitions. Verify that the selected lamps start only after insertion. Check the reverse order on exit. Installed power lights stay steady, activity lights blink independently, and reduced-motion mode freezes enabled lamps. The reference camera makes the sliding motion more compact; the single-server movement remains intentional. This preview remains separate from frontpage integration.

## Device linking: two phones in a pairing dock

Two recognizable phones share a slim dock. The first phone is seated. The second rests above its connector. Each screen holds a segmented confirmation ring around two separated link halves. Rounded bezels, an earpiece, a home indicator, shallow docking recesses, and a small status lamp provide restrained detail. The three-quarter camera matches the approved phone mockup.

Hovering the fixed stage lowers the second phone. After it seats, four ring segments trace clockwise on both screens. Two rounded link halves trace into view, then slide together. The last ring segment completes the confirmation, and the dock lamp illuminates. Both screens hold the same linked symbol. Leaving reverses the sequence before the phone rises. A single reversible 2400ms tween preserves this order through interruptions. The slider sets lift to 18, 23, or 28 world units.

Both screens use the same progress value. Screen geometry follows each phone's perspective. Faint outlines remain at rest, and the traced strokes use the standard silhouette class. Paths are sampled once during mounting. Animation reveals those samples and translates the link halves. The front lip hides seated phone bottoms. Reduced motion lands at the selected state, and the loop sleeps when movement ends.

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

## Infrastructure array: a wave across a rack wall

Preview: `/dashboard-static/showcase/motion/infrastructure-array/`.

Five adjoining racks hold six server modules each. Closed side panels, mounting posts, rail sections, recessed handles, ventilation slots, and status dots establish the datacenter setting. The mirrored 45-degree camera uses the same 2:1 isometric projection as the interlock. It shows the rack fronts and their depth. A few modules rest slightly withdrawn to suggest movement before interaction.

Moving across the wall draws nearby modules outward along their rails. A Gaussian falloff spreads the motion across neighboring racks and bays. Each module has an independent default Hairline spring. The maximum withdrawal is 24 world units. The slider sets the wave radius to 18, 30, or 44 world units. Leaving restores the resting arrangement.

Pointer selection projects onto the fixed rack face. Moving fronts never change the hit areas. Rack groups draw from far to near, and server groups draw from bottom to top. Near walls, mounting posts, and top panels mask the chassis inside each cabinet. Each server's geometry stays fixed; only its group translates. Settled springs stop updating, and reduced motion lands at the target immediately.

Edit `apps/wallet-console/showcase/motion/infrastructure-array/infrastructure-array.js`. Build with the Hairline `build.mjs` into that directory's `index.html`. Run `look.mjs` from `.artifacts/infrastructure-array` with `--answer 205,157 --edge 105,131 --edge 295,154 --zoom answer`. Screen coordinates account for the mirrored camera. The original single-rack preview remains available separately.

## Signing assembly: rod keys, iris, and transaction output

Preview: `/dashboard-static/showcase/motion/signing-assembly/`.

Three cylindrical rod keys stand above matching sockets on an indexed disk. Each socket opening combines a circular bore with a square side cutout for the key bit. The outline follows the circle to the notch shoulders, then follows three straight edges around the cutout. Cylinder tops use their actual rim edges, without inset guide rings. Each rod has a narrow recessed collar and a small lateral key bit near the middle of its shaft. The lower shaft radius is 3.5 units, below the upper shaft radius of 4.5 units. The button cap is 4 units tall with a 6.5-unit radius. The socket notch leaves clearance around the bit. An index mark on the grip makes its quarter-turn visible. Two keys insert and lock. The third remains withdrawn.

The base has an inset annular scale bounded by two engraved circles. Long and short index marks rotate with six recessed slotted fasteners. A fine seam follows only the visible half of the base sidewall. All details sit behind the raised mechanisms and use the lighter detail stroke.

Three Hairline tweens control the sequence. Insertion takes 350ms. The keys lock while the disk rotates, sharing one 500ms motion. A 400ms release combines the central cylinder lift, iris opening, and transaction cylinder launch. Six straight blade edges pivot around a rotating hexagonal aperture. The opening grows while the cylinder rises. Ejection starts once the opening clears the transaction cylinder, during the same release stroke. There is no pause between stages. The three stages take approximately 1.25 seconds, followed by the transaction cylinder spring settling into its hover. Hover interruptions resume from the current pose.

The transaction cylinder rises 54 world units above the raised platform, with a spring overshoot. Its spring uses stiffness 100, damping 10, and mass 1. Small vertical, lateral, and rotational oscillations keep it hovering. The signed transaction cylinder has a 16-unit height and diameter, with 1.1-unit bevels along its upper and lower rims. Five engraved text lines cover its circular top and curve around its front wall. Varied line lengths and a gap after the first line suggest a transaction heading and body. The top has an inset circular border. Only the visible front halves of the lower rim edges are drawn. Every structural edge uses the dark accent stroke; engraved text lines use the softer silhouette stroke. The body and every engraving clip at the aperture surface during emergence and retraction. Its maximum footprint radius is 8 units, within the open aperture's 10.22-unit inscribed radius. Only the transaction cylinder continues moving after the mechanism settles. The shared loop sleeps offscreen.

Leaving lowers the central housing and retracts the transaction cylinder together. The exposed transaction cylinder height tapers to zero before the iris closes during the same release stroke. The disk and keys then turn back together before the keys withdraw. Reduced motion lands all stages and disables the hover oscillation. The slider sets key insertion depth to 22, 23, or 24 world units.

The shutter uses one opaque face with a real hexagonal cutout and six shared seams. Its closed leaves meet at the centre. Each straight seam connects an aperture vertex to a fixed rim pivot as the aperture rotates approximately 47 degrees. A raised retaining bezel surrounds the recessed leaves, with six small slotted screws aligned to the pivots. A fixed mounting collar supports the sliding barrel. Four narrow grooves follow the visible cylinder wall and emerge above the collar as it rises. The bezel covers the outer leaf edges, and the barrel hides the collar beneath it. No lower ellipse shows through the leaves. Inserted rod sections stop at the socket entrance. The transaction remains hidden until the iris opens. Its exposed geometry starts at the platform surface. Object groups reorder by depth during rotation. The transaction cylinder is the accent.

Edit `apps/wallet-console/showcase/motion/signing-assembly/signing-assembly.js`, then run the Hairline `build.mjs` into that directory's `index.html`. This extended figure uses the unchanged Hairline runtime but exceeds the standalone skill's 200-line figure limit. Review it in the browser with both themes, a 240px preview, both slider extremes, rapid hover reversals, and reduced motion. The repeatable local check is `.artifacts/signing-assembly/check-iris.mjs`; its screenshots and JSON report record the stage order, output visibility, hover, interrupted reverse, and reduced motion.

## Threshold signing: two shares, policy check, signature

Preview: `/dashboard-static/showcase/motion/threshold-signing/`.

This fifth illustration follows the approved two-source diagram. Two keys lie on separate thin rectangular slabs, labelled “USER’S DEVICE” and “YOUR INFRASTRUCTURE”. Each house key has a solid rounded head with a small ring hole and a straight blade with four shallow cuts. The head and blade share one continuous outline and a two-unit thickness. A narrow lengthwise groove follows the blade. A shallow embossed border follows each handle, and a raised collar surrounds its ring hole. Both details have opaque upper faces and visible front edges. Visible sidewalls follow the concave tooth profile, and the opening shows the inner edge of the hole. Both paths meet a simple shield. A transaction plate receives the outgoing signal and an engraved signature.

Every solid uses the same `Cam(45, 0.5, 1.45)` projection. The keys rest directly on the 2.6-unit slab surfaces. Each slab has a rounded perimeter and two short engraved lines near its front corner. The shield lies flat in the x/y plane, with a two-unit side edge and a check engraved on its top. The transaction plate follows the same ground axes as the slabs. Wires follow x/y segments at one shared height, with tangent curves around each bend. Signal positions use the distance along those curves, so the dots follow the rounded wires without speed changes caused by sample spacing. The head and shaft meet without a seam or overlapping disk. The source centres share a screen x-coordinate, and the policy and transaction captions share a baseline. Labels remain horizontal for reading. The device connector draws in front of its slab and joins the front port. The infrastructure connector stays behind its slab. Both connectors pass behind the shield, so hidden segments stay covered.

Hover or Enter starts one continuous 1800ms tween. Incoming signals use the first 38% of the duration, the policy check continues to 50%, the outgoing signal continues to 72%, and the signature completes the sequence. These boundaries use the same easing as the shared tween. Each stage hands motion directly to the next, without starting another clock. The intensity slider varies the separation between incoming arrivals. The check waits for both arrivals. The signature waits for the outgoing signal. Keys remain stationary throughout. Leaving reverses the sequence; returning resumes from the current pose. Enter and Space toggle the animation from keyboard focus. Reduced motion lands at the final pose, and the shared loop sleeps once settled or offscreen.

Stroke tracing reveals sampled geometry instead of using dash offsets. This avoids gaps when non-scaling strokes render at different preview sizes. The labels, shield/check symbol, and signature are explicit parts of the approved mock. This diagram therefore extends the standalone Hairline no-label convention and 200-line limit, while keeping its kernel and bench unchanged.

Edit `apps/wallet-console/showcase/motion/threshold-signing/threshold-signing.js`, then rebuild its `index.html` with the Hairline `build.mjs`. Run `.artifacts/threshold-signing/check.mjs` for a repeatable browser check. It records independent arrivals, stage ordering, partial signature strokes, interrupted reversal, keyboard control, reduced motion, alignment, both themes, slider extremes, and frame bounds. Screenshots and `check.json` are saved beside the check script.

## Linked devices: screen symbols

Preview: `/dashboard-static/showcase/motion/delegation/`.

Each screen contains two open oval links with a 1.6-unit band and a diagonal composition. Their ends draw closed around each other after the second phone docks. The centres remain fixed, so closed loops never slide through each other. The upper and lower portions of the left link draw on opposite sides of the right link. This gives each crossing one clear front edge without clipping or duplicate outlines. The joins between portions have no visible seam.

One reversible 1800ms Hairline tween drives the sequence. Docking uses the first 38% of its duration. Both screen symbols then close together and hold still. The boundary uses the tween’s easing curve. Reduced motion lands directly at the closed pose.

Edit `apps/wallet-console/showcase/motion/delegation/device-linking.js`, then rebuild its `index.html`. The stock Hairline validator and visual review pass. The local browser check `.artifacts/device-linking/check-redraw.mjs` verifies synchronized closure, docking before closure, finite intermediate geometry, stable completion, interrupted reversal, reduced motion, both themes, and frame bounds. It saves close-ups at five stages of closure, full-stage screenshots, and `redraw-check.json` beside the script.

## Wallet frontpage integration

The custody section at `/wallet` uses five approved figures. The capability grid contains the keychain, combination interlock, linked phones, and server-rack wall. The linked phones and rack wall use the interlock’s 45-degree, 2:1 isometric perspective. The manual “How signing works” switch shows the threshold-signing diagram. The section does not advance on a timer.

`src/components/h2/WalletFigure.tsx` imports each generated preview HTML from the Wallet Console showcase. It extracts the unchanged kernel and figure scripts into a sandboxed iframe. The small host in `src/components/h2/hairline/embed.js` replaces the preview controls. Rebuild the relevant showcase HTML after changing a figure; the frontpage consumes that same artifact.

Hover explores each figure. Enter, Space, or a touch tap toggles its animation. A second activation resets it. Figures retain their reduced-motion and offscreen suspension behavior. Essential descriptions remain in the surrounding HTML. These illustrations never control wallet state.

Browser verification covers all five figures, keyboard and touch activation, manual view selection, reduced motion, and desktop/mobile layout. Local artifacts are in `.artifacts/wallet-frontpage/`. The integration check uses a validated public deployment-discovery fixture because the installed local Wallet server schema lacks a table required by deployment discovery. It does not verify wallet operations.
