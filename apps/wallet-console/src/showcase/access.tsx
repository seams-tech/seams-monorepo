import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Fingerprint,
  KeyRound,
  Laptop,
  Link2,
  Smartphone,
} from 'lucide-react';
import './showcase.css';
import './access.css';
import linkingCode from './linking-code.svg';

type AccessState =
  | { kind: 'choose' }
  | { kind: 'scan' }
  | { kind: 'approve' }
  | { kind: 'passkey'; flow: 'link' | 'recover' }
  | { kind: 'complete'; flow: 'link' | 'recover' }
  | { kind: 'recovery'; code: string; error: string | null };

const recoveryCode = '4821-7396-2058-1643';

class Access extends React.Component<Record<string, never>, { scene: AccessState }> {
  state: { scene: AccessState } = { scene: { kind: 'choose' } };

  private transition(scene: AccessState): void {
    this.setState({ scene });
  }

  private choose = (): void => {
    this.transition({ kind: 'choose' });
  };
  private link = (): void => {
    this.transition({ kind: 'scan' });
  };
  private scanned = (): void => {
    this.transition({ kind: 'approve' });
  };
  private approved = (): void => {
    this.transition({ kind: 'passkey', flow: 'link' });
  };
  private recover = (): void => {
    this.transition({ kind: 'recovery', code: recoveryCode, error: null });
  };

  private changeCode = (event: React.ChangeEvent<HTMLInputElement>): void => {
    this.transition({ kind: 'recovery', code: event.currentTarget.value, error: null });
  };

  private submitCode = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const state = this.state.scene;
    if (state.kind !== 'recovery') return;
    if (state.code.replaceAll(/[^0-9]/g, '') !== recoveryCode.replaceAll('-', '')) {
      this.transition({
        kind: 'recovery',
        code: state.code,
        error: 'Check your recovery code and try again.',
      });
      return;
    }
    this.transition({ kind: 'passkey', flow: 'recover' });
  };

  private createPasskey = (): void => {
    const state = this.state.scene;
    if (state.kind === 'passkey') this.transition({ kind: 'complete', flow: state.flow });
  };

  private content(): React.JSX.Element {
    const state = this.state.scene;
    switch (state.kind) {
      case 'choose':
        return (
          <>
            <Link2 className="access-icon" aria-hidden />
            <h1>Your wallet, wherever you are</h1>
            <p>Connect another device or restore access to your wallet.</p>
            <button data-access-link onClick={this.link}>
              <Smartphone aria-hidden />
              <span>
                Link a device<small>Approve from a device you already use</small>
              </span>
              <ArrowRight aria-hidden />
            </button>
            <button data-access-recover onClick={this.recover}>
              <KeyRound aria-hidden />
              <span>
                Recover your wallet<small>Use your recovery code</small>
              </span>
              <ArrowRight aria-hidden />
            </button>
          </>
        );
      case 'scan':
        return (
          <>
            <h1>Link a new device</h1>
            <p>Scan this code with the device where your wallet is unlocked.</p>
            <img className="access-qr" src={linkingCode} alt="Device linking QR code" />
            <div className="access-device">
              <Laptop aria-hidden />
              <span>
                MacBook Pro<small>New device</small>
              </span>
            </div>
            <button className="access-primary" data-access-scanned onClick={this.scanned}>
              Continue on your other device
              <ArrowRight aria-hidden />
            </button>
          </>
        );
      case 'approve':
        return (
          <>
            <Smartphone className="access-icon" aria-hidden />
            <span className="access-eyebrow">On your other device</span>
            <h1>Link this MacBook Pro?</h1>
            <p>Only approve a device you recognize.</p>
            <div className="access-device">
              <Laptop aria-hidden />
              <span>
                MacBook Pro<small>Chrome · macOS</small>
              </span>
            </div>
            <button className="access-primary" data-access-approve onClick={this.approved}>
              Approve linking
              <ArrowRight aria-hidden />
            </button>
          </>
        );
      case 'recovery':
        return (
          <>
            <KeyRound className="access-icon" aria-hidden />
            <h1>Recover your wallet</h1>
            <p>Enter the recovery code you saved when you created your wallet.</p>
            <form onSubmit={this.submitCode}>
              <label htmlFor="recovery-code">Recovery code</label>
              <input
                id="recovery-code"
                value={state.code}
                onChange={this.changeCode}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={state.error !== null}
                aria-describedby={state.error ? 'recovery-error' : undefined}
              />
              {state.error && (
                <p id="recovery-error" role="alert">
                  {state.error}
                </p>
              )}
              <button className="access-primary" data-access-verify type="submit">
                Continue
                <ArrowRight aria-hidden />
              </button>
            </form>
          </>
        );
      case 'passkey':
        return (
          <>
            <Fingerprint className="access-icon" aria-hidden />
            <h1>{state.flow === 'link' ? 'Device approved' : 'Create a new passkey'}</h1>
            <p>
              {state.flow === 'link'
                ? 'Create a passkey to unlock your wallet on this device.'
                : 'Secure your recovered wallet with a new passkey.'}
            </p>
            <button className="access-primary" data-access-passkey onClick={this.createPasskey}>
              <Fingerprint aria-hidden />
              Create passkey
            </button>
          </>
        );
      case 'complete':
        return (
          <>
            <Check className="access-icon" aria-hidden />
            <h1>{state.flow === 'link' ? 'Device linked' : 'Wallet recovered'}</h1>
            <p role="status">
              {state.flow === 'link'
                ? 'Your wallet is ready on this MacBook Pro.'
                : 'Your new passkey is ready. You have access to your wallet again.'}
            </p>
            {state.flow === 'link' ? (
              <button className="access-primary" data-access-next onClick={this.recover}>
                Explore account recovery
                <ArrowRight aria-hidden />
              </button>
            ) : (
              <button className="access-primary" data-access-reset onClick={this.choose}>
                Done
                <Check aria-hidden />
              </button>
            )}
          </>
        );
      default:
        return assertNever(state);
    }
  }

  render(): React.JSX.Element {
    return (
      <section className="access-card" data-access-state={this.state.scene.kind}>
        <header>
          {this.state.scene.kind !== 'choose' && (
            <button
              className="access-back"
              aria-label="Back to link and recover"
              onClick={this.choose}
            >
              <ArrowLeft aria-hidden />
            </button>
          )}
          <span>shop.example.com</span>
        </header>
        <div className="access-content" key={this.state.scene.kind}>
          {this.content()}
        </div>
        <footer>Seams Wallet</footer>
      </section>
    );
  }
}

function assertNever(state: never): never {
  throw new Error(`Unknown access state: ${String(state)}`);
}
const root = document.getElementById('root');
if (!root) throw new Error('Link and recover requires a root element.');
createRoot(root).render(<Access />);
