# Hairline SVG illustrations

Use fine SVG line art to explain wallet concepts through small, purposeful movements. Keep Seams' existing paper surfaces, typography, gradients, and product demonstrations.

This direction extends the [ElevenLabs-inspired interface style](./eleven-labs-style.md). [Hairline by Lucas Marques](https://hairline.lucasmarkes.com/figures) provides the visual and interaction reference.

## Scope and reference implementation

Apply this direction to marketing explanations, onboarding illustrations, and selected console empty states. Keep operational data, signing controls, and frequently used navigation stable.

The separate motion study contains five interactive concepts. Its illustrations are original SVGs with React state and CSS transitions. It adds no animation dependency.

- Local preview with the repository's development stack: [Motion studies](http://localhost:4001/dashboard-static/showcase/motion/).
- Standalone build entry: [`showcase/motion/index.html`](../../apps/wallet-console/showcase/motion/index.html).
- Page and controls: [`page.tsx`](../../apps/wallet-console/src/showcase/motion/page.tsx).
- SVG geometry: [`figures.tsx`](../../apps/wallet-console/src/showcase/motion/figures.tsx).
- Illustration styles and movement: [`styles.css`](../../apps/wallet-console/src/showcase/motion/styles.css).
- Existing wallet palette: [`h2.css`](../../apps/wallet-console/src/styles/h2.css).

The study is a design reference. Its controls change sample illustrations only. Its timing and geometry remain adjustable before integration into product pages.

## Visual language

### Draw objects with depth

Use isometric views: parallel diagonal edges suggest depth without a vanishing point. Keep the viewing angle consistent within each scene.

- Build recognizable objects from plates, outlines, and a few internal marks.
- Use thin side faces to give a plate thickness.
- Draw rear objects first, then foreground objects.
- Fill foreground faces with the surrounding surface color. This hides lines behind each face.
- Keep construction grids and guide lines lighter than object outlines.
- Leave enough space around the figure for its largest movement.
- Make the resting pose communicate the concept before the user interacts.

Avoid dense wireframes, glossy materials, heavy shadows, and decorative machinery that needs an explanation of its own.

### Keep a clear line hierarchy

The current study uses a `1px` stroke with rounded caps and joins. Apply `vector-effect: non-scaling-stroke` so resizing the SVG preserves line weight.

| Role                           | Existing token        | Use                                                     |
| ------------------------------ | --------------------- | ------------------------------------------------------- |
| Canvas and opaque faces        | `--h2-bg`             | White paper and surfaces that hide geometry behind them |
| Quiet surrounding surface      | `--h2-taupe`          | Bounded illustration backgrounds                        |
| Guides and construction grid   | `--h2-stone`          | Receding structure                                      |
| Object outlines and connectors | `--h2-ash`            | Default figure geometry                                 |
| Supporting labels              | `--h2-smoke`          | Captions and secondary information                      |
| Selected geometry              | `--h2-evergreen`      | The part currently under discussion                     |
| Selected face                  | `--h2-green-soft`     | A restrained fill on the selected layer or card         |
| Strong selected detail         | `--h2-evergreen-deep` | Checks, selected controls, and important accents        |

Use the host surface's existing tokens when moving an illustration into the console. Do not create another palette for this illustration family.

Selection color identifies the part being explained. In a real transaction flow, success color must follow the actual result.

Fine lines can recede. Required instructions and essential state must remain readable in adjacent text. Do not make a faint outline the only status indicator.

### Preserve the surrounding interface

Use Hanken Grotesk for headings and prose. Use the existing monospace stack sparingly for diagram labels and short technical annotations.

Keep the illustration inside the established content rail. Align its caption and controls with the section's text. Let the drawing supply depth while the container stays still.

Keep the live registration and transaction previews prominent. These illustrations explain relationships alongside the product demonstrations.

Do not add vertical button movement on hover or one-sided accent borders to rounded cards.

## Motion language

Animate the part that explains the relationship. A device lifts, a drawer slides, a credential rises, or an application separates into layers.

1. Show a complete resting pose.
2. Let a deliberate selection reveal the next state.
3. Update the caption immediately.
4. Move the relevant geometry and settle into a readable final pose.
5. Allow another selection to reverse or redirect the movement.

Prefer explicit controls to automatic paging. An explanation should remain visible while the reader studies it. Avoid repeated line-drawing loops and perpetual travel effects.

### Current study timing

| Movement                                | Current value                    | Purpose                                                |
| --------------------------------------- | -------------------------------- | ------------------------------------------------------ |
| Device, card, drawer, or layer movement | `550ms`                          | Explain a spatial relationship                         |
| Signing contribution markers            | `650ms`                          | Show the two contributions approaching the policy area |
| State emphasis                          | `200ms` opacity transition       | Reveal a check or result                               |
| Illustration easing                     | `cubic-bezier(0.23, 1, 0.32, 1)` | Respond immediately and settle gradually               |

These longer movements belong to explanatory artwork. Keep routine UI feedback below `300ms` and follow the host component's existing motion tokens.

Use CSS transitions for the study's reversible state changes. Animate `transform` and `opacity`. Specify each property explicitly.

Group movable SVG parts in `<g>` elements. Use an outer group for fixed placement and an inner group for motion. This keeps positioning separate from animation.

Continuous pointer tracking is optional future work. Add it only when it improves the explanation. A moving target may justify a spring, but the current discrete controls need no motion library.

## The five concepts

| Concept                     | Figure and interaction                                                                             | Intended placement                           |
| --------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Custody and signing         | Two separate participant plates, a policy check, and one signature. Select each explanation step.  | Wallet security section                      |
| Passkeys and recovery       | A phone and laptop remain connected. The selected device lifts and receives stronger outlines.     | Recovery explanation                         |
| Credentials and permissions | A tray of cards. Selecting a role raises its card and reveals scope, limit, and expiry.            | Policy and delegation explanation            |
| Empty states                | An empty drawer, a filter sieve, and a disconnected plug. Each has one small, reversible movement. | Activity, filtered results, and integrations |
| Embedded wallet             | Three application plates separate or assemble. Select the app, wallet, or policy layer.            | SDK integration explanation                  |

### Custody must remain accurate

Keep the signing participants visually separate throughout the sequence. Their contributions produce a signature. Do not show secret shares combining into an exposed private key.

Treat the two-participant scene as an explanation of the illustrated signing arrangement. It does not define every wallet protocol or deployment configuration.

Keep policy approval, authentication, signature production, and network confirmation distinct. A policy check alone must not imply that a transaction completed.

### Recovery must remain accurate

Selecting a device changes the illustration. It does not authenticate a user or complete recovery.

In a real recovery flow, labels and completion indicators must follow the supported flow and its actual state. Avoid implying that any nearby device grants access.

### Credentials must reveal useful information

The selected card and its detail panel must refer to the same credential. Keep scope, limit, and expiry readable outside the SVG.

The study's roles and amounts are sample data. Production illustrations must use approved examples or real domain state, as appropriate.

### Empty states need a next step

Keep these figures compact. Start around `160–240px` wide and adjust to the host layout. Place a short heading, explanation, and relevant action beneath them.

The study uses inspection controls such as “Peek inside.” Product empty states need useful actions such as changing filters or connecting an app.

Keep the plug visibly disconnected until a connection actually exists. The illustration can acknowledge attention without asserting a completed connection.

### Embedding is a conceptual view

The app, wallet, and policy plates explain how the experience fits together. They do not specify process boundaries or a literal execution order.

Keep labels and explanatory text available when the layers assemble. Use this drawing beside real UI previews and integration examples.

## Input, accessibility, and responsive behavior

- Provide visible buttons for every meaningful selection. Hover can add emphasis, but it must not be required to understand the figure.
- Gate decorative hover movement behind `(hover: hover) and (pointer: fine)`.
- Preserve keyboard focus and expose the selected control with `aria-pressed` or the appropriate component semantics.
- Give informative SVGs an accessible name. Mark purely decorative artwork with `aria-hidden`.
- Announce changed explanations with a small `aria-live="polite"` region. Avoid announcing every animation frame.
- Honor `prefers-reduced-motion`. Apply the final selected pose directly and suppress incidental hover movement.
- Keep the study's manual still mode for review. It supplements the operating system preference.
- Stack paired sections and empty-state cards when their content stops fitting.
- Move essential labels into adjacent HTML when they become too small inside a scaled SVG.
- Verify that expanded geometry stays within the page at narrow widths.

## Implementation boundaries

Extend the existing SVG figures for wallet-specific explanations. Reuse small geometry components only when they remove real duplication.

Consider a packaged Hairline figure for a matching generic empty state. Check its behavior, licensing, theme support, and loading cost before adoption.

Do not add a general animation engine, canvas renderer, or 3D library for these concepts. Keep illustration state separate from wallet authority and signing state.

In product flows, derive status artwork from validated domain state. A pointer, elapsed animation, caption, or CSS class must never determine authentication or transaction success.

Avoid frame-by-frame path reconstruction when grouped transforms can express the movement. If an animation needs a JavaScript loop, stop it when settled or offscreen.

## Verification before integration

Review a complete explanation, reverse it, and switch selections rapidly. Check that the caption, selected control, and drawing remain consistent.

Check keyboard operation, narrow screens, reduced motion, and touch behavior. Inspect the illustration during movement and at rest. Save screenshots of representative states.

The initial study passed desktop interaction checks, keyboard selection, a `390px` layout check, and manual still-mode checks. Lint, TypeScript, and the production build also passed.

Operating-system reduced motion was implemented in CSS but was not emulated during that review. Physical touch-device behavior still needs verification before production integration.
