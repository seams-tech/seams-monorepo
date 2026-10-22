import React from 'react';
import { createRoot } from 'react-dom/client';
import '@seams/wallet/react/styles';
import '@/app.css';
import '@/styles/h2.css';
import previousKeychain from '../../../showcase/motion/credentials/index.html?raw';
import previousInterlock from '../../../showcase/motion/interlock/index.html?raw';
import previousDevices from '../../../showcase/motion/delegation/index.html?raw';
import previousInfrastructure from '../../../showcase/motion/infrastructure-array/index.html?raw';
import bladeInterlock from '../../../showcase/motion/interlock-blade/index.html?raw';
import edgeKeys from '../../../showcase/motion/keys-edge/index.html?raw';
import edgeInterlock from '../../../showcase/motion/interlock-edge/index.html?raw';
import edgeDevices from '../../../showcase/motion/devices-edge/index.html?raw';
import edgePlatforms from '../../../showcase/motion/lockin-edge/index.html?raw';
import { H2Security } from './sections';
import {
  candidateFigureDocument,
  WalletFigure,
  WalletFigureCandidates,
  type WalletFigureName,
} from './WalletFigure';

/* Dev-only page (/figure-review/ on the dev server, not in the build): each
   candidate beside the live figure it would replace, each live custody figure
   beside the detailed figure it replaced, all at the page's cell size, then
   the real custody section as it ships. */

type Review = { figure: WalletFigureName; label: string; html: string };

const candidates: readonly Review[] = [
  { figure: 'keychain', label: 'Keys you control: edge, dot code', html: edgeKeys },
  {
    figure: 'keychain',
    label: 'Keys you control: edge, teeth',
    html: edgeKeys.replace("const BIT = 'dots'", "const BIT = 'teeth'"),
  },
  { figure: 'interlock', label: 'Scoped permissions: flat blade', html: bladeInterlock },
  { figure: 'interlock', label: 'Scoped permissions: edge', html: edgeInterlock },
  { figure: 'devices', label: 'Linked devices: edge', html: edgeDevices },
  { figure: 'infrastructure', label: 'No lock-in: edge', html: edgePlatforms },
];

const reviews: readonly Review[] = [
  { figure: 'keychain', label: 'Keys you control', html: previousKeychain },
  { figure: 'interlock', label: 'Scoped permissions', html: previousInterlock },
  { figure: 'devices', label: 'Linked devices', html: previousDevices },
  { figure: 'infrastructure', label: 'No lock-in', html: previousInfrastructure },
];

function ReviewPair({
  review: { figure, label, html },
  other,
  playing,
}: {
  review: Review;
  /* the caption of the right cell, which shows the review's drawing */
  other: string;
  playing: boolean;
}): React.JSX.Element {
  const swap = React.useMemo(
    () => ({ [figure]: candidateFigureDocument(figure, html) }),
    [figure, html],
  );
  return (
    <div>
      <h3>{label}</h3>
      <div className="h2-security__stage">
        <div className="h2-security__view h2-security__grid is-active" style={{ marginTop: 0 }}>
          <div className="h2-security__cell">
            <WalletFigure figure={figure} playing={playing} />
            <span>Live</span>
          </div>
          <WalletFigureCandidates.Provider value={swap}>
            <div className="h2-security__cell">
              <WalletFigure figure={figure} playing={playing} />
              <span>{other}</span>
            </div>
          </WalletFigureCandidates.Provider>
        </div>
      </div>
    </div>
  );
}

const pairGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 448px), 448px))',
  gap: '32px 64px',
  marginTop: 24,
};

function FigureReview(): React.JSX.Element {
  const [playing, setPlaying] = React.useState(false);
  return (
    <div className="h2-page h2-page--wallet">
      <div className="h2-col">
        <section className="h2-section h2-rule">
          <div className="h2-shell">
            <h2 className="h2-display">Custody figure review</h2>
            <p>Hover a figure to run it, or play every figure at once.</p>
            <button
              type="button"
              className="h2-btn h2-btn--outline"
              aria-pressed={playing}
              onClick={setPlaying.bind(null, !playing)}
            >
              {playing ? 'Rest all' : 'Play all'}
            </button>
            <h2 className="h2-display" style={{ marginTop: 48 }}>
              Candidates
            </h2>
            <div style={pairGrid}>
              {candidates.map((review) => (
                <ReviewPair
                  key={review.label}
                  review={review}
                  other="Candidate"
                  playing={playing}
                />
              ))}
            </div>
            <h2 className="h2-display" style={{ marginTop: 48 }}>
              Previous figures
            </h2>
            <div style={pairGrid}>
              {reviews.map((review) => (
                <ReviewPair key={review.label} review={review} other="Previous" playing={playing} />
              ))}
            </div>
          </div>
        </section>
        <H2Security />
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Figure review requires #root');
createRoot(root).render(<FigureReview />);
