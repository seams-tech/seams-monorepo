import React from 'react';
import { CopyButton } from '@core/components/CopyButton';
import { getDocsOrigin } from '@core/router/siteRouting';
import { DashboardExpander } from '../../components/DashboardExpander';
import { ArrowRightIcon, PlusIcon, ServerIcon, WebhookIcon } from '../../icons/SidebarIcons';

const SIGNATURE_CODE = [
  { tone: 'keyword', text: 'const' },
  { tone: 'plain', text: ' signed = ' },
  { tone: 'string', text: '`${timestamp}.${rawBody}`' },
  { tone: 'plain', text: ';\n' },
  { tone: 'keyword', text: 'const' },
  { tone: 'plain', text: ' mac = ' },
  { tone: 'function', text: 'createHmac' },
  { tone: 'plain', text: '(' },
  { tone: 'string', text: "'sha256'" },
  { tone: 'plain', text: ', secret)\n  .' },
  { tone: 'function', text: 'update' },
  { tone: 'plain', text: '(signed)\n  .' },
  { tone: 'function', text: 'digest' },
  { tone: 'plain', text: '(' },
  { tone: 'string', text: "'hex'" },
  { tone: 'plain', text: ');\n' },
  { tone: 'comment', text: '// signature header === `v1=${mac}`' },
];

function signatureTokenText(token: (typeof SIGNATURE_CODE)[number]): string {
  return token.text;
}

function renderSignatureToken(
  token: (typeof SIGNATURE_CODE)[number],
  index: number,
): React.JSX.Element {
  return (
    <span key={index} className={`dashboard-code-token--${token.tone}`}>
      {token.text}
    </span>
  );
}

const VERIFY_SIGNATURE_SNIPPET = SIGNATURE_CODE.map(signatureTokenText).join('');

export function WebhooksGetStarted(props: {
  onAddEndpoint: () => void;
  disabled: boolean;
}): React.JSX.Element {
  const { onAddEndpoint, disabled } = props;

  return (
    <section className="dashboard-webhooks-start" aria-label="Get started with webhooks">
      <div className="dashboard-webhooks-start__hero">
        <div className="dashboard-webhooks-start__glyphs" aria-hidden="true">
          <span className="dashboard-webhooks-start__glyph">
            <WebhookIcon size={20} strokeWidth={1.75} />
          </span>
          <ArrowRightIcon
            size={16}
            strokeWidth={1.75}
            className="dashboard-webhooks-start__arrow"
          />
          <span className="dashboard-webhooks-start__glyph">
            <ServerIcon size={20} strokeWidth={1.75} />
          </span>
        </div>
        <h2 className="dashboard-webhooks-start__title">Send Seams events to your backend</h2>
        <p className="dashboard-webhooks-start__lede">
          Receive event notifications on your server. Track deliveries and replay failures here.{' '}
          <a
            className="dashboard-inline-link"
            href={getDocsOrigin()}
            target="_blank"
            rel="noreferrer"
          >
            Read the docs
          </a>
        </p>
        <button
          type="button"
          className="dashboard-pagination-button dashboard-pagination-button--primary dashboard-pagination-button--with-icon"
          onClick={onAddEndpoint}
          disabled={disabled}
        >
          <PlusIcon size={16} strokeWidth={2} />
          Add endpoint
        </button>
      </div>

      <ol className="dashboard-webhooks-start__steps">
        <li className="dashboard-webhooks-start__step">
          <span className="dashboard-webhooks-start__step-index" aria-hidden="true">
            1
          </span>
          <div className="dashboard-webhooks-start__step-copy">
            <h3>Add an endpoint</h3>
            <p>Enter your server URL and choose which events to receive.</p>
          </div>
        </li>

        <li className="dashboard-webhooks-start__step">
          <span className="dashboard-webhooks-start__step-index" aria-hidden="true">
            2
          </span>
          <div className="dashboard-webhooks-start__step-copy">
            <h3>Verify each request</h3>
            <p>
              Use your endpoint&rsquo;s signing secret to check that each event came from Seams.
            </p>
            <DashboardExpander title="Signature details">
              <div className="dashboard-webhooks-start__step-copy">
                <p>
                  Read <code>X-Console-Webhook-Timestamp</code> and{' '}
                  <code>X-Console-Webhook-Signature</code> from the request headers. Calculate
                  HMAC-SHA256 using the timestamp, raw request body, and your endpoint&rsquo;s{' '}
                  <code>whsec_…</code> secret.
                </p>
                <div className="dashboard-webhooks-start__snippet">
                  <div className="dashboard-webhooks-start__snippet-header">JavaScript</div>
                  <pre
                    className="dashboard-code-block"
                    tabIndex={0}
                    aria-label="Signature verification JavaScript"
                  >
                    <code>{SIGNATURE_CODE.map(renderSignatureToken)}</code>
                  </pre>
                  <CopyButton
                    text={VERIFY_SIGNATURE_SNIPPET}
                    ariaLabel="Copy signature verification snippet"
                  />
                </div>
              </div>
            </DashboardExpander>
          </div>
        </li>

        <li className="dashboard-webhooks-start__step">
          <span className="dashboard-webhooks-start__step-index" aria-hidden="true">
            3
          </span>
          <div className="dashboard-webhooks-start__step-copy">
            <h3>Respond with 2xx within 10 seconds</h3>
            <p>If a delivery fails, fix the issue and replay it from the deliveries table.</p>
          </div>
        </li>
      </ol>
    </section>
  );
}
