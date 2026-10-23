/* The site's gradients as data. Every field is a 12 x 12 grid of RGB colours
   that the shader smooths, flows and covers with grain, so no gradient costs
   an image download.

   Photo fields contain cubic B-spline control points, encoded as base64,
   with rows top to bottom. Reference fits exclude text, logos and line art.
   Copper Mist fits a curved fold in its copper and blue palette.
   Desert Dawn fits a sunrise over desert ranges: lavender sky, peach and pink
   bands, the blue shadow of a peak, and dark ridges. The middle half of its
   rows holds the sky down to the horizon, so a wide panel shows the sky and a
   tall one adds the shadow and the ridges.
   Teal Peach Wisp is teal-peach in another shape: fitted from a card with
   peach wisps that cross a teal field on a diagonal, over a deep teal at
   the lower left, with its blues turned toward teal and its pinks toward
   peach.
   Onyx Dusk is drawn, not fitted: three folds across near-black that converge
   on the right. The lit edge runs from warm silver to slate blue, and a pale
   blue rim lights one corner; the lower fold is graphite, with no brown.
   Onyx Black has the same folds in black and grey only.
   Custom fields use white, near-black and one or two accents. Preview them
   on the gradient lab page: /gradients/ on the dev server. */

export const GRAIN_FIELD_GRID_SIZE = 12;

type Accents = readonly [string] | readonly [string, string];

export type GeneratedField = {
  accents: Accents;
  /* CSS linear-gradient angle, from the light colour to the dark one */
  angle: number;
  /* picks the soft variation laid over the gradient line */
  seed: number;
};

export type GrainFieldSource = {
  key: string;
  grid: Uint8Array;
  /* a photograph keeps its shape and crops like background-size: cover; a
     generated field stretches to its box like a CSS gradient */
  fit: 'cover' | 'stretch';
  /* mean colour, shown until the first frame */
  base: string;
};

const LIGHT = '#ffffff';
const DARK = '#101010';
/* every colour moves a quarter of the way to mid grey, as in Shader R */
const CONTRAST = 0.75;
/* how far the variation pushes a point along the gradient line */
const VARIATION = 0.24;
/* lattice points per side for the variation; few, so it bends and never
   breaks up */
const LATTICE = 3;

const PHOTO_FIELDS = {
  'aqua-evergreen':
    'KWVfQH+JVpWnXZmwa6C4baG5eaa7e6m4f666bp6vW5CjJVdubaaZgr23hr7ClMbUnMfaosbarMrbt87ewNXdss3bl8PTVJSyhbmcncnCn83HpMzZpc3drc3ivNfkxtbjxtngvtPcpcXWaqS9nsivtdjDtNfQsdnYrtPfrtDlwtro1OLp0N/sxtnkstLfe67Jqc6wx9/MxOHOutvXp9HTnM7Yqs3bvtjjzeDkwNXfrMrabqnGocmzyeDMx+DNwN/NptPJiMHBhL+/kcDDmMXGk8HCf7jCS46qkcGus9jDwN7NutvIoM+8gbyqZ6ylYqaYYKGOVZuLPo2BJ250a6udoMy/qdDAqtXAl8atarSlUJ2OR5KBNH1jMHFQIFlDD0dBVZWSgr2tj8Syl8eugbykVaGVPJOPK31vI2tRG1RBFko7CTAqKWJraqufda6fdrCYXZ2IO46CJHF1HWhnElJJEko+CzcxCC8oE0FWPoJ7SJJ+RIZzOXlmJmleHmJhFFNWEUlLCzg6CzIyCSkpBx0uDTNDF0ZIE0I4F0E1EjQsEjEzCzA0CjA5CC8xBB8lBiEd',
  'sky-sand':
    'AFWrBVy1BGC5CGTBC2nGCGjIB23KDX3SBXfSBYPVA4fWC3/NC2y+BH7SDYHSDobYE4XZFordGY/gEYvfEJXjF57iIqbhI57UHnO1HYnRGo7VH5XbHpPeHpTgIZjeHpjkH57jKKvmK6/cQK/UQHedQpXFPJjQMqDcLqDbKp3eKp/kLqPmMq/qN7nfVsHZZrLCUW59a5qzZJ28XqbKXKjRVqrVUqrWRbPkULvfc7/RbbjJoa6eXWhvf42QiaCkgqe2jam1k7W8lbTAgbXHlLvEpbSsqbCgqZuCTVpmfYaHjZGNpp+PtrCcwbmfxLyhw7idw7mZwK+ExqJ1yZVuJT1XVm53doCGmp2K0K155b986cOC5b584axx3J5o1pNfwnpeGDVRK05tS2Z7gIiMrZ9637Nw9L5m7qxb6qZd3o1V1IRWv2VODiVBFDxgK0xrYG53g4F1tJhr2qZW56FP4pNH2YNJzWxFrlpGDCdCETBRHjpaSFVoa25rk39hvpBV35dE4Y1G2HI9x2hGmE1BBhktCR84FSc6JC0+PjxITEpJY1JDhGFBoF84lVE4iUU5YjQ0',
  'mauve-ember':
    'loyvm4usmomon4amnYWjoYOknoajpYejp4igroigsIeftomflpGzmo2umouqnIijoYWknoWioYOgo4SfpoWerYadr4aetIWYlJS3mZKznpGxnY2oooumoIeloISfo4Sco4ObqICXqoCWsYKTmZq9mJm5oJa0n5StoY6qo4iloIWdoYCZon2UpHySpXmMqneEnJ69oJu3pJq0pJWupY+ooIaeoIKXnnuQnHWKnnOEonF8p3J8pZy1qJasqZSmrI6gp4mYoYCQnnqMnHKEnHJ/oG96onB6o2x0q42gsomWtoWMuISFsX+Cqnh/oXR7n3J5onJ5o3F2pXJ0qnNztnqAu3RwwXZqxntow31nvHxrsXdtqnRvq3VyrHZyrnVxrXVxwWZixmRaz2xZ13ZW2oNa0IRaw4Fiu3tntXZltnVlt3VltXJjy19W1GJR3mpO53tJ6YpL441P1IZWx3tYxXhaxHNXw3BUwnBTz15V3WRP5m9K74NE7pFF6JFG3IhO0n5R0HdR0HNL0HFJz21Ix1xZ12NR5nJK8IdF8JNE6ZJE4YdF3oBH3XtD3nhC4HhA33U9',
  'slate-amber':
    'wbaglp2eg5WfeJKiepShfZalfpimgpqngpuohp2qhp6qiZ+twbKcmJuZipWae5CcgJOggZahg5eihJijh5ukiJylip2lip6lyLeaqKKYl5mZiJKYiZWaiZaciZacjJmfi5mfjJugjpyij5yi3MGTvquQrp+QnpSQmJORlZOUkpWXlJaYmJiZmpqbm5ybmpyc7MWF3LeGy6mEwJ6Ft5mFq5aJopSKnpCInY2En4yCoJCHoJGL9cBu77ty5Ktr2Z5szpduxJNytZB1pH5um29jmGhgmmtio3Zo9KpY87Ba6qFW3IhS031R0oNVyYVZsG1TjlNHgUtFgUxDmFdK4HlC4oJD1HBAvVg4tlE4xWBAy25IvWRFmU89gkI2fUA2mUs7rUcwukwwrUUtkDkohDcpmD8sulI2x2A9tlg4qFA2n0s1qkszVSggaS4jaiwjWyUeUCIeWikjgjYpq0Yuvlc2wVs3vVc3vFM2NRUYPBgYQRoYRhscQBkaQRscTiUhdzQoqkUuwVEzw1Mzv04yHAsTJA0UKQ8ULA8VLxEWLxAXOhUZSR4baCogijQllTkmkTkm',
  'teal-peach':
    'OKPDLJu8A36sC4OvAHysM5G1EoexAHqvuKi/zau8qK+6zrK3MJ6+AG6kCIWyCYKuDoSvAHapAHavs6TBvKW9yKW6wZGzxqytDYixA4KvEYmyA3+tAICvOZC0UZO2mp68saO+qJq3yKe11KarBIOwCYWvBYGvAIKvLouyRo6yQ46xYpm0jZS5mJSt3ai016usBoawC4eyAIKvIYqwMouzP4+0XZS1dJmzjpmx+ri81K6w57OpCoeyAIGvEoeyKYu0Mo2zUJK0WZSyhZu2kpmwxqmw2qes1aSnIpa6AIOvL5W5JImyQpK2VJS2apq3kZ61qqKytqKw2KWx2KmmIpe5A4ewMZe4KY+0SJe5Wpm3e565m5+2sqe0wKSw3auw26qlGpC2DI+1IZS4TZi6UJq7ZZ26hqG7p6S4tae1yaKz5baw36ynG5a5Jpa5EZO4K5e6VZ27dKG9maW7q6e4uaO35Le14LKuzpujHZm5Kpu8A5O4e6vGc6bBd6S+n6i8qqa82LK83bWzwJer26mmO6PCHpu8VqfEdavFaKPAlKnCqarBwa6/0LC5xKKx2a2u3Kek',
  'azure-coral':
    'g6rUUoHGW47QYo7MdZfJe5DEdpHHmImxWIvPg4Gzs3ebmoWtUoLHV4XKXIrLbIvAaIXCc4G3eX6ygHmrlHmhvmqEoGOOqWWMXInGVobGWorKX4C/a361c3iuenWmhm+ce22dpV59pmOComCFUYDDV4bHXIHBb3SlaHWrcHOnd26eh2WRjmKInGB6rFpspFhxXYfDaIe+ZHOpXYPBPI3ewGFwrGN9pV13nFx1l1lum1loqVZda5DDWny2bHKmSoXNZnexwVJXkV58olZsmlZxo1VcplBZqFFVaoq8X3ivbm6hUYPGXni5tFNWoFpoqVRfmVVmpFBVpU1TrExOa4u5Y3mvcXCdaHqvkmN+qVdfpFlkplZfnVBhqU9SqUxNrktHb4q2anapdm+adHGisVtYqlleqVZdqVFYokxXq01LrEpHsElCboi1bHejenCXi2iJqWBlr1dZrlNUrk9OqExQrUxIrUtEskg/eImvb3WhfXOWl2V7nGBrs1ZTrVJQsUxIq0hGr0xHr0k/s0o/ZIW1fnmdfHGRm2d5ol5osFZTrlFMsk1Erk5JrkpCsUtCsko+',
  'copper-mist':
    'rcvXy9rc7u7j7MKh04pjzHRVq1xIa0tHGkBUATtXFj5TGD9Un8PUmr/Rqcra2/j/+vrp6bmQ34le4nRQuFg/VUdKAj1ZCTtUqMjVqcnXosLQn7rHvdXg6vn369W5zpZw14JgyGNFkVFCHUFVo8XVpMXUp8jYpMnapcTRtMvU5vX39N7F2aB60oprz2lIglFHpsbVpsbVpMXUpsXTocTWs8/Zu83S7vfy5b6d1Zl42oFen1pIpcbVpMbVpcbUpsfWo8bXscvUwtXZ8/fv47eV05d2131am1hHpMbVpsbUp8jYosXVpcHNvtbf8Pv36cqr1Zhz04Fhy2FCbU5Kp8fVpcjYnsDPp8PQ0enx9vfr5ryX04xl2ndWt1lAZktJCD1XosXWob/NutTe6/r59N/E25xy1HtXzGdKklBBLENRADtZET1TqsfTzuLn9/nt6LyW04Ze0nRUs1tFZkpHDD5XAjtXGD5SGD9Uxtjc/PXm3aqE0YZjznZaoFZDW0pLDD9YCzxUHj9SEz5VEj5U2ubk8tW40ZVx2oprtmFGg1FIOUdSCDtUG0BTED1VFD5UFT5U',
  'vermilion-sky':
    'vCEEtDElti4frjAfxjohxjchwDohwDkhvDgjqzAgqjAhoDQtmXCCxxMAti8huC8fwjQhvjQf6FAl20cjz0Ag3kwozjgYsEM2WMH/20khwTsksyweyUEi6VMm4lAi1kYkyzkcx0AptiENsEU3YaX1tJKS3EQRoTAtriUU0j4lxjId00Ik1UAevTcosyQOtEY4baPccbP47lMYuk47wDgirCkcsTAfwy0evC4cvDwnvSMQoz01eaHYWLT/tIqK5TEAyzskoCsejjAjyDUitiEYxDwpoxoNijkzdKTdYqLsj7Pa9kMApSMghx8ZjDIm0T4mriAVpDQobA8JaDMzha7bVaH1uba98nc7riUivCkahiUf4Fo4ewYIkSsmuxwOpT42YZ7jb6fy/6RZ2mxFqiAUzjIfgR4b/oxbvjghtTgomxgNt0A2h7zv5LmZ+5tZzmZP0FUzwi4doyUb74hX5oJT4V47mAQAuT428nc7z0Aa2WpJ1mVGz1UztCcY0E4x5HVI6IlX3GE+mQIAoEM7ry0i2GZE0WA/ujki53pPzVA06HpM55Jg55pl5XpP32M5rDIp',
  'apricot-beam':
    'EkuIE1aQElWREE+LD0qHEEmIEkuMFU6QFlGMFE1xEj9YDjJGDEmHCkqHC0eECUqECUl/C0iBCUZ9BUZ/A0RxDDNAHhghFxYgCUyJB0aDCEWCC0qHDEqHB0iECEl/DkmJEURvESYvGxEUEA4LCk2LC0uKCkuJB0yJCEqHEEmJEEaHAEiHClF9QT47ijk1WzcvCFGPCFCPCU+ODE6NDUqKAU6KB2SNV4qVvamR7rJ6/5FXmEA7BVaUB1ORCVORBE6NAFuROIKZyauX/8KV/8eM8qNvsklAJig1AFyVAVeTAFWSAGGWUImc8bST/8iT+saM8rl/z2JEWiw2HicyAFyZAFyXAGCWP4Wg6aua+8SR88OM9L6F631ThDk9Ny4yGCY2AGOYAGSaGXuhxp2g97OR7sCK97F34nRQfDI4JSs2IBMaByExAGacDHKeh5Oj66mZ9LeL9qdzzmdSZzA5HCQvFxghCAUTCCs+AGuiPYKh0aCf6KSN6ad93n9Vgjg7IiszHBUdCwsaCA8cCzdKAHingJak5qea756C2IRjpVI+UCQsGxooEQ8fBxAgCR8vCjlN',
  'coral-tide':
    'AGShAGOcAG2iRoOtnpGqy5qh4KOW67CO8baH8reE+LqD/8SNAGqhAGmdAHencI+zypip1p2e46aW7rGR76uF7aiB9rF+6Jx3AGyeAHOlOIWuoZOw0Jqm2qCb46SR5KCH5Z2B7KN98at+zGpXAHKlC3qqcY2wu5Kqypig2pyV3JiK25F/55yA5Zh02n5jtUtEAnOmKYSuko6wv5en1p6g3JqN2pSD4ZV/4pR41HxmzGdUrUZEBHepUomvr5OtxZij1JWY2JWO25KE24x414Nuz3Je0WdPpkNGE4OwiY6vrJKrw5KhzpGU0oyG2Ip+1YNx2X9k0Xhh0ltMeDU9Oomyk42tpI6oxZCgy42R1IuF14R50X9t1nRfyW9ZxExHdDlASYeviYyuq42mxI2YyIaLzIB8znhszHRg0WxgyW5S0FpLizpASImvj4yssYyjwYiVxoCFzX13znpo0nNf1XNcx2dMyElHZzU8bIyxk4mnp4WeuX+Qw3uAz31y1HtnzWpVvlVFrT5BmTU8RTI4io6xlYmoo4Setn6PxHl5znJjzmdSvVFFpDg/iS5AYzM6LDMy',
  'onyx-dusk':
    'CAgJCAgJCAgJCAgJCAgJCgsMERIWHSEoMzpGU19xeoulnLPTCAgJCAgJCAgJCQkLDg8SFhofHyMrJSszNDpFU11tgpOrrcboCAgJCAgJCgsMEBIVFRgdFhgdGhsfMDM5WmJuhZSonrLNnbPQCAgJCwsNDxATDxEUDxASHh8hS05UeoKOgo2dbniIWWFvT1VhCQoLDAwOCwwNDw8QKywuamxyg4mTZWp0QkVMMjQ6Njg+RkdPCQkKCgoLEBAROTk6fX6Cd3qARkhOKywxJycsMzQ6PT5EMjM4CQkKEhETREJChoSFZWZqMzQ4IiImJSYqNDQ6MjM4ISIlExQWEhITSUZEhYKAVlVYKSktHh4hJiYrMTI3JicrFxcZDw8RDQ0PRkI/e3ZySUhKIyMnGxseJicrKywwHB0gERETDg4QDg4QDw8RZ2JcOzk7Hh4hGBgbJSYqJSYpFRUYDQ0PDQ0PDw8RERETEhIULSssGBgaFRUXISIlHx8iEBASCwsNDAwNDg4QERETExMVFBQXExMVERETHBwfGRkcDQ0PCgoLCgoMDAwODw8REhIUFBQXFhYZ',
  'onyx-black':
    'CAgJCAgJCAgJCAgJCAgJCgoLEBARHBweMDA0T1BVdnd+mJqjCAgJCAgJCAgJCQkKDQ0PFRUXHR0fIyMmMTI1UlJXg4SLtLa/CAgJCAgJCgoLDw8RFBQWFRUWGBgaLi4xWVleh4iPpKWtpqiwCAgJCgoLDg4PDw8QDw8QHBweRkZKdHV7gIGIcHB2W1tgT1BVCQkKCwsMCwsMDg4PJicpXl5jeXqAYGFmQEFFMTE1NTU5Q0NICQkKCgoLDw8RMTE0a2xxamtwQkJGKiotJSUoMTI1Ojo+MDAzCQkKEBASNzg7bm91WFleMDA0ISEkJCQnMjI1MDAzICAjExMVEBASOTk9a2txSktPJycqHR0fJSUnLy8yJSUoFhYYDw8QDQ0ONTY4X2BlPj9CIiIkGhocJSUoKiosHBweEBASDg4PDg4QDw8QTk5SMjI1HR0fFxcaJCQmJCQmFRUWDQ0PDQ0ODw8QERESEhITJiYoFxcZFBQWICAiHh4gEBARCwsMDAwNDg4PERESExMVFBQWExMUERESGxsdGBgaDQ0OCgoLCgoMDAwODw8QEhITFBQWFhYY',
  'desert-dawn':
    'scz7ydj/zt381+P/4On84ur94+v/4en82eT/zt39yNT/uMz7s836ydn/0N792OT/4er95Ov95ez/4ur92uT/0N39yNb/us36r8z7yNf/zd382OP/3er84en+4er/3+n72OP/zN39xtP+tsz8uM75y9v/0+L/3Of65ez+6u/+6vD+6O//3+j81uH/ydn/wc/2z9Le29rm4Ob16Ov+6e7+6vH88fP67fD76uv94eLx29bh1NLf2crC6tnO7trG9eLK++fS//Dg9e/k++ra+uHH9NfC7tfL4si867uQ+sSa/c+n/9e+9trH59zP/+LK+NrF+NXD+s6q972T7LaM4plv7qmA+LCM8LaY/7+d/8ih7MCw/8Cl/baT/6mG9KSA6pN07IKE9IN/9IiC/5aJ+ZWVx4+k/6CR85OS9ZCV3oyW4n+N1XuMH0NhKGCRG1+cBWGvAF62AGK9AGK8IGmwM2ucOVmBNVVzJTpRFAAAEAAHKh8sNyQsSi01SScvPSguHhMbJAsOIA4RHAgRHAgRAgcPCw0YBgcSBgsZAw4dBw0YBQsXDg0YDg8aCwoVDAoXAgML',
  'teal-peach-wisp':
    'ucba/9rP+ePV+eLe4tXqFbTOKLLQFbfSFbXRFbbRFrfSFb3Wl8TY4MbJ99bP48/O//Lok8/qFbvOMbLSNLrUFbzUGrzVHr7Xn8PZ0sLL1cjO3cvQ39rT/+LgmNLpFbXQFbDRFbXTGb/XFb3WesHV6MLN/9/N/+bL/9zT383V/+Lc/9zdq9XmFsnaJbvVMr7YObPHKLXGcLzUXr/aZcLYrMng8MvO3c7a/9fW7NfnFsbdFsbc/9PHEpKwNqC0JaK0Va2+X7PGtrjP4MLJtcnax8nb9dTbqNTmiKe91LnEOpy0MaG8Epa1GaW9I6m+U7TJu7bRuMPZnMTZes7eNJ63EH+bD3iVC1ZvFGR8FXaSEY6oG6C3P6vAgLXKornPwMPcD0xkJl93FU5jE1FmC0xhEFZsGF96FnKOEoKeEpq0E63CFcDVC0FYDFx1DWN9EneSF4ejFZuzE6i+F6/DIbPHLLrLN8bYK8HQDT1WEVFmEV12FnCLE3WOF3aRGHSPGHuYE4qjE6K8E7DBFs/fDEJZC0deEWV+FHmXG42pFZ+3FarBFai9Fa3DGLTGGsrYGsvb',
} as const;

export type GrainFieldName = keyof typeof PHOTO_FIELDS;

export const GRAIN_FIELD_NAMES = Object.keys(PHOTO_FIELDS) as GrainFieldName[];

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function meanColour(grid: Uint8Array): string {
  const sum = [0, 0, 0];
  for (let i = 0; i < grid.length; i += 1) sum[i % 3] += grid[i];
  const cells = grid.length / 3;
  return `#${sum
    .map((total) =>
      Math.round(total / cells)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/* mulberry32: a small seeded generator, so a seed always gives one layout */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function generateGrid({ accents, angle, seed }: GeneratedField): Uint8Array {
  const size = GRAIN_FIELD_GRID_SIZE;
  const stops = [LIGHT, ...accents, DARK].map((hex) =>
    hexToRgb(hex).map((channel) => (channel - 127.5) * CONTRAST + 127.5),
  );
  const segments = stops.length - 1;
  /* a lattice of values in -1..1, smoothly interpolated over the field */
  const random = seededRandom(seed);
  const lattice = Array.from({ length: LATTICE * LATTICE }, () => random() * 2 - 1);
  const last = LATTICE - 1;
  const radians = (angle * Math.PI) / 180;
  const dx = Math.sin(radians);
  const dy = -Math.cos(radians);
  const span = Math.abs(dx) + Math.abs(dy);
  const grid = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;
      const lx = u * last;
      const ly = v * last;
      const ix = Math.min(Math.floor(lx), last - 1);
      const iy = Math.min(Math.floor(ly), last - 1);
      const fx = smooth(lx - ix);
      const fy = smooth(ly - iy);
      const row = iy * LATTICE + ix;
      const variation = mix(
        mix(lattice[row], lattice[row + 1], fx),
        mix(lattice[row + LATTICE], lattice[row + LATTICE + 1], fx),
        fy,
      );
      const along = 0.5 + ((u - 0.5) * dx + (v - 0.5) * dy) / span;
      const position = Math.min(Math.max(along + variation * VARIATION, 0), 1) * segments;
      const stop = Math.min(Math.floor(position), segments - 1);
      const blend = position - stop;
      for (let channel = 0; channel < 3; channel += 1) {
        grid[(y * size + x) * 3 + channel] = Math.round(
          mix(stops[stop][channel], stops[stop + 1][channel], blend),
        );
      }
    }
  }
  return grid;
}

function decodeGrid(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

const sources = new Map<string, GrainFieldSource>();

function cachedSource(
  key: string,
  fit: GrainFieldSource['fit'],
  makeGrid: () => Uint8Array,
): GrainFieldSource {
  const cached = sources.get(key);
  if (cached) return cached;
  const grid = makeGrid();
  const source = { key, grid, fit, base: meanColour(grid) };
  sources.set(key, source);
  return source;
}

export function generatedFieldSource(field: GeneratedField): GrainFieldSource {
  return cachedSource(JSON.stringify(field), 'stretch', () => generateGrid(field));
}

export function grainFieldSource(field: GrainFieldName | GeneratedField): GrainFieldSource {
  if (typeof field !== 'string') return generatedFieldSource(field);
  return cachedSource(field, 'cover', () => decodeGrid(PHOTO_FIELDS[field]));
}
