import React from 'react';
import { t } from './i18n';
import geography from './globe-geography.json';
import './regional-globe.css';

type Region = 'apac' | 'europe' | 'us';
type Position = { latitude: number; longitude: number };
type Point = { x: number; y: number; depth: number };
// The globe rests on APAC. Playing turns it west to Europe and the US; at rest
// again it turns back by the shortest way, as a Hairline figure reverses.
type Motion =
  | { kind: 'rest' }
  | { kind: 'playing'; start: number }
  | { kind: 'returning'; start: number; from: Position };

const REGIONS: Record<Region, Position> = {
  apac: { latitude: 24, longitude: 115 },
  europe: { latitude: 49, longitude: 10 },
  us: { latitude: 38, longitude: -98 },
};
const REGION_ORDER = ['apac', 'europe', 'us'] as const;
// The camera's play: where it looks, and when it arrives there, in ms.
const PLAY: readonly { at: number; camera: Position }[] = [
  { at: 0, camera: { latitude: 22, longitude: 115 } },
  { at: 1100, camera: { latitude: 32, longitude: 10 } },
  { at: 1700, camera: { latitude: 32, longitude: 10 } },
  { at: 2800, camera: { latitude: 28, longitude: -98 } },
];
const REST = PLAY[0].camera;
const RETURN_MS = 1100;
const RADIANS = Math.PI / 180;
// The 400 by 340 drawing: the sphere's centre and radius. The sphere runs
// past the drawing's bottom and right edges, and the card clips it.
const CENTER = { x: 214, y: 236 };
const RADIUS = 206;
// Angular radii in degrees of the rings that lie on the globe around each region.
const RING_DEGREES = [1.6, 3.2, 5] as const;
const GRATICULE_DEGREES = 30;
// Height of a connector's midpoint above the surface, as a share of the radius.
const CONNECTOR_LIFT = 0.1;
// A land cell's hexagon, as a share of the circumradius that would close the
// gaps between cells.
const CELL_FILL = 0.8;
// Opacity of a cell at the horizon and facing the viewer.
const CELL_OPACITY = [0.35, 1] as const;
const CELL_OPACITY_STEPS = 6;
const VIEW_BOX = { width: 400, height: 340 };

// Hairline's easing for every move: cubic-bezier(0.5, 0, 0.1, 1).
function ease(progress: number): number {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const curve = (a: number, b: number, u: number) =>
    3 * a * u * (1 - u) ** 2 + 3 * b * u ** 2 * (1 - u) + u ** 3;
  let low = 0;
  let high = 1;
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2;
    if (curve(0.5, 0.1, middle) < progress) low = middle;
    else high = middle;
  }
  return curve(0, 1, (low + high) / 2);
}

function wrapLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

function between(from: Position, to: Position, progress: number): Position {
  const turn = wrapLongitude(to.longitude - from.longitude);
  return {
    latitude: from.latitude + (to.latitude - from.latitude) * progress,
    longitude: wrapLongitude(from.longitude + turn * progress),
  };
}

function playCamera(elapsed: number): Position {
  for (let index = 1; index < PLAY.length; index += 1) {
    const previous = PLAY[index - 1];
    const next = PLAY[index];
    if (elapsed < next.at) {
      return between(
        previous.camera,
        next.camera,
        ease((elapsed - previous.at) / (next.at - previous.at)),
      );
    }
  }
  return PLAY[PLAY.length - 1].camera;
}

function project(position: Position, camera: Position, lift = 0): Point {
  const latitude = position.latitude * RADIANS;
  const longitude = (position.longitude - camera.longitude) * RADIANS;
  const tilt = camera.latitude * RADIANS;
  const z = Math.cos(latitude) * Math.cos(longitude);
  const scale = 1 + lift;
  return {
    x: Math.cos(latitude) * Math.sin(longitude) * scale,
    y: (Math.sin(latitude) * Math.cos(tilt) - z * Math.sin(tilt)) * scale,
    depth: (Math.sin(latitude) * Math.sin(tilt) + z * Math.cos(tilt)) * scale,
  };
}

const screenX = (point: { x: number }) => (CENTER.x + point.x * RADIUS).toFixed(1);
const screenY = (point: { y: number }) => (CENTER.y - point.y * RADIUS).toFixed(1);

// Path data for a line on the surface: only its near side, each visible run
// ending exactly on the horizon.
function surfacePath(line: readonly Position[], camera: Position): string {
  let path = '';
  let previous = project(line[0], camera);
  if (previous.depth >= 0) path += `M${screenX(previous)} ${screenY(previous)}`;
  for (let index = 1; index < line.length; index += 1) {
    const point = project(line[index], camera);
    if (previous.depth >= 0 !== point.depth >= 0) {
      const fraction = previous.depth / (previous.depth - point.depth);
      const x = previous.x + (point.x - previous.x) * fraction;
      const y = previous.y + (point.y - previous.y) * fraction;
      const length = Math.hypot(x, y);
      const edge = { x: x / length, y: y / length };
      path += `${point.depth >= 0 ? 'M' : 'L'}${screenX(edge)} ${screenY(edge)}`;
    }
    if (point.depth >= 0) path += `L${screenX(point)} ${screenY(point)}`;
    previous = point;
  }
  return path;
}

// Path data for an arc above the surface: a point is hidden only while the
// sphere stands between it and the viewer.
function liftedPath(
  points: readonly { position: Position; lift: number }[],
  camera: Position,
): string {
  let path = '';
  let drawing = false;
  for (const { position, lift } of points) {
    const point = project(position, camera, lift);
    const visible = point.depth >= 0 || Math.hypot(point.x, point.y) > 1;
    if (visible) path += `${drawing ? 'L' : 'M'}${screenX(point)} ${screenY(point)}`;
    drawing = visible;
  }
  return path;
}

// A small circle on the sphere, so each ring foreshortens with the surface.
function surfaceRing(center: Position, degrees: number): Position[] {
  const latitude = center.latitude * RADIANS;
  const distance = degrees * RADIANS;
  const ring: Position[] = [];
  for (let step = 0; step <= 48; step += 1) {
    const bearing = (step / 48) * Math.PI * 2;
    const pointLatitude = Math.asin(
      Math.sin(latitude) * Math.cos(distance) +
        Math.cos(latitude) * Math.sin(distance) * Math.cos(bearing),
    );
    const longitude = Math.atan2(
      Math.sin(bearing) * Math.sin(distance) * Math.cos(latitude),
      Math.cos(distance) - Math.sin(latitude) * Math.sin(pointLatitude),
    );
    ring.push({
      latitude: pointLatitude / RADIANS,
      longitude: center.longitude + longitude / RADIANS,
    });
  }
  return ring;
}

// The great circle between two regions, raised into an arc.
function connector(from: Position, to: Position): { position: Position; lift: number }[] {
  const vector = ({ latitude, longitude }: Position) => [
    Math.cos(latitude * RADIANS) * Math.cos(longitude * RADIANS),
    Math.cos(latitude * RADIANS) * Math.sin(longitude * RADIANS),
    Math.sin(latitude * RADIANS),
  ];
  const [a, b] = [vector(from), vector(to)];
  const angle = Math.acos(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
  const points: { position: Position; lift: number }[] = [];
  for (let step = 0; step <= 64; step += 1) {
    const share = step / 64;
    const wa = Math.sin((1 - share) * angle) / Math.sin(angle);
    const wb = Math.sin(share * angle) / Math.sin(angle);
    const [x, y, z] = [0, 1, 2].map((axis) => a[axis] * wa + b[axis] * wb);
    points.push({
      position: { latitude: Math.asin(z) / RADIANS, longitude: Math.atan2(y, x) / RADIANS },
      lift: CONNECTOR_LIFT * Math.sin(share * Math.PI),
    });
  }
  return points;
}

// Natural Earth 1:110m land (public domain) as a hexagonal grid of cells,
// written by scripts/globe-geography.mjs.
function landCells(): Position[] {
  const cells: Position[] = [];
  for (const [latitude, count, offset, runs] of geography.rows) {
    if (
      typeof latitude !== 'number' ||
      typeof count !== 'number' ||
      typeof offset !== 'number' ||
      !Array.isArray(runs)
    ) {
      throw new Error('Malformed globe geography row');
    }
    for (let index = 0; index < runs.length; index += 2) {
      for (let cell = runs[index]; cell < runs[index] + runs[index + 1]; cell += 1) {
        cells.push({ latitude, longitude: -180 + ((cell + offset) * 360) / count });
      }
    }
  }
  return cells;
}

const CELL_RADIUS = (geography.spacing / Math.sqrt(3)) * CELL_FILL;
const HEXAGON = Array.from({ length: 6 }, (_, corner) => {
  const angle = (30 + corner * 60) * RADIANS;
  return { east: Math.cos(angle), north: Math.sin(angle) };
});

function unitVector({ latitude, longitude }: Position): [number, number, number] {
  const lat = latitude * RADIANS;
  const lon = longitude * RADIANS;
  return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
}

// Nine numbers per cell: its centre on the unit sphere, then the offsets to
// the hexagon's east and north extents. A frame only rotates them.
const CELLS = (() => {
  const cells = landCells();
  const vectors = new Float32Array(cells.length * 9);
  cells.forEach((cell, index) => {
    const center = unitVector(cell);
    const east = unitVector({
      latitude: cell.latitude,
      longitude: cell.longitude + CELL_RADIUS / Math.cos(cell.latitude * RADIANS),
    });
    const north = unitVector({ latitude: cell.latitude + CELL_RADIUS, longitude: cell.longitude });
    for (let axis = 0; axis < 3; axis += 1) {
      vectors[index * 9 + axis] = center[axis];
      vectors[index * 9 + 3 + axis] = east[axis] - center[axis];
      vectors[index * 9 + 6 + axis] = north[axis] - center[axis];
    }
  });
  return vectors;
})();

// Draws every land cell on the near side as a hexagon that lies on the
// sphere: its corners follow the surface's east and north directions, so the
// cells foreshorten towards the horizon. Opacity falls with the cells' depth.
// The rotation is project() written as a matrix on unit vectors.
function drawLand(
  context: CanvasRenderingContext2D,
  camera: Position,
  scale: number,
  color: string,
): void {
  const sinL = Math.sin(camera.longitude * RADIANS);
  const cosL = Math.cos(camera.longitude * RADIANS);
  const sinT = Math.sin(camera.latitude * RADIANS);
  const cosT = Math.cos(camera.latitude * RADIANS);
  const size = RADIUS * scale;
  const originX = CENTER.x * scale;
  const originY = CENTER.y * scale;
  const buckets: Path2D[] = Array.from({ length: CELL_OPACITY_STEPS }, () => new Path2D());
  for (let index = 0; index < CELLS.length; index += 9) {
    const [cx, cy, cz] = [CELLS[index], CELLS[index + 1], CELLS[index + 2]];
    const facing = cosL * cx + sinL * cy;
    const depth = cosT * facing + sinT * cz;
    if (depth <= 0.02) continue;
    const x = originX + (cosL * cy - sinL * cx) * size;
    const y = originY - (cosT * cz - sinT * facing) * size;
    const [ex, ey, ez] = [CELLS[index + 3], CELLS[index + 4], CELLS[index + 5]];
    const [nx, ny, nz] = [CELLS[index + 6], CELLS[index + 7], CELLS[index + 8]];
    const eastX = (cosL * ey - sinL * ex) * size;
    const eastY = -(cosT * ez - sinT * (cosL * ex + sinL * ey)) * size;
    const northX = (cosL * ny - sinL * nx) * size;
    const northY = -(cosT * nz - sinT * (cosL * nx + sinL * ny)) * size;
    const path = buckets[Math.min(CELL_OPACITY_STEPS - 1, Math.floor(depth * CELL_OPACITY_STEPS))];
    for (let corner = 0; corner < 6; corner += 1) {
      const { east, north } = HEXAGON[corner];
      const px = x + eastX * east + northX * north;
      const py = y + eastY * east + northY * north;
      if (corner === 0) path.moveTo(px, py);
      else path.lineTo(px, py);
    }
    // No closePath(): a fill closes each hexagon, and Chromium's Path2D
    // closePath slows with every subpath already in the path.
  }
  context.fillStyle = color;
  buckets.forEach((path, step) => {
    const share = (step + 0.5) / CELL_OPACITY_STEPS;
    context.globalAlpha = CELL_OPACITY[0] + (CELL_OPACITY[1] - CELL_OPACITY[0]) * share;
    context.fill(path);
  });
  context.globalAlpha = 1;
}

const GRATICULE: Position[][] = [];
for (let longitude = -180; longitude < 180; longitude += GRATICULE_DEGREES) {
  const meridian: Position[] = [];
  for (let latitude = -90; latitude <= 90; latitude += 3) meridian.push({ latitude, longitude });
  GRATICULE.push(meridian);
}
for (let latitude = -60; latitude <= 60; latitude += GRATICULE_DEGREES) {
  const parallel: Position[] = [];
  for (let longitude = -180; longitude <= 180; longitude += 3)
    parallel.push({ latitude, longitude });
  GRATICULE.push(parallel);
}

const RINGS: Record<Region, Position[][]> = {
  apac: RING_DEGREES.map((degrees) => surfaceRing(REGIONS.apac, degrees)),
  europe: RING_DEGREES.map((degrees) => surfaceRing(REGIONS.europe, degrees)),
  us: RING_DEGREES.map((degrees) => surfaceRing(REGIONS.us, degrees)),
};
const CONNECTORS = [connector(REGIONS.apac, REGIONS.europe), connector(REGIONS.europe, REGIONS.us)];

function regionName(region: Region): string {
  switch (region) {
    case 'europe':
      return t('globeEurope');
    case 'apac':
      return t('globeApac');
    case 'us':
      return t('globeUs');
  }
}

type RegionMarks = {
  group: SVGGElement | null;
  rings: (SVGPathElement | null)[];
  dot: SVGCircleElement | null;
  leader: SVGLineElement | null;
  label: SVGTextElement | null;
};

export class RegionalGlobe extends React.Component {
  private graticule = React.createRef<SVGPathElement>();
  private land = React.createRef<HTMLCanvasElement>();
  private resizeObserver: ResizeObserver | null = null;
  // Read only when the canvas resizes: a read during a frame, after its SVG
  // writes, would force the page's style and layout.
  private landBox = { width: 0, height: 0, color: '' };
  private connectors = CONNECTORS.map(() => React.createRef<SVGPathElement>());
  private marks: Record<Region, RegionMarks> = {
    apac: { group: null, rings: [], dot: null, leader: null, label: null },
    europe: { group: null, rings: [], dot: null, leader: null, label: null },
    us: { group: null, rings: [], dot: null, leader: null, label: null },
  };
  private stage = React.createRef<HTMLDivElement>();
  private camera: Position = REST;
  private motion: Motion = { kind: 'rest' };
  private frame = 0;
  private mouseInside = false;
  private keyboardActive = false;
  private reducedMotion: MediaQueryList | null = null;

  componentDidMount(): void {
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.resizeObserver = new ResizeObserver(this.measureLand);
    if (this.land.current) this.resizeObserver.observe(this.land.current);
    this.measureLand();
  }

  componentWillUnmount(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
  }

  // The globe plays while the mouse or the keyboard wants it, and returns to
  // rest when neither does.
  private update(): void {
    const wanted = this.mouseInside || this.keyboardActive;
    const playing = this.motion.kind === 'playing';
    if (wanted === playing) return;
    this.stage.current?.setAttribute('aria-pressed', String(wanted));
    const now = performance.now();
    this.motion = wanted
      ? { kind: 'playing', start: now }
      : { kind: 'returning', start: now, from: this.camera };
    if (this.reducedMotion?.matches) {
      this.camera = wanted ? PLAY[PLAY.length - 1].camera : REST;
      this.motion = wanted ? this.motion : { kind: 'rest' };
      this.draw();
      return;
    }
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.animate);
  }

  private animate = (now: number): void => {
    const motion = this.motion;
    let done = true;
    switch (motion.kind) {
      case 'rest':
        break;
      case 'playing': {
        const elapsed = now - motion.start;
        this.camera = playCamera(elapsed);
        done = elapsed >= PLAY[PLAY.length - 1].at;
        break;
      }
      case 'returning': {
        const progress = (now - motion.start) / RETURN_MS;
        this.camera = between(motion.from, REST, ease(progress));
        done = progress >= 1;
        if (done) this.motion = { kind: 'rest' };
        break;
      }
    }
    this.draw();
    this.frame = done ? 0 : requestAnimationFrame(this.animate);
  };

  private onPointerEnter = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType !== 'mouse') return;
    this.mouseInside = true;
    this.update();
  };

  private onPointerLeave = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType !== 'mouse') return;
    this.mouseInside = false;
    this.update();
  };

  // Enter, Space or a tap toggles the globe.
  private toggle(): void {
    this.keyboardActive = this.motion.kind !== 'playing';
    this.update();
  }

  private onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.pointerType === 'touch') this.toggle();
  };

  private onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.toggle();
  };

  private onBlur = (): void => {
    this.keyboardActive = false;
    this.update();
  };

  private draw(): void {
    const camera = this.camera;
    this.graticule.current?.setAttribute(
      'd',
      GRATICULE.map((line) => surfacePath(line, camera)).join(''),
    );
    this.drawLand();
    CONNECTORS.forEach((points, index) => {
      this.connectors[index].current?.setAttribute('d', liftedPath(points, camera));
    });
    const points = REGION_ORDER.map((region) => ({
      region,
      point: project(REGIONS[region], camera),
    }));
    const nearest = Math.max(...points.map(({ point }) => point.depth));
    for (const { region, point } of points) {
      const marks = this.marks[region];
      // Each figure has one highlight: the region nearest the viewer.
      marks.group?.setAttribute('data-selected', String(point.depth === nearest));
      marks.group?.setAttribute('visibility', point.depth >= 0.4 ? 'visible' : 'hidden');
      marks.rings.forEach((ring, index) => {
        ring?.setAttribute('d', surfacePath(RINGS[region][index], camera));
      });
      const x = screenX(point);
      const y = CENTER.y - point.y * RADIUS;
      const leaderStart = y - RING_DEGREES[RING_DEGREES.length - 1] * RADIANS * RADIUS - 3;
      marks.dot?.setAttribute('cx', x);
      marks.dot?.setAttribute('cy', y.toFixed(1));
      marks.leader?.setAttribute('x1', x);
      marks.leader?.setAttribute('x2', x);
      marks.leader?.setAttribute('y1', leaderStart.toFixed(1));
      marks.leader?.setAttribute('y2', (leaderStart - 22).toFixed(1));
      marks.label?.setAttribute('x', x);
      marks.label?.setAttribute('y', (leaderStart - 27).toFixed(1));
    }
  }

  // The canvas lies between the two SVG layers and maps the same view box the
  // way they do: scaled to fit, centred.
  private measureLand = (): void => {
    const canvas = this.land.current;
    if (!canvas) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    this.landBox = {
      width,
      height,
      color: getComputedStyle(canvas).getPropertyValue('--hl-mid').trim(),
    };
    this.draw();
  };

  private drawLand(): void {
    const context = this.land.current?.getContext('2d');
    const { width, height, color } = this.landBox;
    if (!context || width === 0 || height === 0) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const scale = Math.min(width / VIEW_BOX.width, height / VIEW_BOX.height);
    context.setTransform(
      ratio,
      0,
      0,
      ratio,
      ((width - VIEW_BOX.width * scale) / 2) * ratio,
      ((height - VIEW_BOX.height * scale) / 2) * ratio,
    );
    context.clearRect(-width, -height, width * 3, height * 3);
    drawLand(context, this.camera, scale, color);
  }

  render(): React.JSX.Element {
    return (
      <section
        id="global"
        className="wallet-regions features-anchor h2-rule"
        aria-labelledby="wallet-regions-title"
      >
        <div className="wallet-regions__card">
          <div className="wallet-regions__copy">
            <h2 id="wallet-regions-title">
              {t('globeTitle')}
              <br />
              <span>{t('globeTitleMuted')}</span>
            </h2>
            <p className="wallet-regions__description">{t('globeDescription')}</p>
          </div>
          <div
            ref={this.stage}
            className="wallet-regions__visual"
            role="button"
            tabIndex={0}
            aria-label={t('globeAccessibleName')}
            aria-pressed="false"
            onPointerEnter={this.onPointerEnter}
            onPointerLeave={this.onPointerLeave}
            onPointerUp={this.onPointerUp}
            onKeyDown={this.onKeyDown}
            onBlur={this.onBlur}
          >
            <svg className="wallet-regions__globe" viewBox="0 0 400 340" aria-hidden="true">
              <circle className="fo" cx={CENTER.x} cy={CENTER.y} r={RADIUS} />
              <path ref={this.graticule} className="nf lo dash" />
            </svg>
            <canvas ref={this.land} className="wallet-regions__land" aria-hidden="true" />
            <svg className="wallet-regions__globe" viewBox="0 0 400 340" aria-hidden="true">
              <circle className="nf sil" cx={CENTER.x} cy={CENTER.y} r={RADIUS} />
              {this.connectors.map((ref, index) => (
                <path key={index} ref={ref} className="nf sil" />
              ))}
              {REGION_ORDER.map((region) => (
                <g
                  key={region}
                  className="wallet-regions__region"
                  ref={(group) => {
                    this.marks[region].group = group;
                  }}
                >
                  {RING_DEGREES.map((degrees, index) => (
                    <path
                      key={degrees}
                      className={`nf ring-${index}`}
                      ref={(ring) => {
                        this.marks[region].rings[index] = ring;
                      }}
                    />
                  ))}
                  <circle
                    className="dot"
                    r={2}
                    ref={(dot) => {
                      this.marks[region].dot = dot;
                    }}
                  />
                  <line
                    className="dash sil"
                    ref={(leader) => {
                      this.marks[region].leader = leader;
                    }}
                  />
                  <text
                    textAnchor="middle"
                    ref={(label) => {
                      this.marks[region].label = label;
                    }}
                  >
                    {regionName(region)}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        </div>
      </section>
    );
  }
}
