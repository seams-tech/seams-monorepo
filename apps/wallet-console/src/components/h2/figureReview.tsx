import React from 'react';
import { createRoot } from 'react-dom/client';
import '@seams/wallet/react/styles';
import '@/app.css';
import '@/styles/h2.css';
import abstractKeychain from '../../../showcase/motion/credentials-abstract/index.html?raw';
import { H2Security } from './sections';
import { candidateFigureDocument, WalletFigure, WalletFigureCandidates } from './WalletFigure';

/* Dev-only page (/figure-review/ on the dev server, not in the build): the
   current keychain beside its abstract candidate at the page's cell size,
   then the real custody section with the candidate in the keychain's place. */

const candidates = { keychain: candidateFigureDocument('keychain', abstractKeychain) };

function FigureReview(): React.JSX.Element {
  const [playing, setPlaying] = React.useState(false);
  return (
    <div className="h2-page h2-page--wallet">
      <div className="h2-col">
        <section className="h2-section h2-rule">
          <div className="h2-shell">
            <h2 className="h2-display">Keychain review</h2>
            <p>Hover a key to fan it out, or play both figures at once.</p>
            <button
              type="button"
              className="h2-btn h2-btn--outline"
              aria-pressed={playing}
              onClick={setPlaying.bind(null, !playing)}
            >
              {playing ? 'Rest both' : 'Play both'}
            </button>
            <div className="h2-security__stage" style={{ maxWidth: 448, marginTop: 40 }}>
              <div className="h2-security__view h2-security__grid is-active">
                <div className="h2-security__cell">
                  <WalletFigure figure="keychain" playing={playing} />
                  <span>Current</span>
                </div>
                <WalletFigureCandidates.Provider value={candidates}>
                  <div className="h2-security__cell">
                    <WalletFigure figure="keychain" playing={playing} />
                    <span>Abstract</span>
                  </div>
                </WalletFigureCandidates.Provider>
              </div>
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
