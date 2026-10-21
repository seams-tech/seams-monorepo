import { t } from '@/marketing/i18n/browser';
/* The sample market both checkout frames describe: one lot, two outcomes, and
   what 0.1 test units buys on each side. Each position pays 1 unit if its side
   wins, so the fee comes off first and the rest buys positions at the price;
   the minimum allows 1% of price movement. */
export type Side = 'Yes' | 'No';

export const sides: readonly Side[] = ['Yes', 'No'];

export const market = {
  lot: 'Lot 542 · Audemars Piguet Royal Oak',
  sale: "Sotheby's · Lot 542",
  question: t('marketQuestion'),
  pay: '0.1',
  fee: '0.001',
  outcomes: {
    Yes: {
      odds: '52%',
      claim: t('marketYes'),
      price: '0.52',
      positions: '0.19038',
      minimumPositions: '0.18848',
    },
    No: {
      odds: '48%',
      claim: t('marketNo'),
      price: '0.48',
      positions: '0.20625',
      minimumPositions: '0.20418',
    },
  },
} as const;

export function sideFrom(value: string | null): Side {
  return value === 'No' ? 'No' : 'Yes';
}
