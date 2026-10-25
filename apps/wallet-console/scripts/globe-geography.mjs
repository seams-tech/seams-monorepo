// Writes the features page globe's geography from Natural Earth 1:110m land
// (public domain):
// https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson
//
//   node apps/wallet-console/scripts/globe-geography.mjs ne_110m_land.geojson
//
// A Hairline figure draws a few large, clean shapes, so the coastlines are
// simplified and small islands dropped. Land also gets an even grid of dots.
import fs from 'node:fs';
import path from 'node:path';

const OUTPUT = path.resolve(import.meta.dirname, '../src/pages/features/globe-geography.json');
// Largest distance, in degrees of arc, that simplification may move a coastline.
const TOLERANCE_DEGREES = 0.25;
// Smallest land mass kept, in square degrees at the equator.
const MIN_AREA = 8;
// Arc between neighbouring land dots, in degrees.
const DOT_SPACING = 1.4;
const RADIANS = Math.PI / 180;

const source = process.argv[2];
if (!source) throw new Error('Pass the path of ne_110m_land.geojson');
const land = JSON.parse(fs.readFileSync(source, 'utf8'));

// Outer rings as [longitude, latitude] pairs.
const rings = land.features.flatMap((feature) => {
  const { type, coordinates } = feature.geometry;
  if (type === 'Polygon') return [coordinates[0]];
  if (type === 'MultiPolygon') return coordinates.map((polygon) => polygon[0]);
  return [];
});

function vector([longitude, latitude]) {
  const lat = latitude * RADIANS;
  const lon = longitude * RADIANS;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Angle between two points.
function arc(start, end) {
  return Math.acos(Math.min(1, dot(vector(start), vector(end))));
}

// Angle between a point and the great circle through two others.
function arcFromSegment(point, start, end) {
  const [b, c] = [vector(start), vector(end)];
  const normal = [b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0]];
  const length = Math.hypot(...normal);
  if (length === 0) return arc(point, start);
  return Math.abs(Math.asin(dot(vector(point), normal) / length));
}

function simplify(points, tolerance) {
  if (points.length < 3) return points;
  let farthest = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = arcFromSegment(points[i], points[0], points[points.length - 1]);
    if (distance > farthest) {
      farthest = distance;
      index = i;
    }
  }
  if (farthest <= tolerance) return [points[0], points[points.length - 1]];
  return [
    ...simplify(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(index), tolerance),
  ];
}

// A closed ring splits at its farthest point, so both halves have distinct ends.
function simplifyRing(ring) {
  let far = 0;
  for (let i = 1; i < ring.length; i += 1) {
    if (arc(ring[i], ring[0]) > arc(ring[far], ring[0])) far = i;
  }
  const tolerance = TOLERANCE_DEGREES * RADIANS;
  return [
    ...simplify(ring.slice(0, far + 1), tolerance).slice(0, -1),
    ...simplify(ring.slice(far), tolerance),
  ];
}

function area(ring) {
  let sum = 0;
  for (let i = 1; i < ring.length; i += 1) {
    const [x0, y0] = ring[i - 1];
    const [x1, y1] = ring[i];
    const scale = Math.cos(((y0 + y1) / 2) * RADIANS);
    sum += x0 * scale * y1 - x1 * scale * y0;
  }
  return Math.abs(sum) / 2;
}

function inside([longitude, latitude], ring) {
  let within = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (
      yi > latitude !== yj > latitude &&
      longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi
    )
      within = !within;
  }
  return within;
}

const round = (value) => Math.round(value * 100) / 100;
const kept = rings.filter((ring) => area(ring) >= MIN_AREA);
const coastlines = kept
  .map(simplifyRing)
  .filter((ring) => ring.length >= 4)
  .map((ring) => ring.map(([longitude, latitude]) => [round(latitude), round(longitude)]));

const landDots = [];
for (let latitude = -84; latitude <= 84; latitude += DOT_SPACING) {
  const step = DOT_SPACING / Math.max(Math.cos(latitude * RADIANS), 0.1);
  const count = Math.floor(360 / step);
  for (let index = 0; index < count; index += 1) {
    const longitude = -180 + (index + 0.5) * (360 / count);
    if (kept.some((ring) => inside([longitude, latitude], ring)))
      landDots.push([round(latitude), round(longitude)]);
  }
}

fs.writeFileSync(OUTPUT, `${JSON.stringify({ coastlines, landDots })}\n`);
console.log(
  `${coastlines.length} coastlines, ${coastlines.flat().length} points, ${landDots.length} land dots`,
);
