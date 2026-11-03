import React from 'react';
import '@/styles/h2-duo-tiles.css';

/* Real Portal cards, cropped from the Portal's preview pages with the sample
   café's data (public/satyr-portal/duo-*), stacked on one dot-cloud tile for each
   duo panel. Each card has its place on a 470 x 360 stage. */

const STAGE_WIDTH = 470;

type TileCard = {
  src: string;
  /* the image's own size, so the page does not move while it loads */
  size: readonly [number, number];
  left: number;
  top: number;
  width: number;
  /* a crop with no bottom edge fades out at its foot */
  fade?: boolean;
};

function DuoTile({ cards }: { cards: readonly TileCard[] }): React.JSX.Element {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return undefined;
    const fit = (): void => {
      stage.style.transform = `scale(${root.clientWidth / STAGE_WIDTH})`;
    };
    fit();
    const resize = new ResizeObserver(fit);
    resize.observe(root);
    return () => resize.disconnect();
  }, []);

  return (
    <div ref={rootRef} className="h2-duotile" aria-hidden>
      <div ref={stageRef} className="h2-duotile__stage">
        {cards.map((card) => (
          <img
            key={card.src}
            className={`h2-duotile__card${card.fade ? ' h2-duotile__card--fade' : ''}`}
            src={card.src}
            alt=""
            width={card.size[0]}
            height={card.size[1]}
            loading="lazy"
            decoding="async"
            style={{ left: card.left, top: card.top, width: card.width }}
          />
        ))}
      </div>
    </div>
  );
}

/* the agent's menu waits for approval, and its permission prompt asks first */
export function ShopTile(): React.JSX.Element {
  return (
    <DuoTile
      cards={[
        {
          src: '/satyr-portal/duo-menu.webp',
          size: [1216, 652],
          left: 30,
          top: 122,
          width: 296,
        },
        {
          src: '/satyr-portal/duo-permission.webp',
          size: [800, 1239],
          left: 256,
          top: 34,
          width: 186,
        },
      ]}
    />
  );
}

/* a late batch in the bakery, and a stock delivery that waits for approval */
export function KitchenTile(): React.JSX.Element {
  return (
    <DuoTile
      cards={[
        {
          src: '/satyr-portal/duo-details.webp',
          size: [720, 690],
          left: 228,
          top: 32,
          width: 212,
          fade: true,
        },
        {
          src: '/satyr-portal/duo-stock.webp',
          size: [1216, 672],
          left: 30,
          top: 164,
          width: 300,
        },
      ]}
    />
  );
}
