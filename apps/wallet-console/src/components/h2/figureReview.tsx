import React from 'react';
import { createRoot } from 'react-dom/client';
import '@seams/wallet/react/styles';
import '@/app.css';
import '@/styles/h2.css';
import abstractKeychain from '../../../showcase/motion/credentials-abstract/index.html?raw';
import abstractInterlock from '../../../showcase/motion/interlock-abstract/index.html?raw';
import abstractDevices from '../../../showcase/motion/delegation-abstract/index.html?raw';
import abstractInfrastructure from '../../../showcase/motion/infrastructure-abstract/index.html?raw';
import { H2Security } from './sections';
import {
  candidateFigureDocument,
  WalletFigure,
  WalletFigureCandidates,
  type WalletFigureName,
} from './WalletFigure';

/* Dev-only page (/figure-review/ on the dev server, not in the build): each
   custody figure beside its abstract candidate at the page's cell size, then
   the real custody section with every candidate in its figure's place. */

const reviews: readonly { figure: WalletFigureName; label: string; html: string }[] = [
  { figure: 'keychain', label: 'Keys you control', html: abstractKeychain },
  { figure: 'interlock', label: 'Scoped permissions', html: abstractInterlock },
  { figure: 'devices', label: 'Linked devices', html: abstractDevices },
  { figure: 'infrastructure', label: 'No lock-in', html: abstractInfrastructure },
];

const candidates: Partial<Record<WalletFigureName, string>> = Object.fromEntries(
  reviews.map(({ figure, html }) => [figure, candidateFigureDocument(figure, html)]),
);

function ReviewPair({
  figure,
  label,
  playing,
}: {
  figure: WalletFigureName;
  label: string;
  playing: boolean;
}): React.JSX.Element {
  return (
    <div>
      <h3>{label}</h3>
      <div className="h2-security__stage">
        <div className="h2-security__view h2-security__grid is-active" style={{ marginTop: 0 }}>
          <div className="h2-security__cell">
            <WalletFigure figure={figure} playing={playing} />
            <span>Current</span>
          </div>
          <WalletFigureCandidates.Provider value={candidates}>
            <div className="h2-security__cell">
              <WalletFigure figure={figure} playing={playing} />
              <span>Abstract</span>
            </div>
          </WalletFigureCandidates.Provider>
        </div>
      </div>
    </div>
  );
}

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
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 448px), 448px))',
                gap: '32px 64px',
                marginTop: 40,
              }}
            >
              {reviews.map(({ figure, label }) => (
                <ReviewPair key={figure} figure={figure} label={label} playing={playing} />
              ))}
            </div>
          </div>
        </section>
        <WalletFigureCandidates.Provider value={candidates}>
          <H2Security />
        </WalletFigureCandidates.Provider>
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Figure review requires #root');
createRoot(root).render(<FigureReview />);
