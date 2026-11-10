import React from 'react';
import { GRAIN_FIELD_NAMES, grainFieldSource, type GrainFieldName } from './fields';
import './GrainFieldPicker.css';

type GrainFieldPickerProps = {
  value: GrainFieldName;
  onChange: (field: GrainFieldName) => void;
  /* the fields of the menu, in order; every named field by default */
  fields?: readonly GrainFieldName[];
  /* the menu's heading, and the button's accessible name with the field */
  label?: string;
  /* a short tag after a field's name, e.g. { 'teal-peach-wisp': 'Seams home' } */
  tags?: Partial<Record<GrainFieldName, string>>;
  className?: string;
};

/* "teal-peach-wisp" → "Teal Peach Wisp" */
export function grainFieldLabel(field: GrainFieldName): string {
  return field
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

const thumbs = new Map<GrainFieldName, string>();

/* A picture of a field: its colour grid as a small PNG. The browser smooths
   it when it scales it up, so a swatch shows the field's soft gradient. */
export function grainFieldThumb(field: GrainFieldName): string {
  const kept = thumbs.get(field);
  if (kept) return kept;
  const { grid } = grainFieldSource(field);
  const size = Math.round(Math.sqrt(grid.length / 3));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return '';
  const image = context.createImageData(size, size);
  for (let cell = 0; cell < size * size; cell += 1) {
    image.data[cell * 4] = grid[cell * 3];
    image.data[cell * 4 + 1] = grid[cell * 3 + 1];
    image.data[cell * 4 + 2] = grid[cell * 3 + 2];
    image.data[cell * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const url = canvas.toDataURL();
  thumbs.set(field, url);
  return url;
}

function Swatch({ field, className }: { field: GrainFieldName; className: string }): React.JSX.Element {
  const thumb = grainFieldThumb(field);
  return (
    <span
      className={className}
      style={{
        backgroundColor: grainFieldSource(field).base,
        backgroundImage: thumb ? `url(${thumb})` : undefined,
      }}
      aria-hidden
    />
  );
}

/* A round glass button with a picture of the chosen field. It opens a menu of
   dark glass with every field and its picture. The menu is a listbox: the
   arrow keys choose as they move, so the page shows each field in turn;
   Enter or Escape closes it, and so does a press outside. Keyboard focus
   shows as darker glass, with no ring. Place it on a coloured ground, for
   example over a GrainField. */
export function GrainFieldPicker({
  value,
  onChange,
  fields = GRAIN_FIELD_NAMES,
  label = 'Gradient',
  tags,
  className,
}: GrainFieldPickerProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  /* the option that the keyboard or the pointer is on */
  const [active, setActive] = React.useState<GrainFieldName>(value);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const baseId = React.useId();
  const listId = `${baseId}-list`;
  const optionId = (field: GrainFieldName) => `${baseId}-${field}`;

  /* opening puts the keyboard in the list, on the chosen field */
  React.useEffect(() => {
    if (!open) return;
    setActive(value);
    listRef.current?.focus({ preventScroll: true });
    // only when the menu opens: the value changes while it is open
  }, [open]);

  /* the active option stays in sight; only the list scrolls, never the page */
  React.useEffect(() => {
    const list = listRef.current;
    const option = open ? document.getElementById(optionId(active)) : null;
    if (!list || !option) return;
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
    }
  });

  React.useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus({ preventScroll: true });
  };

  const move = (to: GrainFieldName | undefined) => {
    if (!to) return;
    setActive(to);
    onChange(to);
  };

  const onListKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = fields.indexOf(active);
    const last = fields.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        move(fields[Math.min(last, index + 1)]);
        break;
      case 'ArrowUp':
        move(fields[Math.max(0, index - 1)]);
        break;
      case 'Home':
        move(fields[0]);
        break;
      case 'End':
        move(fields[last]);
        break;
      case 'Enter':
      case ' ':
        onChange(active);
        close(true);
        break;
      case 'Escape':
        close(true);
        break;
      case 'Tab':
        setOpen(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const onButtonKey = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
    }
  };

  return (
    <div
      className={className ? `grain-picker ${className}` : 'grain-picker'}
      ref={rootRef}
      data-open={open || undefined}
    >
      <button
        ref={buttonRef}
        type="button"
        className="grain-picker__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${label}: ${grainFieldLabel(value)}`}
        title={grainFieldLabel(value)}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onButtonKey}
      >
        <Swatch field={value} className="grain-picker__swatch" />
      </button>
      {open && (
        <div className="grain-picker__menu">
          <p className="grain-picker__head" aria-hidden>
            {label}
          </p>
          <div
            ref={listRef}
            id={listId}
            className="grain-picker__list"
            role="listbox"
            tabIndex={-1}
            aria-label={label}
            aria-activedescendant={optionId(active)}
            onKeyDown={onListKey}
          >
            {fields.map((field) => (
              <div
                key={field}
                id={optionId(field)}
                role="option"
                aria-selected={field === value}
                className={
                  field === active
                    ? 'grain-picker__option grain-picker__option--active'
                    : 'grain-picker__option'
                }
                onPointerEnter={() => setActive(field)}
                onClick={() => {
                  onChange(field);
                  close(true);
                }}
              >
                <Swatch field={field} className="grain-picker__thumb" />
                <span className="grain-picker__name">{grainFieldLabel(field)}</span>
                {tags?.[field] && <span className="grain-picker__tag">{tags[field]}</span>}
                {field === value && (
                  <svg
                    className="grain-picker__check"
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
