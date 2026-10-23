import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { t } from '@/marketing/i18n/browser';
import geography from './globe-geography.json';
import './regional-globe.css';

type Region = 'europe' | 'apac' | 'us';
type Position = { latitude: number; longitude: number };
type Drag = { kind: 'idle' } | { kind: 'dragging'; pointerId: number; x: number };
type Motion = { kind: 'rotating' } | { kind: 'focusing'; target: number; velocity: number };

const REGIONS: Record<Region, Position> = {
  europe: { latitude: 49, longitude: 10 },
  apac: { latitude: 24, longitude: 115 },
  us: { latitude: 38, longitude: -98 },
};
const RADIANS = Math.PI / 180;
const ROTATION_DEGREES_PER_SECOND = 3;

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

function project(position: Position, camera: Position): { x: number; y: number; depth: number } {
  const latitude = position.latitude * RADIANS;
  const longitude = (position.longitude - camera.longitude) * RADIANS;
  const tilt = camera.latitude * RADIANS;
  const z = Math.cos(latitude) * Math.cos(longitude);
  return {
    x: Math.cos(latitude) * Math.sin(longitude),
    y: Math.sin(latitude) * Math.cos(tilt) - z * Math.sin(tilt),
    depth: Math.sin(latitude) * Math.sin(tilt) + z * Math.cos(tilt),
  };
}

function wrapLongitude(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

// Coastlines and ocean-only grid samples from Natural Earth 1:110m land (public domain).
// Source: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson
const COASTLINES = geography.coastlines.map(toCoastline);
const OCEAN_GRID = geography.oceanGrid.map(toPosition);

function toCoastline(coordinates: number[][]): Position[] {
  return coordinates.map(toPosition);
}

function toPosition(coordinates: number[]): Position {
  return { latitude: coordinates[0], longitude: coordinates[1] };
}

function traceCoastline(
  context: CanvasRenderingContext2D,
  coastline: Position[],
  camera: Position,
  centerX: number,
  centerY: number,
  radius: number,
): void {
  let previous = project(coastline[0], camera);
  if (previous.depth >= 0)
    context.moveTo(centerX + previous.x * radius, centerY - previous.y * radius);
  for (let index = 1; index < coastline.length; index += 1) {
    const point = project(coastline[index], camera);
    // Natural Earth closes polygons at the date line; those edges are not coastlines.
    if (
      Math.abs(coastline[index - 1].longitude) === 180 &&
      Math.abs(coastline[index].longitude) === 180
    ) {
      if (point.depth >= 0) context.moveTo(centerX + point.x * radius, centerY - point.y * radius);
      previous = point;
      continue;
    }
    if (previous.depth >= 0 !== point.depth >= 0) {
      // End each visible segment exactly on the horizon, including polar coastlines.
      const fraction = previous.depth / (previous.depth - point.depth);
      const x = previous.x + (point.x - previous.x) * fraction;
      const y = previous.y + (point.y - previous.y) * fraction;
      const length = Math.hypot(x, y);
      const edgeX = centerX + (x / length) * radius;
      const edgeY = centerY - (y / length) * radius;
      if (point.depth >= 0) context.moveTo(edgeX, edgeY);
      else context.lineTo(edgeX, edgeY);
    }
    if (point.depth >= 0) context.lineTo(centerX + point.x * radius, centerY - point.y * radius);
    previous = point;
  }
}

export class RegionalGlobe extends React.Component<object, { region: Region }> {
  state: { region: Region } = { region: 'apac' };
  private canvas = React.createRef<HTMLCanvasElement>();
  private camera: Position = { latitude: 25, longitude: REGIONS.apac.longitude };
  private motion: Motion = { kind: 'rotating' };
  private drag: Drag = { kind: 'idle' };
  private frame = 0;
  private previousTime = 0;
  private resizeObserver: ResizeObserver | null = null;
  private visibilityObserver: IntersectionObserver | null = null;
  private visible = false;
  private reducedMotion: MediaQueryList | null = null;

  componentDidMount(): void {
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion.addEventListener('change', this.onMotionChange);
    this.resizeObserver = new ResizeObserver(this.draw);
    this.visibilityObserver = new IntersectionObserver(this.onVisibilityChange);
    if (this.canvas.current) {
      this.resizeObserver.observe(this.canvas.current);
      this.visibilityObserver.observe(this.canvas.current);
    }
    document.addEventListener('visibilitychange', this.onDocumentVisibilityChange);
    this.draw();
  }

  componentWillUnmount(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.visibilityObserver?.disconnect();
    document.removeEventListener('visibilitychange', this.onDocumentVisibilityChange);
    this.reducedMotion?.removeEventListener('change', this.onMotionChange);
  }

  componentDidUpdate(): void {
    this.draw();
  }

  private onMotionChange = (): void => {
    if (this.reducedMotion?.matches) {
      this.stop();
      if (this.motion.kind === 'focusing') this.camera.longitude = this.motion.target;
      this.motion = { kind: 'rotating' };
      this.draw();
    } else {
      this.start();
    }
  };

  private onVisibilityChange = (entries: IntersectionObserverEntry[]): void => {
    this.visible = entries[0].isIntersecting;
    this.onDocumentVisibilityChange();
  };

  private onDocumentVisibilityChange = (): void => {
    if (!this.visible || document.hidden) this.stop();
    else this.start();
  };

  private start(): void {
    if (
      this.frame ||
      !this.visible ||
      document.hidden ||
      this.reducedMotion?.matches ||
      this.drag.kind === 'dragging'
    )
      return;
    this.frame = requestAnimationFrame(this.animate);
  }

  private stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.previousTime = 0;
  }

  private selectRegion(region: Region, event: React.MouseEvent<HTMLButtonElement>): void {
    this.setState({ region });
    this.stop();
    const target =
      this.camera.longitude + wrapLongitude(REGIONS[region].longitude - this.camera.longitude);
    // Keyboard activation and reduced motion move directly to the chosen region.
    if (event.detail === 0 || this.reducedMotion?.matches) {
      this.camera.longitude = target;
      this.motion = { kind: 'rotating' };
      this.draw();
      this.start();
      return;
    }
    this.motion = { kind: 'focusing', target, velocity: 0 };
    this.start();
  }

  private selectEurope = (event: React.MouseEvent<HTMLButtonElement>): void => {
    this.selectRegion('europe', event);
  };

  private selectApac = (event: React.MouseEvent<HTMLButtonElement>): void => {
    this.selectRegion('apac', event);
  };

  private selectUs = (event: React.MouseEvent<HTMLButtonElement>): void => {
    this.selectRegion('us', event);
  };

  private animate = (time: number): void => {
    const delta =
      this.previousTime === 0 ? 1 / 60 : Math.min((time - this.previousTime) / 1000, 1 / 30);
    this.previousTime = time;
    if (this.motion.kind === 'focusing') {
      const distance = this.motion.target - this.camera.longitude;
      this.motion.velocity += (distance * 100 - this.motion.velocity * 20) * delta;
      this.camera.longitude += this.motion.velocity * delta;
      if (Math.abs(distance) < 0.02 && Math.abs(this.motion.velocity) < 0.05) {
        this.camera.longitude = this.motion.target;
        this.motion = { kind: 'rotating' };
      }
    } else {
      this.camera.longitude = wrapLongitude(
        this.camera.longitude + ROTATION_DEGREES_PER_SECOND * delta,
      );
    }
    this.draw();
    this.frame = requestAnimationFrame(this.animate);
  };

  private onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!event.isPrimary || event.button !== 0) return;
    this.stop();
    this.motion = { kind: 'rotating' };
    this.drag = {
      kind: 'dragging',
      pointerId: event.pointerId,
      x: event.clientX,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== event.pointerId) return;
    const scale = 180 / event.currentTarget.clientWidth;
    this.camera.longitude = wrapLongitude(
      this.camera.longitude - (event.clientX - this.drag.x) * scale,
    );
    this.drag = {
      kind: 'dragging',
      pointerId: event.pointerId,
      x: event.clientX,
    };
    this.draw();
  };

  private onPointerEnd = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== event.pointerId) return;
    this.drag = { kind: 'idle' };
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    this.start();
  };

  private onKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>): void => {
    let longitude = 0;
    switch (event.key) {
      case 'ArrowLeft':
        longitude = -15;
        break;
      case 'ArrowRight':
        longitude = 15;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.stop();
    this.motion = { kind: 'rotating' };
    this.camera.longitude = wrapLongitude(this.camera.longitude + longitude);
    this.draw();
    this.start();
  };

  private draw = (): void => {
    const canvas = this.canvas.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const radius = width * 0.46;
    const centerX = width * 0.53;
    const centerY = height * 0.6;
    context.lineWidth = 0.75;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.fillStyle = '#c7c5ca';
    context.beginPath();
    for (const position of OCEAN_GRID) {
      const point = project(position, this.camera);
      if (point.depth <= 0) continue;
      const x = centerX + point.x * radius;
      const y = centerY - point.y * radius;
      context.moveTo(x + 0.55, y);
      context.arc(x, y, 0.55, 0, Math.PI * 2);
    }
    context.fill();
    context.beginPath();
    for (const coastline of COASTLINES) {
      traceCoastline(context, coastline, this.camera, centerX, centerY, radius);
    }
    context.strokeStyle = '#77757e';
    context.stroke();
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.strokeStyle = '#a5a3ab';
    context.stroke();
    for (const region of ['europe', 'apac', 'us'] as const) {
      const point = project(REGIONS[region], this.camera);
      if (point.depth < 0.12) continue;
      const x = centerX + point.x * radius;
      const y = centerY - point.y * radius;
      context.beginPath();
      context.arc(x, y, 13, 0, Math.PI * 2);
      context.strokeStyle = '#c7c5ca';
      context.stroke();
      context.beginPath();
      context.arc(x, y, 8, 0, Math.PI * 2);
      context.strokeStyle = '#a5a3ab';
      context.stroke();
      context.beginPath();
      context.arc(x, y, 4, 0, Math.PI * 2);
      context.fillStyle = '#44403b';
      context.fill();
      if (region !== this.state.region) continue;
      context.beginPath();
      context.moveTo(x, y - 13);
      context.lineTo(x, y - 57);
      context.strokeStyle = '#77757e';
      context.stroke();
      context.font = '500 14px "Hanken Grotesk", sans-serif';
      const label = regionName(region);
      const labelWidth = context.measureText(label).width + 32;
      context.beginPath();
      context.roundRect(x - labelWidth / 2, y - 91, labelWidth, 34, 17);
      context.fillStyle = '#ffffff';
      context.fill();
      context.strokeStyle = '#dedbd7';
      context.stroke();
      context.fillStyle = '#44403b';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(label, x, y - 74);
    }
  };

  render(): React.JSX.Element {
    return (
      <section className="wallet-regions h2-rule" aria-labelledby="wallet-regions-title">
        <div className="wallet-regions__card">
          <div className="wallet-regions__copy">
            <h2 id="wallet-regions-title">
              {t('globeTitle')}
              <br />
              <span>{t('globeTitleMuted')}</span>
            </h2>
            <p className="wallet-regions__description">{t('globeDescription')}</p>
            <div className="wallet-regions__choices" role="group" aria-label={t('globeRegions')}>
              <button
                type="button"
                aria-pressed={this.state.region === 'europe'}
                onClick={this.selectEurope}
              >
                {t('globeEurope')}
                <ArrowUpRight aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-pressed={this.state.region === 'apac'}
                onClick={this.selectApac}
              >
                {t('globeApac')}
                <ArrowUpRight aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-pressed={this.state.region === 'us'}
                onClick={this.selectUs}
              >
                {t('globeUs')}
                <ArrowUpRight aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="wallet-regions__visual">
            <canvas
              ref={this.canvas}
              role="img"
              tabIndex={0}
              aria-label={t('globeAccessibleName')}
              onPointerDown={this.onPointerDown}
              onPointerMove={this.onPointerMove}
              onPointerUp={this.onPointerEnd}
              onPointerCancel={this.onPointerEnd}
              onLostPointerCapture={this.onPointerEnd}
              onKeyDown={this.onKeyDown}
            />
          </div>
        </div>
      </section>
    );
  }
}
