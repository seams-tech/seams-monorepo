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

Three coaxial disks sit between bearings on a visible center axle. Each four-unit disk has a solid face, a raised shaft collar, and a narrow radial slot. Faint rim ticks match the front dial, with a longer mark every thirty degrees. The inset rim line and ticks stop at the slots. The slots are six units wide and 12.2 units deep. The front dial drives the nearest disk. Cylindrical pickup pins on opposing faces make contact before the next disk turns. Each pin has a small round base collar. One faint inset ellipse suggests the bevel on each visible end cap.

The sequence follows the [Woodgears combination-lock reference](https://woodgears.ca/combolock/). The front disk first picks up the middle disk, which then picks up the rear disk. All three turn until the rear slot aligns. The dial reverses to pick up and align the middle disk while the rear disk stays parked. A final forward turn aligns only the front disk. The shared locking pin then enters all three slots, and the readout shows “unlocked”.

The pickup pins sit at radius 26.75. Their body radius is 26.75 times the sine of six degrees, preserving twelve degrees of separation at contact. Their axial ends overlap in the gaps between disks. Each disk stays stationary until its pin contacts a driven neighbor. The dial stays coupled to the front disk throughout the sequence. The 8.6-unit center axle remains visible between disks and bearings.

Two rounded arms carry a two-unit cylindrical locking pin. The arms pivot around a second shaft behind the disks, lowering the pin from height 79 to 65.5. Each arm has a nine-unit socket around the 8.6-unit pivot shaft. The shaft draws in sections through both sockets and between the arms. A faint socket rim marks each cross-pin attachment on the arm. The cross-pin seats inside the deep slots once all three align. It clears the slot floors and sidewalls throughout descent.

The Hairline tween supplies the animation clock. The figure removes its global ease-out curve before applying the existing easing within each phase. Forward and reverse playback therefore give each phase equal time. Hover and keyboard changes preserve the current sequence position. Interrupted transitions scale their duration to the remaining distance. Leaving raises the locking pin before the disks move. Enter and Space toggle the animation. The slider sets the sequence to 3400, 4400, or 5600 milliseconds. Reduced motion lands directly at the endpoint, and settled parts stop rewriting their paths.

The pointer transfers the dark outline between disks and the dial. Selection uses fixed silhouettes and checks the nearest object first. The dial is the resting accent. The figure keeps the unchanged Hairline kernel, bench, camera projection, and stroke palette.

The center axle and cross-pin draw in sections at the rear and front planes of each disk. Open spans draw behind the entire disk. Sections inside slots and bores draw behind the outer sidewalls and front face, with the inner surfaces behind them. The rod sections have no artificial end caps or seams. This lets the pin sit inside each slot and keeps the axle behind the disk rims.

Edit `apps/wallet-console/showcase/motion/interlock/combination-interlock.js`, then rebuild:

```sh
node "$HOME/.codex/skills/hairline-create/build.mjs" \
  apps/wallet-console/showcase/motion/interlock/combination-interlock.js \
  apps/wallet-console/showcase/motion/interlock/index.html
```

Review at `/dashboard-static/showcase/motion/interlock/`. Run `node tests/e2e/wallet-scoped-permissions.e2e.mjs` for the browser review. It checks both pickups, pin clearance, reverse dialing, slot alignment, the shared pin, interrupted resets, pointer selection, keyboard input, and reduced motion. It also checks rewind speed, frame steps during repeated hover reversals, both themes, frame bounds, axle visibility, rod occlusion, and open pivot sockets. It saves forward and rewind screenshots, a contact sheet, and `review.json` under `.artifacts/combination-interlock/ring-dial/`.

The standalone Hairline checker still rejects this extended figure’s line count. The browser review checks the rendered mechanism directly.

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

## Infrastructure array: glass doors and sliding servers

Preview: `/dashboard-static/showcase/motion/infrastructure-array/`.

Three adjoining racks hold six server modules each. The larger camera scale keeps the doors and server details readable in the small frontpage card. Each cabinet is 40 world units wide, with a framed glass door, three hinges on its far edge, and a handle on the opposite edge. Mounting posts, rails, recessed handles, ventilation slots, and status dots detail the servers. All modules remain inside their cabinets at rest. The mirrored 45-degree camera uses the same 2:1 isometric projection as the interlock.

Hovering a cabinet opens its door through 90 degrees with a 340 ms tween. Once the door clears, nearby modules extend up to 22 world units with 180 ms tweens. A Gaussian falloff distributes the extension vertically around the pointer. The slider sets its radius to 18, 30, or 44 world units. Only the selected rack extends. Switching racks retracts the previous rack's modules before the next rack extends. Leaving retracts the modules before the door closes. The nearest closed door accents only its outer perimeter. The accent stays on the opening door, then transfers to the nearest server. Leaving clears the server accent during retraction and accents the closing door. A two-unit boundary margin prevents pointer jitter from switching racks.

Pointer selection projects onto the fixed rack face. Moving doors and server fronts never change the hit areas. The door moves behind the server units in draw order after it passes its edge-on pose. Rack groups draw from far to near, and server groups draw from bottom to top. Near walls, mounting posts, and top panels mask the chassis inside each cabinet. Each server's geometry stays fixed; only its group translates. Settled tweens stop updating, and reduced motion lands at the target immediately.

The glass uses a translucent pane and faint reflection strokes. These details and the coordinated door sequence extend Hairline's palette and 200-line conventions. Edit `apps/wallet-console/showcase/motion/infrastructure-array/infrastructure-array.js`, then generate that directory's `index.html` with Hairline's `build.mjs`.

Run `node .artifacts/infrastructure-array/check-doors.mjs` to check all three racks, door clearance, exclusive extension, pointer height, rapid switches, reduced motion, themes, and compact bounds. The script saves screenshots and `doors-check.json` in the same artifact directory. The original single-rack preview remains available separately.

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

The two key shares and transaction sit on rounded tiles above fixed docking bases. Their raised, bevelled construction follows the [Hairline Hub reference](https://hairline.lucasmarkes.com/figures#connectivity). Both keys retain their solid heads, shallow blade cuts, ring openings, and fine engraving. The source tiles rise eight units as the sequence begins. The result tile rises six units as the authorized signal arrives. Wires remain attached to the fixed bases, so lifting a tile never separates a wire from its port.

Three policy cards replace the shield, following the layered construction of [Hairline Stack](https://hairline.lucasmarkes.com/figures#coding). The cards separate vertically before approval. Each carries two faint document lines and a small checkmark drawn with a single line. The checks use the card's x/y plane and the same camera projection. Their compact shape sits inward from the front edge, and all three remain visible beneath the cards above. Approval traces the three marks in order.

One reversible 2800ms sequence coordinates the drawing. The key tiles rise first. Incoming signals travel from 14% to 42% of the sequence, while the policy stack opens from 26% to 42%. Both shares must arrive before the policy checks start. The three checks run from 42% to 68%, the outgoing signal from 68% to 84%, and the signature finishes the sequence. The intensity slider controls the separation between share arrivals. The first share waits visibly for the second. Only the active approval receives the strong stroke, then the signature becomes the final accent.

The figure removes the kernel tween's global ease-out curve and applies easing within each stage. Forward and reverse playback use equal phase durations. Hover interruptions preserve the current position and scale the remaining duration to the remaining distance. Enter and Space toggle the sequence. Reduced motion lands directly at the endpoint. The shared loop sleeps after completion and while offscreen.

Every solid uses `Cam(45, 0.5, 1.45)`. The two sources share x=0, at y=-50 and y=50. Policies sit at x=110 and the transaction at x=220. The desktop frame is 560 by 280. At widths of 480px or less, a 420-by-270 frame removes empty margins, labels increase to ten units, and the transaction caption becomes “Signed”. The compact frontpage embed uses its natural scale to keep the raised source label inside the frame. The standalone compact preview reserves extra room for its header. Labels, checkmarks, and the signature extend the standalone Hairline conventions, while its kernel and bench remain unchanged.

Edit `apps/wallet-console/showcase/motion/threshold-signing/threshold-signing.js`, then rebuild its `index.html` with the Hairline `build.mjs`. Run `node tests/e2e/wallet-policy-stack.e2e.mjs` for the browser review. It checks raised tiles, all three progressive approvals, visible checkmarks, independent share arrivals, signature ordering, interrupted reversal, keyboard controls, reduced motion, both themes, slider extremes, and frame bounds. Screenshots and `review.json` are saved in `.artifacts/threshold-signing/policy-stack/`. The existing custody-pagination check verifies desktop and mobile embedding. The standalone checker flags this extended figure’s labels, inherited stroke overrides, and length.

## Linked devices: scan to pair

Preview: `/dashboard-static/showcase/motion/delegation/`.

Two isometric phones begin beside each other. The first phone has a scanner frame. The second shows its complete pairing QR code from the resting state. On hover or keyboard activation, both phones move equal distances toward their scanning positions. The first moves forward and across while the second moves back and across. Their screens align on the isometric ground plane, and the pair’s center stays fixed.

The scanner’s rear camera faces the second screen. The foreground phone leaves the pairing code visible beside its right edge. Each phone has a taller 42-by-88-unit chassis with eight-unit corner radii. A raised glass face and a fine display inset create a narrow, even bezel. The construction follows the layered detail of the [Hairline phone reference](https://hairline.lucasmarkes.com/figures#devices).

The camera pill includes a small lens aperture, with a separate earpiece slit at the display edge. The visible side rail has a power button, a recessed camera control, and two antenna seams. A wider home indicator sits near the lower edge. These details draw from the [iPhone 18 Pro design](https://www.apple.com/iphone-18-pro/) and retain Hairline’s standard strokes. The screen content stays centered in the taller glass face.

One reversible 1900ms Hairline tween drives four stages. Positioning completes at 400ms with a smooth acceleration and a soft stop. Each phone travels half of the relative approach distance. The scanner preview builds by rows through 700ms, while the receiver keeps its complete 17-by-17 QR pattern visible. Three nested finder squares, clear separators, and connected data blocks keep it recognizable at small sizes. A scan line passes downward through 1350ms, with a matching camera preview on the first phone. The QR rests at 55% opacity and rises to 70% during scanning. Short scanner brackets and a soft gray sweep keep the screens balanced against the phone outlines. The scan content fades out completely before the confirmation marks appear. The circle traces clockwise before the tick draws over 250 ms. The Apple Pay–inspired finish uses a compact check with clear space inside its soft gray ring. The check and circle use the standard Hairline strokes. Both phones keep their scan and confirmation marks gray. The screens contain no text. The marks settle from 96% to full size, then remain still. Ring tracing uses sampled geometry to keep non-scaling strokes continuous at every preview size. All screen geometry uses each phone’s isometric screen plane. The QR pattern is illustrative. It contains no pairing data.

The pointer transfers the dark perimeter between phones throughout the pairing sequence. Fixed selection areas span each phone’s resting and aligned positions, with the foreground phone winning overlaps. Switching phones changes only the highlight. Empty space clears the highlight, and leaving restores the scanner’s resting outline. The selection areas update with the intensity slider. The browser check `.artifacts/device-linking/check-accent.mjs` verifies both highlights, rapid switches, interrupted motion, empty space, and reduced motion, then saves screenshots and `hover-check.json`.

Leaving reverses the same sequence. Re-entering resumes from the current pose. Enter and Space toggle the sequence. Reduced motion lands directly at the linked pose. The intensity slider changes the final depth separation from 40 to 48 world units. Both the code and the success marks remain visible across that range.

Edit `apps/wallet-console/showcase/motion/delegation/device-linking.js`, then rebuild its `index.html`. This requested multi-stage scene extends the standalone skill’s 200-line limit and uses opacity for screen-content transitions. The kernel and bench remain unchanged. The browser check `.artifacts/device-linking/check-scan.mjs` verifies stage order, QR visibility, synchronized success, stable completion, interrupted reversal, keyboard control, reduced motion, both themes, and frame bounds. It saves screenshots for each phase and `scan-check.json` beside the script.

## Wallet frontpage integration

The custody section at `/wallet` uses five figures. The capability grid contains the four abstract figures from "Abstract custody figures": the keychain, the interlock, the linked phones, and the two platforms. The threshold-signing diagram is the fifth. Arrow-and-dot pagination cycles between the capability grid and the threshold-signing diagram. A six-second progress line advances the view when it completes. Hovering or focusing an illustration pauses the timer. The dot pill toggles a persistent pause. Manual navigation resets the progress line. Both views share one grid cell to keep the section height stable. The inactive view is hidden and cannot receive focus. Reduced-motion mode keeps manual navigation and disables automatic cycling.

`src/components/h2/WalletFigure.tsx` imports each generated preview HTML from the Wallet Console showcase. It extracts the unchanged kernel and figure scripts into a sandboxed iframe. The small host in `src/components/h2/hairline/embed.js` replaces the preview controls. Frontpage embeds enlarge the four capability illustrations to 110% with no per-figure shift (122% until 2026-10-22, when the user found them distracting), because each one centres itself on (200, 160). The desktop signing diagram is enlarged to 144%. Taller frames keep the artwork and labels visible. The compact signing view uses its natural scale to fit narrow screens. The capability grid sits 28px higher. Rebuild the relevant showcase HTML after changing a figure; the frontpage consumes that same artifact.

Hover plays each figure forward, and leaving reverses it to rest. The pointer's position inside a figure does not steer it, and a figure never replays by itself: leaving also ends a play that the page started. Enter, Space, or a touch tap toggles the animation. Keyboard focus first returns a figure that the page is playing to rest, so Enter plays it. Figures retain their reduced-motion and offscreen suspension behavior. Essential descriptions remain in the surrounding HTML. These illustrations never control wallet state.

Browser verification covers all five figures, keyboard and touch activation, timed and manual view selection, reduced motion, and desktop/mobile layout. Local artifacts are in `.artifacts/wallet-frontpage/`. The pagination check `node tests/e2e/wallet-custody-pagination.e2e.mjs` saves timer, pause, reduced-motion, and stable mobile-layout evidence under `.artifacts/wallet-custody-pagination/`. The integration check uses a validated public deployment-discovery fixture because the installed local Wallet server schema lacks a table required by deployment discovery. It does not verify wallet operations.

## Abstract custody figures

On 2026-10-22 the user asked to keep the existing figures but make them simpler and more abstract, in the direction of the ElevenLabs safety drawings. The user approved the direction and asked for a polished set that matches in scale and weight. The four abstract figures replaced the detailed ones on the frontpage. The detailed figures stay in the showcase.

Each figure keeps the subject and interaction of the figure it replaced:

- `keys-next/next-keys.js`: three keys on one small ring, on an 8-unit module. Each key is an opaque round head with a hole and a straight blade with two straight cuts set back from the tip; the cut nearer the handle is the longer one. The ring passes through the holes in sections between the keys. Hover opens the fan: every key turns straight to its new place in 700 ms, staggered by 70 ms from the key nearest the pointer, and that key turns half the fan further.
- `interlock-next/next-interlock.js`: three flat slotted disks and a dial on a dashed axle, with keyways out of line at rest. Narrow keyways, rim ticks (4, 8 and 16, finer on nearer disks, and 16 on the dial) and hub rings mark each disk; a dashed target line shows where the blade seats. Hover turns the disks into line. As they turn, a flat blade with no depth traces in dashes, then in a solid line, then drops into the keyways, its top level with the rims and its ends 6 units past the outer disks. The blade sequence takes 1.2 s.
- `devices-edge/edge-devices.js`: two phone planes with 7-unit, phone-like corners, standing at a right angle at rest. One carries four evenly stepped rings that share their lowest point. Hover turns the scanner face to face with the code plane; dashed corner lines grow, then the rings trace on the scanner in dashes and then solid, from the outside in.
- `lockin-boundary/open-boundary.js`: two flat rounded-square platforms on the ground whose openings face each other. A coin with four nested rings stands on the first. Hover traces a dashed path from platform to platform, then the coin rolls across and settles on the second, leaving a dashed echo where it stood.

All four meet one spec, measured with every stroke except the dashed guides:

- The object box centres within 5 units of (200, 160).
- The object box is 42k–50k square units, at most 270 wide and 235 tall.
- Every stroke, guides included, stays inside x 44–356 and y 36–284 at rest and at the full hover pose. The frontpage scale crops outside that area.
- The line ink (`sil`, `lo`, and `hi`) is 1,400–2,000 units. The dashed ink is 250–500 units.
- Silhouettes use `sil`, inner detail uses `lo`, guides use `nf lo dash` and are appended first, and exactly one `hi` marks the rest pose. There are no decorative fills.

The keys, the interlock and the phones also follow the edge language of 2026-10-22: planes and straight lines with small corner radii (the phones excepted, which keep phone-like corners), sizes from one module, a dashed construction layer, and one signature motion — a dashed trace, a solid trace over it, then the move. The keys are the exception to that motion: the user asked for them to turn directly, with no trace. The phones are smaller at rest (32k) than the area range, because their linked pose needs the height. The interlock's line ink is over the range (2,232 at rest, 2,563 seated), because of its ticks and hub rings.

The frontpage plays the keychain along each key's blade, at (282, 205), (194, 183) and (134, 141). The interlock, the phones and the platforms run from one point. Recompute these play paths in `WalletFigure.tsx` after any change to a figure's camera or geometry.

Edit a figure's `.js`, then rebuild its `index.html` with `build.mjs`. The dev-only page `apps/wallet-console/figure-review/` shows each candidate beside the live figure it would replace, each live figure beside the detailed figure it replaced, then the real custody section. Open it at `http://localhost:4001/wallet-static/figure-review/`. The page is not in the build. `WalletFigureCandidates` in `WalletFigure.tsx` swaps the drawing only on that page. Delete the page and `WalletFigureCandidates` when the comparison is no longer needed.
