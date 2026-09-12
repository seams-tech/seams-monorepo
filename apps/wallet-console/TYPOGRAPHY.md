# Console typography

Use the shared `--dashboard-text-*` tokens in `src/core/dashboard/styles.css`.
They are defined on `:root` so menus, dialogs, and toasts share the same scale.

| Token suffix | Size at the default root size | Use |
| --- | --- | --- |
| `caption` | 13px | Badges, timestamps, navigation group labels, chart axes |
| `supporting` | 14px | Helper text, metadata, table headers, code and identifiers |
| `compact` | 15px | Buttons, navigation items, table cells, compact descriptions |
| `body` | 16px | Body copy, text inputs, small section titles |
| `heading` | 20px | Section and dialog headings, prominent summary values |
| `title` | 32px; 28px on small screens | Page titles |
| `title-compact` | 28px | The small-screen title size |

Choose a token by the text's role. Avoid page-specific numeric font sizes.
Use font weight and spacing to distinguish nearby levels within the same size.
The shared heading defaults are 32px for h1, 20px for h2, and 16px for h3–h6.

Keep body line-height around 1.5 and heading line-height between 1.2 and 1.4.
Text inputs stay at 16px, including on mobile. Keep table and control text sizes
consistent across breakpoints; adapt the layout and spacing instead.

Logo artwork and icon glyph dimensions follow their visual assets, independently
of the text scale. Existing font families and semantic color tokens still apply.
