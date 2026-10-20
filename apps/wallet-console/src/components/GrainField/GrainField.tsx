import React from 'react';
import { useGrainFieldOverride } from './fieldOverride';
import { grainFieldSource, type GeneratedField, type GrainFieldName } from './fields';
import { addGrainField, type GrainFieldHandle } from './renderer';
import './GrainField.css';

type GrainFieldProps = {
  field: GrainFieldName | GeneratedField;
  /* false holds the current frame, e.g. while the field's menu is closed */
  playing?: boolean;
  className?: string;
  /* How far this field flows, as a multiple of the site style. The flow is
     measured in heights of the short side, so a wide banner, whose colours
     spread over its width, needs more of it to show the same movement. */
  flow?: number;
  /* How fast this field flows, as a multiple of the site style. */
  pace?: number;
};

const MAX_PIXEL_RATIO = 2;

/* A moving, grainy gradient that fills its positioned parent behind the
   parent's content. Reduced motion, an off-screen field and a hidden tab all
   hold the current frame. */
export function GrainField({
  field,
  playing = true,
  className,
  flow = 1,
  pace = 1,
}: GrainFieldProps): React.JSX.Element {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const handleRef = React.useRef<GrainFieldHandle | null>(null);
  /* the development gradient switcher can preview one field everywhere */
  const override = useGrainFieldOverride();
  const source = grainFieldSource(override ?? field);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const handle = addGrainField(canvas, source, flow, pace);
    handleRef.current = handle;
    const resizeObserver = new ResizeObserver(([entry]) => {
      const ratio = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);
      handle.setSize(entry.contentRect.width * ratio, entry.contentRect.height * ratio);
    });
    const intersectionObserver = new IntersectionObserver(
      ([entry]) => handle.setVisible(entry.isIntersecting),
      { rootMargin: '120px' },
    );
    resizeObserver.observe(canvas);
    intersectionObserver.observe(canvas);
    return () => {
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      handle.dispose();
      handleRef.current = null;
    };
  }, [source, flow, pace]);

  React.useEffect(() => {
    handleRef.current?.setPlaying(playing);
  }, [playing, source]);

  return (
    <canvas
      ref={canvasRef}
      className={className ? `grain-field ${className}` : 'grain-field'}
      style={{ backgroundColor: source.base }}
      aria-hidden
    />
  );
}
