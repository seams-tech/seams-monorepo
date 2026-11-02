import React from 'react';
import { ECOSYSTEM_LOGO_MARKS, type EcosystemLogoMark } from './ecosystemLogoTiles';

/* Integrations list: what Satyr can do with each tool and what it asks about
   first. The text follows Satyr's capability catalogue, so check it there
   before a change: an action marked approval-required must stay in `asks`.
   Each switch works, so a visitor can see what a disconnection does; it holds
   no state beyond this mock. */

type ToolAccess = { can: string; asks: string };

const TOOL_ACCESS: Partial<Record<string, ToolAccess>> = {
  slack: { can: 'Answers in your threads', asks: 'Posts a new message' },
  gmail: { can: 'Reads mail, writes reply drafts', asks: 'Sends a reply' },
  shopify: { can: 'Reads orders and products', asks: 'Cancels an order' },
  stripe: { can: 'Sees failed payments', asks: 'Refunds a payment' },
  googledrive: { can: 'Reads the files you approve', asks: 'Nothing. It only reads files.' },
};

const CAN_LABEL = 'Satyr can do';
const ASKS_LABEL = 'Satyr asks you first';

function ToolMark({ mark }: { mark: EcosystemLogoMark }): React.JSX.Element {
  return (
    <svg
      className="h2-access__mark"
      viewBox={mark.viewBox ?? '0 0 24 24'}
      aria-hidden
      focusable="false"
    >
      {mark.glyphs.map((glyph, i) => (
        <path key={i} d={glyph.d} fill={glyph.fill} fillRule={glyph.fillRule} />
      ))}
    </svg>
  );
}

function ToolRow({
  mark,
  access,
}: {
  mark: EcosystemLogoMark;
  access: ToolAccess;
}): React.JSX.Element {
  const [connected, setConnected] = React.useState(true);
  return (
    <li className={`h2-access__row${connected ? '' : ' is-off'}`}>
      <span className="h2-access__tool">
        <ToolMark mark={mark} />
        {mark.label}
      </span>
      {connected ? (
        <>
          <span className="h2-access__cell">
            <span className="h2-access__label">{CAN_LABEL}</span>
            {access.can}
          </span>
          <span className="h2-access__cell h2-access__cell--asks">
            <span className="h2-access__label">{ASKS_LABEL}</span>
            {access.asks}
          </span>
        </>
      ) : (
        <span className="h2-access__off">Disconnected. Satyr has no access.</span>
      )}
      <button
        type="button"
        className="h2-access__switch"
        role="switch"
        aria-checked={connected}
        aria-label={`${mark.label} connection`}
        onClick={() => setConnected((on) => !on)}
      >
        <span aria-hidden />
      </button>
    </li>
  );
}

export function EcosystemAccessList(): React.JSX.Element {
  return (
    <div className="h2-access">
      <div className="h2-access__head" aria-hidden>
        <span>Tool</span>
        <span>{CAN_LABEL}</span>
        <span>{ASKS_LABEL}</span>
      </div>
      <ul className="h2-access__rows">
        {ECOSYSTEM_LOGO_MARKS.map((mark) => {
          const access = TOOL_ACCESS[mark.id];
          return access ? <ToolRow key={mark.id} mark={mark} access={access} /> : null;
        })}
      </ul>
      <div className="h2-access__more">
        <span>Also connects to</span>
        {ECOSYSTEM_LOGO_MARKS.filter((mark) => !TOOL_ACCESS[mark.id]).map((mark) => (
          <span key={mark.id} className="h2-access__moretool">
            <ToolMark mark={mark} />
            {mark.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default EcosystemAccessList;
