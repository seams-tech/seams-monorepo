import React from 'react';

// Original SVG studies. All illustrations remain legible in their resting pose.
function Plate(): React.JSX.Element {
  return (
    <>
      <path className="study-face" d="M0 -42 84 0 0 42 -84 0Z" />
      <path d="M-84 0v7L0 49l84-42V0M0 42v7" />
    </>
  );
}

function KeyMark(): React.JSX.Element {
  return (
    <>
      <ellipse cx="-15" cy="-6" rx="11" ry="6" />
      <path d="m-6-2 31 15m-10-5 7-4m-1 7 7-4" />
    </>
  );
}

export type CustodyStep = 'participants' | 'policy' | 'signature';

export function CustodyFigure({ step }: { step: CustodyStep }): React.JSX.Element {
  return (
    <svg
      className="study-svg custody-figure"
      data-step={step}
      viewBox="0 0 680 400"
      role="img"
      aria-label="Two separate signing participants contribute through a policy check to one signature. Their secret material stays separate."
    >
      <path
        className="study-guide"
        d="m60 212 280-140 280 140-280 140ZM130 177l280 140M200 142l280 140M270 107l280 140M130 247 410 107M200 282l280-140M270 317l280-140"
      />
      <path className="study-wire" d="M178 196v32l162 81 162-81v-32M340 309v43" />
      <g transform="translate(178 184)">
        <Plate />
        <g className="custody-share">
          <path className="study-face" d="M0-71 60-41 0-11-60-41Z" />
          <path d="M-60-41v7L0-4l60-30v-7M0-11v7" />
          <g transform="translate(0 -42)">
            <KeyMark />
          </g>
        </g>
      </g>
      <g transform="translate(502 184)">
        <Plate />
        <g className="custody-share">
          <path className="study-face" d="M0-71 60-41 0-11-60-41Z" />
          <path d="M-60-41v7L0-4l60-30v-7M0-11v7" />
          <g transform="translate(0 -42)">
            <KeyMark />
          </g>
        </g>
      </g>
      <g transform="translate(340 278)">
        <g className="custody-policy">
          <Plate />
          <path className="study-accent" d="m0-26 28 14v15C28 17 0 29 0 29S-28 17-28 3v-15Z" />
          <path className="custody-check" d="m-13 1 10 9 18-18" />
        </g>
      </g>
      <g className="custody-result" transform="translate(340 355)">
        <rect className="study-soft" x="-74" y="-16" width="148" height="32" rx="16" />
        <path d="m-55 0 5 5 9-10" />
        <text x="8" y="4" textAnchor="middle">
          One signature
        </text>
      </g>
      <g className="study-label">
        <text x="178" y="70" textAnchor="middle">
          YOUR DEVICE
        </text>
        <text x="502" y="70" textAnchor="middle">
          YOUR INFRASTRUCTURE
        </text>
        <text x="340" y="216" textAnchor="middle">
          POLICY CHECK
        </text>
      </g>
      <circle className="custody-signal custody-signal--left" cx="178" cy="228" r="4" />
      <circle className="custody-signal custody-signal--right" cx="502" cy="228" r="4" />
    </svg>
  );
}

export type RecoveryDevice = 'phone' | 'laptop';

export function RecoveryFigure({ device }: { device: RecoveryDevice }): React.JSX.Element {
  return (
    <svg
      className="study-svg recovery-figure"
      data-device={device}
      viewBox="0 0 560 340"
      role="img"
      aria-label={`Recovery illustration with the ${device} selected. A linked device helps restore access.`}
    >
      <path
        className="study-guide"
        d="m45 230 220-110 250 125-220 110ZM115 195l250 125M185 160l250 125M115 265l220-110M185 300l220-110"
      />
      <path className="study-wire" d="m181 246 78 39 112-56" />
      <g transform="translate(175 174)">
        <g className="recovery-phone">
          <path
            className="study-face"
            d="m-51-72 70 35q10 5 10 18V83q0 14-11 8l-70-35q-10-5-10-18V-64q0-13 11-8Z"
          />
          <path d="m-49-62 66 33v106l-66-33ZM-34-46l31 15M-28 65l14 7" />
          <path
            className="study-accent"
            d="M-27 6V-3q0-13 13-6T-1 10v9M-35 3l42 21v34l-42-21ZM-17 27v10"
          />
          <path className="study-guide" d="m29-29 12 6v110l-12 6" />
        </g>
      </g>
      <g transform="translate(384 178)">
        <g className="recovery-laptop">
          <path className="study-face" d="m-81-41 104-52 20 108-104 52Z" />
          <path d="m-70-36 86-43 16 87-86 43Z" />
          <path className="study-face" d="m-61 67 104-52 66 33L5 100Z" />
          <path d="M-61 67v6l66 33 104-52v-6M5 100v6m-40-34 71-36 40 20-71 36Z" />
          <path
            className="study-guide"
            d="m-21 68 71-36M-9 74l71-36M3 80l71-36m-92-23 40 20M-4 50l40 20M10 43l40 20M24 36l40 20"
          />
          <path className="study-accent" d="m-29-9 13 8 22-27" />
        </g>
      </g>
      <g className="study-label">
        <text x="153" y="305" textAnchor="middle">
          PASSKEY DEVICE
        </text>
        <text x="411" y="305" textAnchor="middle">
          LINKED DEVICE
        </text>
      </g>
    </svg>
  );
}

export type CredentialChoice = 'support' | 'operations' | 'agent';

function CredentialCard({
  x,
  y,
  choice,
  selected,
  label,
}: {
  x: number;
  y: number;
  choice: CredentialChoice;
  selected: CredentialChoice;
  label: string;
}): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={`credential-sheet${choice === selected ? ' is-selected' : ''}`}>
        <path className="study-face" d="M-73-100 -47-113 -25-102 3-116 78-78V56L-73-20Z" />
        <path d="M-61-88 64-26M-61-78 64-16" />
        <g className="study-guide">
          <path d="M-55-43 43 6M-55-29 26 12M-55-15 43 34" />
          <circle cx="-47" cy="-61" r="3" />
        </g>
        <text className="credential-svg-label" transform="matrix(1 .5 0 1 -53 -51)">
          {label}
        </text>
        <path className="study-accent" d="m41-46 7 7 11-10" />
      </g>
    </g>
  );
}

export function CredentialsFigure({ selected }: { selected: CredentialChoice }): React.JSX.Element {
  return (
    <svg
      className="study-svg credentials-figure"
      viewBox="0 0 560 340"
      role="img"
      aria-label={`${selected} credential selected from three separate scoped credentials.`}
    >
      <path className="study-guide" d="m57 218 224-112 224 112-224 112Z" />
      <path className="study-face" d="m130 228 163-82 157 79-163 82Z" />
      <CredentialCard x={350} y={162} choice="agent" selected={selected} label="AGENT" />
      <CredentialCard x={291} y={192} choice="operations" selected={selected} label="OPERATIONS" />
      <CredentialCard x={232} y={222} choice="support" selected={selected} label="SUPPORT" />
      <path className="study-face" d="m130 228 157 79v26l-157-79ZM287 307l163-82v26l-163 82Z" />
      <path d="m178 264 52 26v7l-52-26Z" />
    </svg>
  );
}

export type EmptyChoice = 'activity' | 'results' | 'connections';

export function EmptyFigure({
  kind,
  engaged,
}: {
  kind: EmptyChoice;
  engaged: boolean;
}): React.JSX.Element {
  return (
    <svg
      className={`study-svg empty-figure${engaged ? ' is-engaged' : ''}`}
      data-kind={kind}
      viewBox="0 0 300 230"
      role="img"
      aria-label={`Empty ${kind} illustration, ${engaged ? 'expanded' : 'at rest'}`}
    >
      <path className="study-guide" d="m35 166 110-55 120 60-110 55Z" />
      {kind === 'activity' && (
        <g>
          <path className="study-face" d="m80 71 65-33 74 37v105l-65 33-74-37Z" />
          <path d="m80 71 74 37 65-33M154 108v105M80 120l74 37 65-33" />
          <path d="m105 150 25 12v6l-25-12" />
          <g className="empty-moving">
            <path className="study-face" d="m80 77 65-33 61 31-65 33Z" />
            <path className="study-face" d="m80 77 61 31v36l-61-31Z" />
            <path d="m141 108 65-33v36l-65 33m-41-42 22 11v6l-22-11" />
            <path className="study-guide" d="m104 65 61 31M124 55l61 31" />
          </g>
        </g>
      )}
      {kind === 'results' && (
        <g>
          <ellipse className="study-face" cx="150" cy="164" rx="82" ry="34" />
          <path d="M68 164v13c0 45 164 45 164 0v-13" />
          <g className="empty-moving">
            <ellipse className="study-face" cx="150" cy="105" rx="75" ry="31" />
            <path d="M75 105v23c0 41 150 41 150 0v-23" />
            <path
              className="study-guide"
              d="m101 86 95 39M83 98l86 35M129 76l88 35M102 125l95-39M83 111l86-35M129 134l88-36"
            />
          </g>
        </g>
      )}
      {kind === 'connections' && (
        <g>
          <path className="study-face" d="m175 38 65 33v92l-65-33Z" />
          <ellipse cx="207" cy="101" rx="18" ry="25" transform="rotate(-26 207 101)" />
          <path d="m200 86 0 13m13-6v13" />
          <path className="study-wire" d="M120 159C60 136 47 191 95 199s44-16 25-27" />
          <g className="empty-plug">
            <path className="study-face" d="m108 129 26-13 30 15v34l-26 13-30-15Z" />
            <path d="m108 129 30 15 26-13m-26 13v34m5-57 22-11m-11 16 22-11" />
          </g>
        </g>
      )}
    </svg>
  );
}

export type EmbedLayer = 'app' | 'wallet' | 'policy';

function WindowPlate({
  x,
  y,
  label,
  kind,
  selected,
}: {
  x: number;
  y: number;
  label: string;
  kind: EmbedLayer;
  selected: EmbedLayer;
}): React.JSX.Element {
  return (
    <g transform={`translate(${x} ${y})`}>
      <g className={`embed-layer${kind === selected ? ' is-selected' : ''}`}>
        <path className="study-face" d="M0-80 160 0 0 80-160 0Z" />
        <path d="M-160 0v7L0 87l160-80V0M0 80v7M-131-15 29 65" />
        <g transform="matrix(1 .5 -1 .5 0 -55)">
          <rect x="0" y="0" width="108" height="69" rx="4" />
          <path d="M0 16h108M12 29h60M12 39h84M12 49h43" />
          <circle cx="9" cy="8" r="1" />
          <circle cx="16" cy="8" r="1" />
          <circle cx="23" cy="8" r="1" />
          <path className="study-accent" d="m80 52 6 6 12-14" />
        </g>
        <text className="study-label" x="184" y="5">
          {label}
        </text>
        <path className="study-guide" d="M164 0h14" />
      </g>
    </g>
  );
}

export function EmbedFigure({
  selected,
  expanded,
}: {
  selected: EmbedLayer;
  expanded: boolean;
}): React.JSX.Element {
  return (
    <svg
      className={`study-svg embed-figure${expanded ? ' is-expanded' : ''}`}
      viewBox="0 0 680 430"
      role="img"
      aria-label={`Embedded wallet layers ${expanded ? 'separated' : 'assembled'}. ${selected} layer highlighted.`}
    >
      <path
        className="study-guide"
        d="m70 305 230-115 230 115-230 115ZM300 190V70M70 305V185M530 305V185"
      />
      <g className="embed-bottom">
        <WindowPlate x={300} y={300} label="03 / POLICY" kind="policy" selected={selected} />
      </g>
      <g className="embed-middle">
        <WindowPlate x={300} y={282} label="02 / WALLET" kind="wallet" selected={selected} />
      </g>
      <g className="embed-top">
        <WindowPlate x={300} y={264} label="01 / YOUR APP" kind="app" selected={selected} />
      </g>
    </svg>
  );
}
