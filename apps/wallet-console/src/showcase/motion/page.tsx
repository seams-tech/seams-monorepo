import React from 'react';
import { ArrowDown, ArrowUpRight, Check, Layers3, Pause, Play } from 'lucide-react';
import {
  CustodyFigure,
  RecoveryFigure,
  CredentialsFigure,
  EmptyFigure,
  EmbedFigure,
  type CustodyStep,
  type RecoveryDevice,
  type CredentialChoice,
  type EmptyChoice,
  type EmbedLayer,
} from './figures';

const custodyCopy: Record<CustodyStep, string> = {
  participants: 'Two participants. Each keeps its own secret material.',
  policy: 'The action passes its policy checks before signing.',
  signature: 'Both participants contribute. One signature leaves the protocol.',
};

const credentialDetails: Record<
  CredentialChoice,
  { title: string; scope: string; limit: string; expiry: string }
> = {
  support: {
    title: 'Support team',
    scope: 'Issue refunds',
    limit: 'Up to $100 per action',
    expiry: 'Expires in 24 hours',
  },
  operations: {
    title: 'Operations team',
    scope: 'Pay suppliers',
    limit: 'Up to $2,000 per action',
    expiry: 'Expires in 7 days',
  },
  agent: {
    title: 'Store assistant',
    scope: 'Read orders',
    limit: 'Read-only access',
    expiry: 'Expires in 1 hour',
  },
};

const embedCopy: Record<EmbedLayer, string> = {
  app: 'Your interface, your brand, your customer relationship.',
  wallet: 'A familiar review and passkey approval inside your app.',
  policy: 'Limits and permissions checked before an action runs.',
};

function toggle(value: boolean): boolean {
  return !value;
}

function SectionIntro({
  number,
  eyebrow,
  title,
  children,
}: {
  number: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="study-intro">
      <span className="study-index">
        {number} / {eyebrow}
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}

function CustodyStudy(): React.JSX.Element {
  const [step, setStep] = React.useState<CustodyStep>('participants');
  return (
    <section
      className="study-section study-section--wide"
      id="custody"
      aria-labelledby="custody-title"
    >
      <div className="study-copy">
        <span className="study-index">01 / CUSTODY & SIGNING</span>
        <h2 id="custody-title">
          Separate by design.
          <br />
          <span>United in a signature.</span>
        </h2>
        <p>
          A little depth makes a complex idea tangible. Two participants stay separate as an
          approved action becomes a signed transaction.
        </p>
        <div className="study-steps" role="group" aria-label="Signing explanation">
          <button
            type="button"
            aria-pressed={step === 'participants'}
            onClick={setStep.bind(null, 'participants')}
          >
            <span>01</span> Separate participants
          </button>
          <button
            type="button"
            aria-pressed={step === 'policy'}
            onClick={setStep.bind(null, 'policy')}
          >
            <span>02</span> Check the policy
          </button>
          <button
            type="button"
            aria-pressed={step === 'signature'}
            onClick={setStep.bind(null, 'signature')}
          >
            <span>03</span> Produce a signature
          </button>
        </div>
        <span className="study-placement">Proposed placement · Security section</span>
      </div>
      <div className="study-stage study-stage--custody">
        <div className="study-stage-top">
          <span>THRESHOLD SIGNING</span>
          <span>2 participants / 1 output</span>
        </div>
        <CustodyFigure step={step} />
        <p className="study-caption" aria-live="polite">
          {custodyCopy[step]}
        </p>
      </div>
    </section>
  );
}

function RecoveryStudy(): React.JSX.Element {
  const [device, setDevice] = React.useState<RecoveryDevice>('phone');
  return (
    <section className="study-panel" id="recovery" aria-label="Passkeys and recovery study">
      <SectionIntro number="02" eyebrow="PASSKEYS & RECOVERY" title="A familiar way back.">
        A device becomes the focal point. The connection stays visible, even while the selected
        device lifts from the drawing.
      </SectionIntro>
      <div className="study-stage">
        <RecoveryFigure device={device} />
      </div>
      <div className="study-controls" role="group" aria-label="Recovery device">
        <button
          type="button"
          aria-pressed={device === 'phone'}
          onClick={setDevice.bind(null, 'phone')}
        >
          Passkey device
        </button>
        <button
          type="button"
          aria-pressed={device === 'laptop'}
          onClick={setDevice.bind(null, 'laptop')}
        >
          Linked device
        </button>
      </div>
      <p className="study-detail" aria-live="polite">
        {device === 'phone'
          ? 'Your everyday sign-in, secured with a passkey.'
          : 'A linked device helps you restore access.'}
      </p>
      <span className="study-placement">Proposed placement · Recovery explanation</span>
    </section>
  );
}

function CredentialStudy(): React.JSX.Element {
  const [selected, setSelected] = React.useState<CredentialChoice>('support');
  const details = credentialDetails[selected];
  return (
    <section
      className="study-panel"
      id="credentials"
      aria-label="Credentials and permissions study"
    >
      <SectionIntro
        number="03"
        eyebrow="CREDENTIALS & PERMISSIONS"
        title="Every role has its limits."
      >
        A small collection of cards reveals who can do what. Select a credential to inspect its
        scope, limit, and expiry.
      </SectionIntro>
      <div className="study-stage">
        <CredentialsFigure selected={selected} />
      </div>
      <div className="study-controls" role="group" aria-label="Example credential">
        <button
          type="button"
          aria-pressed={selected === 'support'}
          onClick={setSelected.bind(null, 'support')}
        >
          Support
        </button>
        <button
          type="button"
          aria-pressed={selected === 'operations'}
          onClick={setSelected.bind(null, 'operations')}
        >
          Operations
        </button>
        <button
          type="button"
          aria-pressed={selected === 'agent'}
          onClick={setSelected.bind(null, 'agent')}
        >
          Agent
        </button>
      </div>
      <div className="study-credential-detail" aria-live="polite">
        <strong>{details.title}</strong>
        <span>
          {details.scope} · {details.limit}
        </span>
        <small>{details.expiry}</small>
      </div>
      <span className="study-placement">Proposed placement · Policy & delegation</span>
    </section>
  );
}

const emptyCopy: Record<
  EmptyChoice,
  { title: string; copy: string; action: string; engagedAction: string }
> = {
  activity: {
    title: 'Your story starts here.',
    copy: 'Your first wallet action will appear here.',
    action: 'Peek inside',
    engagedAction: 'Close drawer',
  },
  results: {
    title: 'Nothing in this view.',
    copy: 'Try a different filter to find what you need.',
    action: 'Lift the filter',
    engagedAction: 'Lower the filter',
  },
  connections: {
    title: 'Ready to connect.',
    copy: 'Connect your first app to get started.',
    action: 'Explore connection',
    engagedAction: 'Return to rest',
  },
};

function EmptyStudyCard({ kind }: { kind: EmptyChoice }): React.JSX.Element {
  const [engaged, setEngaged] = React.useState(false);
  const copy = emptyCopy[kind];
  return (
    <article className="study-empty-card">
      <EmptyFigure kind={kind} engaged={engaged} />
      <h3>{copy.title}</h3>
      <p>{copy.copy}</p>
      <button
        type="button"
        className="study-text-button"
        aria-pressed={engaged}
        onClick={setEngaged.bind(null, toggle)}
      >
        {engaged ? copy.engagedAction : copy.action}
        <ArrowUpRight size={14} aria-hidden />
      </button>
    </article>
  );
}

function EmptyStudies(): React.JSX.Element {
  return (
    <section className="study-section" id="empty" aria-label="Empty states study">
      <SectionIntro
        number="04"
        eyebrow="EMPTY STATES"
        title="A quiet moment, with a little character."
      >
        Small illustrations give an empty view a purpose. Each has a complete resting pose, a gentle
        interaction, and one clear next step.
      </SectionIntro>
      <div className="study-empty-grid">
        <EmptyStudyCard kind="activity" />
        <EmptyStudyCard kind="results" />
        <EmptyStudyCard kind="connections" />
      </div>
      <span className="study-placement">
        Proposed placement · Activity, filtered results, and integrations
      </span>
    </section>
  );
}

function EmbedStudy(): React.JSX.Element {
  const [selected, setSelected] = React.useState<EmbedLayer>('wallet');
  const [expanded, setExpanded] = React.useState(true);
  return (
    <section
      className="study-section study-section--wide study-embed-section"
      id="embedding"
      aria-labelledby="embedding-title"
    >
      <div className="study-copy">
        <span className="study-index">05 / EMBEDDED IN YOUR APP</span>
        <h2 id="embedding-title">
          Your product.
          <br />
          <span>Every layer, connected.</span>
        </h2>
        <p>
          An exploded view reveals how the experience fits together. Bring the layers together to
          return to one product.
        </p>
        <div className="study-steps" role="group" aria-label="Embedded wallet layer">
          <button
            type="button"
            aria-pressed={selected === 'app'}
            onClick={setSelected.bind(null, 'app')}
          >
            <span>01</span>Your app
          </button>
          <button
            type="button"
            aria-pressed={selected === 'wallet'}
            onClick={setSelected.bind(null, 'wallet')}
          >
            <span>02</span>Embedded wallet
          </button>
          <button
            type="button"
            aria-pressed={selected === 'policy'}
            onClick={setSelected.bind(null, 'policy')}
          >
            <span>03</span>Policy checks
          </button>
        </div>
        <button
          type="button"
          className="study-outline-button"
          aria-pressed={expanded}
          onClick={setExpanded.bind(null, toggle)}
        >
          <Layers3 size={15} aria-hidden />
          {expanded ? 'Bring layers together' : 'Separate the layers'}
        </button>
        <span className="study-placement">Proposed placement · SDK explanation</span>
      </div>
      <div className="study-stage">
        <EmbedFigure selected={selected} expanded={expanded} />
        <p className="study-caption" aria-live="polite">
          {embedCopy[selected]}
        </p>
      </div>
    </section>
  );
}

export function MotionStudies(): React.JSX.Element {
  const [still, setStill] = React.useState(false);
  return (
    <div className={`h2-page motion-studies${still ? ' is-still' : ''}`}>
      <a className="study-skip" href="#studies">
        Skip to studies
      </a>
      <nav className="study-nav" aria-label="Concept page">
        <a className="study-wordmark" href="#top">
          seams<span> / wallet</span>
        </a>
        <div>
          <span className="study-badge">DESIGN STUDY 01</span>
          <button
            type="button"
            className="study-motion-control"
            aria-pressed={still}
            onClick={setStill.bind(null, toggle)}
          >
            {still ? <Play size={13} aria-hidden /> : <Pause size={13} aria-hidden />}
            {still ? 'Still mode' : 'Motion on'}
          </button>
        </div>
      </nav>
      <main id="top" className="study-main">
        <header className="study-hero">
          <span className="study-index">SEAMS WALLET / AN INTERACTION EXPLORATION</span>
          <h1>
            Small movements.
            <br />
            <span>Clearer connections.</span>
          </h1>
          <p>
            Five ways to make wallets, permissions, and recovery feel tangible. Fine lines, quiet
            surfaces, and motion with a reason.
          </p>
          <div className="study-hero-bottom">
            <a href="#studies">
              Explore the studies <ArrowDown size={15} aria-hidden />
            </a>
            <span>
              <Check size={13} aria-hidden />
              Interactive concepts · Sample data only
            </span>
          </div>
          <div className="study-hero-decoration" aria-hidden>
            <i />
            <i />
            <i />
          </div>
        </header>
        <div className="study-directory" id="studies">
          <span>THE COLLECTION</span>
          <div>
            <a href="#custody">01 Custody</a>
            <a href="#recovery">02 Recovery</a>
            <a href="#credentials">03 Credentials</a>
            <a href="#empty">04 Empty states</a>
            <a href="#embedding">05 Embedding</a>
          </div>
        </div>
        <CustodyStudy />
        <div className="study-pair">
          <RecoveryStudy />
          <CredentialStudy />
        </div>
        <EmptyStudies />
        <EmbedStudy />
        <footer className="study-footer">
          <span>seams / motion studies</span>
          <p>
            Original SVG concepts inspired by{' '}
            <a href="https://hairline.lucasmarkes.com/figures" target="_blank" rel="noreferrer">
              Hairline <ArrowUpRight size={12} aria-hidden />
            </a>
            . All controls change this preview only.
          </p>
          <a href="#top">Back to top ↑</a>
        </footer>
      </main>
    </div>
  );
}
