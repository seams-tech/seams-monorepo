// Writes the features page globe's land grid from Natural Earth 1:110m land
// (public domain):
// https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson
//
//   node apps/wallet-console/scripts/globe-geography.mjs ne_110m_land.geojson
//
// Land is a hexagonal grid of cells on the sphere. Each row of cells is a
// latitude, a cell count around the globe, a half-cell offset on alternate
// rows, and runs of land cells as start and length pairs.
import fs from 'node:fs';
import path from 'node:path';

const OUTPUT = path.resolve(import.meta.dirname, '../src/pages/features/globe-geography.json');
// Arc between neighbouring cells in a row, in degrees.
const SPACING = 1.0;
const ROW_SPACING = (SPACING * Math.sqrt(3)) / 2;
const RADIANS = Math.PI / 180;

const source = process.argv[2];
if (!source) throw new Error('Pass the path of ne_110m_land.geojson');
const land = JSON.parse(fs.readFileSync(source, 'utf8'));

// Every ring as [longitude, latitude] pairs; holes count through the even-odd rule.
const rings = land.features.flatMap((feature) => {
  const { type, coordinates } = feature.geometry;
  if (type === 'Polygon') return coordinates;
  if (type === 'MultiPolygon') return coordinates.flat();
  return [];
});

function crossings([longitude, latitude], ring) {
  let count = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (
      yi > latitude !== yj > latitude &&
      longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi
    )
      count += 1;
  }
  return count;
}

const isLand = (point) => rings.reduce((sum, ring) => sum + crossings(point, ring), 0) % 2 === 1;

const rows = [];
let cells = 0;
for (let index = 0; ; index += 1) {
  const latitude = -84 + index * ROW_SPACING;
  if (latitude > 84) break;
  const count = Math.round((360 * Math.cos(latitude * RADIANS)) / SPACING);
  const offset = index % 2 === 0 ? 0 : 0.5;
  const runs = [];
  let start = -1;
  for (let cell = 0; cell <= count; cell += 1) {
    const landCell = cell < count && isLand([-180 + ((cell + offset) * 360) / count, latitude]);
    if (landCell && start < 0) start = cell;
    if (!landCell && start >= 0) {
      runs.push(start, cell - start);
      cells += cell - start;
      start = -1;
    }
  }
  if (runs.length) rows.push([Math.round(latitude * 1000) / 1000, count, offset, runs]);
}

fs.writeFileSync(OUTPUT, `${JSON.stringify({ spacing: SPACING, rows })}\n`);
console.log(`${rows.length} rows, ${cells} land cells`);
