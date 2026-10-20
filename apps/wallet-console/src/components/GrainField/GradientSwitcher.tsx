import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { GRAIN_FIELD_NAMES, type GrainFieldName } from './fields';
import { setGrainFieldOverride, useGrainFieldOverride } from './fieldOverride';
import './GradientSwitcher.css';

/* '' is the page as authored: each field draws its own gradient */
const CHOICES: readonly (GrainFieldName | '')[] = ['', ...GRAIN_FIELD_NAMES];

/* Development only: a fixed control at the bottom left that previews one
   gradient on every GrainField of the page, to compare them in place. */
export function GradientSwitcher(): React.JSX.Element {
  const override = useGrainFieldOverride();
  const index = CHOICES.indexOf(override ?? '');

  const choose = (choice: GrainFieldName | '') => setGrainFieldOverride(choice || null);
  const step = (by: number) => choose(CHOICES[(index + by + CHOICES.length) % CHOICES.length]);

  React.useEffect(() => () => setGrainFieldOverride(null), []);

  return (
    <div className="gradient-switcher" role="group" aria-label="Preview a gradient">
      <button type="button" aria-label="Previous gradient" onClick={() => step(-1)}>
        <ChevronLeft aria-hidden size={16} />
      </button>
      <select
        aria-label="Gradient"
        value={override ?? ''}
        onChange={(event) => choose(event.target.value as GrainFieldName | '')}
      >
        {CHOICES.map((choice) => (
          <option key={choice || 'original'} value={choice}>
            {choice || 'Original (per section)'}
          </option>
        ))}
      </select>
      <button type="button" aria-label="Next gradient" onClick={() => step(1)}>
        <ChevronRight aria-hidden size={16} />
      </button>
      <span className="gradient-switcher__count" aria-live="polite">
        {index + 1}/{CHOICES.length}
      </span>
    </div>
  );
}

export default GradientSwitcher;
