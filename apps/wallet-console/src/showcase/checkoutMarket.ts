/* The sample market both checkout frames describe: one lot, two outcomes, and
   what 0.1 test units buys on each side. */
export type Side = 'Yes' | 'No';

export const sides: readonly Side[] = ['Yes', 'No'];

export const market = {
  lot: 'Lot 542 · Otsuka Lotec No.7.5',
  question: 'Will it sell above its estimate?',
  pay: '0.1',
  fee: '0.001',
  outcomes: {
    Yes: { odds: '52%', positions: '0.19333', minimumPositions: '0.191400' },
    No: { odds: '48%', positions: '0.20833', minimumPositions: '0.206250' },
  },
} as const;

export function sideFrom(value: string | null): Side {
  return value === 'No' ? 'No' : 'Yes';
}
