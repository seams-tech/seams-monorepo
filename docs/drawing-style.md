# Ink drawing style

The Seams site uses hand-painted ink drawings: a baby goat, sparrows, wheat, bread
and bakery robots. A small brush engine paints each drawing on canvas in the
browser, and CSS then moves its parts. This document records how the drawings
look and how they move. Read it before you add, change or review a drawing.

The `ink-drawing` agent skill turns these rules into a step-by-step procedure.
This file is the source of truth: when a rule changes, change it here first.

## Where the drawings live

All paths are in `apps/seams-site/src/`.

| Path                                     | What it holds                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| `components/h2/ink/brush.ts`             | The bristle brush: `InkStroke`, `prepareStroke` and the colors                   |
| `components/h2/ink/InkScene.tsx`         | `InkDrawing`: one canvas for each part, the draw-in timeline and the CSS motions |
| `components/h2/ink/scenes.ts`            | The shared helpers and most scenes: the hero goat, the banners and the cobot     |
| `components/h2/ink/wheatFieldScene.ts`   | The integrations wheat field, which times its own stalks                         |
| `components/h2/ink/bakeryRobotScenes.ts` | The oven arm and the rack runner                                                 |
| `components/h2/ink/conceptScenes.ts`     | Spare drawings that no page uses yet                                             |
| `components/h2/ink/suiteIconScenes.ts`   | The home hero's Satyr app tiles: torn ink squares with each sign cut out         |
| `components/h2/EcosystemField.tsx`       | The SVG layer of tool logos and gold grains over the wheat field                 |
| `styles/h2-ink.css`                      | The motion keyframes, the resting state and reduced motion                       |

| Page                      | Drawings                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Home (`pages/home2`)      | Hero `goatScene` and the suite tiles (drawn on load), `wireScene`, the wheat field, `stalkScene`, `keyScene`, `carryScene` |
| Satyr (`pages/ecommerce`) | `windScene`, `rackRunnerScene`, `cobotScene`, `ovenArmScene`, `pillowGoatScene`                                            |
| Company                   | `parcelSparrowScene`, `cupSparrowScene`                                                                                    |
| Not found                 | `flourGoatScene`                                                                                                           |

## Aesthetics

### The hand

- Paint with fat brush masses. A body, a loaf, an oven or a robot arm is one
  thick stroke with torn edges, not an outline.
- Cut shapes out of a mass with `clear` strokes: the white of an eye, the scores
  on a loaf, the seam on a robot arm, the mouth of an oven.
- Use thin dry lines only to tie things on: a cable, a whisker, a leg, a string.
- Let the brush show. Dry tails, torn edges and small grain holes are the style.
  Do not clean them up.
- Each page load paints different marks, because the brush noise takes a random
  seed. A drawing must look right on every load, not on one capture.

### Color

| Color    | Value     | Use                                                                              |
| -------- | --------- | -------------------------------------------------------------------------------- |
| `ink`    | `#0c0b0a` | Almost everything                                                                |
| `gold`   | `#d98f24` | The one warm accent: bread, croissants, a bell, a band on a machine base, a glow |
| `clear`  | erases    | Cut-outs inside a mass of the same part                                          |
| `paper`  | `#f9f7f2` | A pale mark painted over ink, such as a highlight on a wing                      |
| `accent` | `#e4572e` | Almost never. One mark in the whole site uses it                                 |

Keep gold to a few marks in each drawing. Gold is what the eye finds first.

### Subjects

- Draw the bakery and café world: the baby goat, sparrows, wheat, croissants,
  loaves, brioches, cups, steam, flour sacks, order slips and bakery robots.
- The baby goat is the main character. Reuse its parts from `goatScene` (the
  parts with ids that start with `kid-`) and scale them. Do not draw a new goat.
  For a goat that walks with something in its mouth, reuse the walking kid of
  `whiskGoatScene` (parts `far-legs`, `tail`, `kid` and `ear`); its mouth is at
  `kidAt(250, 408)`. Mirror its x values to turn it around.
- Sparrows give life to a still object: one perches on a wire, an oven or a rack,
  or rides on a robot arm.
- Robots are dark machine masses with `machineJoint` joints and a gold band. Keep
  a robot arm short and close to its work.
- Keep the drawings abstract and warm. Do not draw a dashboard, a product screen,
  a diagram, a grid or an isometric scene.

### Composition

- A banner uses the 620 by 196 grid. The text sits on the left of the banner, so
  put the subject in the middle or on the right, on a dry ground line near y 184.
- The hero uses the 760 by 520 grid. The wheat field uses 1400 by 520 on a wide
  screen and 620 by 560 on a narrow screen.
- Leave air around the subject. A banner holds one small story, not a scene full
  of objects.
- Keep the steam and the birds inside the grid, so that no mark is cut off.

### What the owner rejected

These directions were tried and refused. Do not propose them again.

- Thin line-art outlines, rounded polygon outlines, and paper halos around shapes.
- Kites of any form, and pastry shapes on strings.
- Gold dots that move along strings or wires.
- Dashboard pictures, logo grids and isometric platforms for integrations.
- Curves that are too perfect, such as a regular curl in a string.
- A hero that paints itself in. The hero loads already drawn and moving.
- Robot faces with ringed eyes, pupils or a mouth. Give a robot plain dot eyes.
- Plain egg or capsule robot bodies. A one-piece robot body needs a clear
  character: pointed ears, a pale face window and a wide seat on stumpy feet.

## The brush

A stroke is a spline of points `[x, y, width]` in scene units. Each bristle walks
the spline on its own and skips where it runs dry or where the wall grain stops it.

| Field      | Range     | Effect and typical values                                                                                                     |
| ---------- | --------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `color`    | see above | `ink` when not set                                                                                                            |
| `dry`      | 0 to 1    | Ink that runs out toward the end of the stroke. Bodies 0 to 0.15; stems 0.08 to 0.5; whiskers and dust 0.6 to 0.8             |
| `rough`    | 0 to 1    | How much the edges tear. Large flat masses 0.06 to 0.25; bodies 0.35 to 0.6; ears and whiskers 0.85 to 1                      |
| `grain`    | 0 to 0.4  | Holes from the wall. Usually 0.02 to 0.05; 0 for `clear` strokes                                                              |
| `pace`     | above 0   | Brush speed for this stroke. Above 1 is faster                                                                                |
| `flat`     | boolean   | Square ends, for a box, a bar or a machine base                                                                               |
| `keepLine` | boolean   | Keeps the middle bristle down, so a thin part of the stroke cannot vanish. Set it on a stem or a string that must stay joined |

Rules that the brush needs:

- A brush is wide across its travel. A short wide stroke makes a bar, and a round
  shape needs `blob` or `roundBlob`.
- On a large flat mass, the edge tear grows with the width. Keep `rough` low,
  and paint a tall box downward, so its top and foot come out straight.
- A thin tapered stroke can lose all its bristles and leave a hole. Dry ink is
  not the cause. Set `keepLine: true` on it.

### Building blocks

Reuse these helpers from `scenes.ts` before you write new strokes.

| Helper                                               | Draws                                                 |
| ---------------------------------------------------- | ----------------------------------------------------- |
| `blob(x, y, rx, ry, color)`                          | A small round mass, such as a head, an eye or a crumb |
| `roundBlob(x, y, rx, ry)`                            | A large even circle or ellipse                        |
| `croissant(cx, cy, radius)`                          | A gold crescent with its layers cut out               |
| `loaf(x, y, length, width)`                          | A gold loaf with three scores                         |
| `wheat(id, base, bend, tip, seed, size)`             | A stem part and an ear part that sways                |
| `sparrowPart(id, x, y, k, facing, seconds, carrier)` | A standing sparrow that shifts its weight             |
| `flying(id, x, y, k, facing, seconds)`               | A sparrow in flight, with a wing that beats           |
| `steamCurl(id, x, y, k, delay)`                      | A dry curl of steam that rises and fades              |
| `fallingSpeck(id, x, y, r, delay)`                   | A speck of flour that falls                           |
| `machineJoint(x, y, r)`                              | A robot joint: a dark ball, a pale ring and a pin     |
| `ARM_LINE`, `SOLID_LINE`                             | The stroke settings for robot arms and machine lines  |

## Motion

Each part of a scene has its own canvas. After the paint, CSS moves the canvases,
so a finished drawing costs no script.

| Kind      | Moves                                   | Typical amount                                                       |
| --------- | --------------------------------------- | -------------------------------------------------------------------- |
| `sway`    | Rotates about `origin`                  | 0.3 to 4 degrees; up to 14 degrees for a pecking head or a fast tail |
| `bob`     | Moves up and down                       | 0.8 to 2.5 px                                                        |
| `drift`   | Moves sideways and a little up and down | 4 to 26 px                                                           |
| `flap`    | Scales a wing on y                      | 0.4 to 0.45                                                          |
| `breathe` | Scales a body on y, for a sleeping goat | 1.03                                                                 |
| `rise`    | Rises and fades, for steam              | 10 to 14 px                                                          |
| `fall`    | Falls and fades, for flour              | 20 px                                                                |

- Each motion has `amount`, `seconds`, an optional `delay` and an optional
  `origin` in scene units.
- Motions nest. The first motion in the list is the outermost. A part that rides
  on another part lists the carrier's motions first, then its own: the rider on
  the cobot arm uses `[AT_SHOULDER, AT_ELBOW]` and then its own sway.
- Give parts periods that do not divide evenly, such as 2.3 s and 3.7 s, so the
  drawing never visibly repeats.
- Keep motion small and calm. A drawing breathes; it does not perform.
- A drawing that is out of view stops its motions (`is-resting`).

## The draw-in animation

A drawing paints itself in when 25% of it comes into view. Every drawing must be
complete in about 1.5 seconds.

1. Each part starts after the part before it, in the order of `scene.parts`.
   Inside a part, each stroke starts when 55% of the stroke before it is drawn.
   The strokes of a part with `together: true` start 0.018 s apart.
2. The brush draws 700 scene units each second. A stroke takes 0.08 s at least
   and 0.93 s at most.
3. `InkScene.tsx` then makes a few parts draw at once. The part starts keep their
   order but move into the first 0.8 s, so each part starts a moment after the
   one before. Each part then draws as slowly as it can, up to 1.7 times slower,
   and every part ends by 1.5 s.

Other rules:

- A part with `at` starts at that second. A scene that sets `at` on any part keeps
  its own timeline and skips step 3. The wheat field uses this: its stalks grow in
  one wave from left to right, and each logo appears as its own ear is drawn.
- `pause` adds a short wait before a part, such as a sparrow that lands last.
- Do not speed strokes up to fit the time. Overlap the parts instead. Fast
  strokes look like a flash.
- The hero uses `drawn`: it is painted before the first frame and moves at once.
- With reduced motion, every drawing appears complete and still, and the overlay
  logos show at once.
- An overlay element, such as a logo or a gold grain, appears with the part that
  holds it. Time it from that part, not from a fixed list.

## Make a new drawing

1. Read `croissant`, `perched`, `cobotScene` and the goat parts in `scenes.ts`.
2. Put a new scene in its own file or next to related scenes. Reuse the helpers.
3. Make a temporary concept page (`apps/seams-site/<name>.html` and `.tsx`) that
   shows the new drawing with `drawn` beside two drawings already on the site.
   Do not commit the page.
4. Capture the page with headless Playwright at 2x. The built-in browser pane
   slows animation frames when it is hidden, so do not judge motion there.
5. Compare the new drawing with the goat and the cobot: mass, stroke weight,
   torn edges, gold. Fix it before you show it.
6. Put the scene on its page and check it:
   - Desktop 1440 px and phone 375 px: every canvas painted, nothing cut off, no
     horizontal scroll, no console errors.
   - Reduced motion: the drawing is complete and still.
   - Draw-in: sample the canvas ink after scroll. It must reach 100% by about 1.6 s.
   - Thin lines: look at several loads for stems or strings with holes.
