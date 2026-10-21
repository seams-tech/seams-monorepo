import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  DEFAULT_GRAIN_STYLE,
  GRAIN_FIELD_NAMES,
  GrainField,
  setGrainStyle,
  type GeneratedField,
  type GrainStyle,
} from '@seams-internal/grain-field';
import './lab.css';

/* Dev-only page (/gradients/ on the dev server, not in the build): every
   named field, plus a generator for new ones. Copy a generated field into
   GENERATED_FIELDS in fields.ts to use it on the site, and a style into
   DEFAULT_GRAIN_STYLE in renderer.ts. */

const STYLE_SLIDERS: readonly { key: keyof GrainStyle; max: number; step: number }[] = [
  { key: 'distortion', max: 1, step: 0.01 },
  { key: 'grain', max: 0.3, step: 0.005 },
  { key: 'speed', max: 3, step: 0.05 },
];

function fieldSnippet({ accents, angle, seed }: GeneratedField): string {
  const colours = accents.map((accent) => `'${accent}'`).join(', ');
  return `{ accents: [${colours}], angle: ${angle}, seed: ${seed} },`;
}

function GradientLab(): React.JSX.Element {
  const [first, setFirst] = React.useState('#ff7900');
  const [second, setSecond] = React.useState('#1f5eff');
  const [twoAccents, setTwoAccents] = React.useState(false);
  const [angle, setAngle] = React.useState(120);
  const [seed, setSeed] = React.useState(7);
  const [style, setStyle] = React.useState(DEFAULT_GRAIN_STYLE);
  React.useEffect(() => setGrainStyle(style), [style]);
  const field: GeneratedField = {
    accents: twoAccents ? [first, second] : [first],
    angle,
    seed,
  };
  const snippet = fieldSnippet(field);

  return (
    <main className="lab">
      <h1>Gradient lab</h1>
      <p className="lab__note">
        Generated fields use white, near-black and one or two accents. Copy a field into
        GENERATED_FIELDS in fields.ts.
      </p>

      <section className="lab__maker">
        <div className="lab__previews">
          <div className="lab__card lab__card--wide">
            <GrainField field={field} />
          </div>
          <div className="lab__card lab__card--menu">
            <GrainField field={field} />
            <strong>Live demo</strong>
            <span>Create a passkey wallet on the Embedded Wallet page</span>
          </div>
        </div>
        <div className="lab__controls">
          <label>
            Accent
            <input type="color" value={first} onChange={(event) => setFirst(event.target.value)} />
          </label>
          <label>
            <input
              type="checkbox"
              checked={twoAccents}
              onChange={(event) => setTwoAccents(event.target.checked)}
            />
            Second accent
            <input
              type="color"
              value={second}
              disabled={!twoAccents}
              onChange={(event) => setSecond(event.target.value)}
            />
          </label>
          <label>
            Angle {angle}°
            <input
              type="range"
              min={0}
              max={359}
              value={angle}
              onChange={(event) => setAngle(Number(event.target.value))}
            />
          </label>
          <label>
            Seed
            <input
              type="number"
              min={0}
              value={seed}
              onChange={(event) => setSeed(Number(event.target.value))}
            />
          </label>
          <button type="button" onClick={() => setSeed(Math.floor(Math.random() * 1000))}>
            New seed
          </button>
          <code>{snippet}</code>
          <button type="button" onClick={() => void navigator.clipboard.writeText(snippet)}>
            Copy
          </button>
        </div>
        <div className="lab__controls">
          <span>All fields:</span>
          {STYLE_SLIDERS.map(({ key, max, step }) => (
            <label key={key}>
              {key} {style[key]}
              <input
                type="range"
                min={0}
                max={max}
                step={step}
                value={style[key]}
                onChange={(event) => setStyle({ ...style, [key]: Number(event.target.value) })}
              />
            </label>
          ))}
          <code>{JSON.stringify(style)}</code>
        </div>
      </section>

      <section className="lab__fields">
        {GRAIN_FIELD_NAMES.map((name) => (
          <figure key={name}>
            <div className="lab__card">
              <GrainField field={name} />
            </div>
            <figcaption>{name}</figcaption>
          </figure>
        ))}
      </section>
    </main>
  );
}

const root = document.getElementById('root');
if (root) createRoot(root).render(<GradientLab />);
