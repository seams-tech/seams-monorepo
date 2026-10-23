import React from 'react';
import { ArrowUpRight, MoveHorizontal } from 'lucide-react';
import { t } from '@/marketing/i18n/browser';
import land from './globe-land.json';
import './regional-globe.css';

type Region = 'europe' | 'apac' | 'us';
type Position = { latitude: number; longitude: number };
type Drag = { kind: 'idle' } | { kind: 'dragging'; pointerId: number; x: number; y: number };

const REGIONS: Record<Region, Position> = {
  europe: { latitude: 49, longitude: 10 },
  apac: { latitude: 24, longitude: 115 },
  us: { latitude: 38, longitude: -98 },
};
const RADIANS = Math.PI / 180;

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

// Land dots sampled from Natural Earth 1:110m land polygons (public domain).
// Source: https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson
const LAND_POSITIONS: Position[] = land.map(toPosition);

function toPosition(coordinates: number[]): Position {
  return { latitude: coordinates[0], longitude: coordinates[1] };
}

export class RegionalGlobe extends React.Component<object, { region: Region }> {
  state: { region: Region } = { region: 'europe' };
  private canvas = React.createRef<HTMLCanvasElement>();
  private camera: Position = { latitude: 25, longitude: -12 };
  private target: Position = { ...this.camera };
  private velocity: Position = { latitude: 0, longitude: 0 };
  private drag: Drag = { kind: 'idle' };
  private frame = 0;
  private previousTime = 0;
  private resizeObserver: ResizeObserver | null = null;
  private reducedMotion: MediaQueryList | null = null;

  componentDidMount(): void {
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion.addEventListener('change', this.onMotionChange);
    this.resizeObserver = new ResizeObserver(this.draw);
    if (this.canvas.current) this.resizeObserver.observe(this.canvas.current);
    this.draw();
  }

  componentWillUnmount(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.reducedMotion?.removeEventListener('change', this.onMotionChange);
  }

  componentDidUpdate(): void {
    this.draw();
  }

  private onMotionChange = (): void => {
    if (!this.reducedMotion?.matches) return;
    this.stop();
    this.camera = { ...this.target };
    this.draw();
  };

  private stop(): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.previousTime = 0;
    this.velocity = { latitude: 0, longitude: 0 };
  }

  private selectRegion(region: Region, event: React.MouseEvent<HTMLButtonElement>): void {
    this.setState({ region });
    this.stop();
    this.target = {
      latitude: REGIONS[region].latitude - 12,
      longitude:
        this.camera.longitude + wrapLongitude(REGIONS[region].longitude - this.camera.longitude),
    };
    // Keyboard activation and reduced motion move directly to the chosen region.
    if (event.detail === 0 || this.reducedMotion?.matches) {
      this.camera = { ...this.target };
      this.draw();
      return;
    }
    this.frame = requestAnimationFrame(this.animate);
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
    // A damped spring moves the globe from its current orientation.
    for (const axis of ['latitude', 'longitude'] as const) {
      this.velocity[axis] +=
        ((this.target[axis] - this.camera[axis]) * 100 - this.velocity[axis] * 10) * delta;
      this.camera[axis] += this.velocity[axis] * delta;
    }
    const distance =
      Math.abs(this.target.latitude - this.camera.latitude) +
      Math.abs(this.target.longitude - this.camera.longitude);
    const speed = Math.abs(this.velocity.latitude) + Math.abs(this.velocity.longitude);
    if (distance < 0.02 && speed < 0.05) {
      this.camera = { ...this.target };
      this.stop();
    } else {
      this.frame = requestAnimationFrame(this.animate);
    }
    this.draw();
  };

  private onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!event.isPrimary || event.button !== 0) return;
    this.stop();
    this.drag = {
      kind: 'dragging',
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== event.pointerId) return;
    const scale = 180 / event.currentTarget.clientWidth;
    this.camera.longitude = wrapLongitude(
      this.camera.longitude - (event.clientX - this.drag.x) * scale,
    );
    this.camera.latitude = Math.max(
      -65,
      Math.min(65, this.camera.latitude + (event.clientY - this.drag.y) * scale),
    );
    this.drag = {
      kind: 'dragging',
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    this.target = { ...this.camera };
    this.draw();
  };

  private onPointerEnd = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (this.drag.kind !== 'dragging' || this.drag.pointerId !== event.pointerId) return;
    this.drag = { kind: 'idle' };
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  private onKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>): void => {
    let latitude = 0;
    let longitude = 0;
    switch (event.key) {
      case 'ArrowLeft':
        longitude = -15;
        break;
      case 'ArrowRight':
        longitude = 15;
        break;
      case 'ArrowUp':
        latitude = 10;
        break;
      case 'ArrowDown':
        latitude = -10;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.stop();
    this.camera = {
      latitude: Math.max(-65, Math.min(65, this.camera.latitude + latitude)),
      longitude: wrapLongitude(this.camera.longitude + longitude),
    };
    this.target = { ...this.camera };
    this.draw();
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
    const surface = context.createRadialGradient(
      centerX - radius * 0.3,
      centerY - radius * 0.4,
      radius * 0.1,
      centerX,
      centerY,
      radius,
    );
    surface.addColorStop(0, '#ffffff');
    surface.addColorStop(0.8, '#fcfbfa');
    surface.addColorStop(1, '#eeece9');
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.fillStyle = surface;
    context.fill();
    context.strokeStyle = '#e2dfdb';
    context.lineWidth = 0.8;
    context.stroke();
    const selected = REGIONS[this.state.region];
    for (const position of LAND_POSITIONS) {
      const point = project(position, this.camera);
      if (point.depth <= 0) continue;
      const nearRegion = project(position, selected).depth > 0.94;
      context.fillStyle = nearRegion
        ? `rgba(76, 132, 230, ${0.3 + point.depth * 0.6})`
        : `rgba(151, 146, 136, ${0.2 + point.depth * 0.55})`;
      context.beginPath();
      context.arc(
        centerX + point.x * radius,
        centerY - point.y * radius,
        Math.max(0.65, width / 400) * (0.5 + point.depth * 0.5),
        0,
        Math.PI * 2,
      );
      context.fill();
    }
    for (const region of ['europe', 'apac', 'us'] as const) {
      const point = project(REGIONS[region], this.camera);
      if (point.depth < 0.12) continue;
      const x = centerX + point.x * radius;
      const y = centerY - point.y * radius;
      context.beginPath();
      context.arc(x, y, 13, 0, Math.PI * 2);
      context.fillStyle = 'rgba(76, 132, 230, 0.12)';
      context.fill();
      context.beginPath();
      context.arc(x, y, 4, 0, Math.PI * 2);
      context.fillStyle = '#4c84e6';
      context.fill();
      if (region !== this.state.region) continue;
      context.beginPath();
      context.moveTo(x, y - 13);
      context.lineTo(x, y - 57);
      context.strokeStyle = '#b5bdca';
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
            <p className="h2-kicker">{t('globeEyebrow')}</p>
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
            <p className="wallet-regions__hint" id="wallet-regions-hint">
              <MoveHorizontal aria-hidden="true" />
              {t('globeHint')}
            </p>
          </div>
          <div className="wallet-regions__visual">
            <canvas
              ref={this.canvas}
              role="img"
              tabIndex={0}
              aria-label={t('globeAccessibleName')}
              aria-describedby="wallet-regions-hint"
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
