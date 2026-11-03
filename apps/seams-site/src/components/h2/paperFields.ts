import type { GeneratedField } from '@seams-internal/grain-field';

/* Paper gradients for the ink banners, in the front page palette: white, the
   paper (#faf8f3), taupe (#f5f3f1), stone (#ebe8e4), the soft amber
   (#f7ecdd) and a little of the gold ink. Every tone stays light, so the
   black ink keeps its contrast. */

/* a little of the generator's bend, so each blend runs in one wide sweep */
const PAPER_VARIATION = 0.08;
/* paper flows less than a colour banner, so its folds stay slow and broad */
export const PAPER_FLOW = 1.2;

export const PAPER_FIELDS = {
  linen: {
    light: '#ffffff',
    accents: ['#faf8f3', '#f5f3f1'],
    dark: '#ebe8e4',
    angle: 120,
    seed: 3,
    contrast: 1,
    variation: PAPER_VARIATION,
  },
  oat: {
    light: '#fffdf9',
    accents: ['#f7f1e6'],
    dark: '#ece2d0',
    angle: 150,
    seed: 11,
    contrast: 1,
    variation: PAPER_VARIATION,
  },
  honey: {
    light: '#fffbf3',
    accents: ['#f7ecdd'],
    dark: '#f0dcbc',
    angle: 100,
    seed: 23,
    contrast: 1,
    variation: PAPER_VARIATION,
  },
  chalk: {
    light: '#ffffff',
    accents: ['#f9f7f2'],
    dark: '#f1ebe0',
    angle: 200,
    seed: 5,
    contrast: 1,
    variation: PAPER_VARIATION,
  },
  butter: {
    light: '#fffef8',
    accents: ['#faf3e0'],
    dark: '#f2e6c9',
    angle: 135,
    seed: 41,
    contrast: 1,
    variation: PAPER_VARIATION,
  },
  stone: {
    light: '#fbfaf8',
    accents: ['#f5f3f1'],
    dark: '#e8e3dc',
    angle: 70,
    seed: 17,
    contrast: 1,
    variation: PAPER_VARIATION,
  },
} as const satisfies Record<string, GeneratedField>;

export type PaperFieldName = keyof typeof PAPER_FIELDS;
