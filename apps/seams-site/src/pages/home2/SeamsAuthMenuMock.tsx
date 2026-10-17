import { ChevronRight, Fingerprint, Lock, QrCode, ShieldCheck } from 'lucide-react';
import SeamsWordmark from '@/components/icons/SeamsWordmark';

// Display-only hero artwork; the enclosing panel links to the wallet demo.
export function SeamsAuthMenuMock() {
  return (
    <div className="h2-heroscene__shell" aria-hidden="true">
      <div className="h2-auth-mock">
        <div className="h2-auth-mock__origin">
          <Lock size={13} />
          <span>{window.location.hostname}</span>
        </div>
        <h3>Create a wallet</h3>
        <p className="h2-auth-mock__subtitle">Continue with Passkey or Google SSO</p>
        <div className="h2-auth-mock__method h2-auth-mock__method--primary">
          <Fingerprint size={18} /> Create wallet with passkey
        </div>
        <div className="h2-auth-mock__method">
          <svg width="20" height="20" viewBox="0 0 24 24" focusable="false">
            <path
              fill="#4285F4"
              d="M21.6 12.23c0-.68-.06-1.34-.18-1.98H12v3.74h5.39a4.6 4.6 0 0 1-2 3.02v2.5h3.23c1.9-1.75 2.98-4.34 2.98-7.28Z"
            />
            <path
              fill="#34A853"
              d="M12 22c2.7 0 4.97-.9 6.63-2.44l-3.23-2.5c-.9.6-2.04.96-3.4.96-2.62 0-4.84-1.77-5.63-4.15H3.03v2.57A10 10 0 0 0 12 22Z"
            />
            <path
              fill="#FBBC04"
              d="M6.37 13.87A5.99 5.99 0 0 1 6.05 12c0-.65.11-1.28.32-1.87V7.56H3.03A10 10 0 0 0 2 12c0 1.6.38 3.11 1.03 4.44l3.34-2.57Z"
            />
            <path
              fill="#EA4335"
              d="M12 5.98c1.47 0 2.78.5 3.82 1.48l2.86-2.86C16.96 2.98 14.7 2 12 2a10 10 0 0 0-8.97 5.56l3.34 2.57c.79-2.38 3-4.15 5.63-4.15Z"
            />
          </svg>
          Continue with Google
        </div>
        <p className="h2-auth-mock__options-label">Other options</p>
        <div className="h2-auth-mock__options">
          <div className="h2-auth-mock__option">
            <span className="h2-auth-mock__option-icon">
              <QrCode size={16} />
            </span>
            <span>
              <strong>Link this device</strong>
              <small>Scan a code with your other device</small>
            </span>
            <ChevronRight size={14} />
          </div>
          <div className="h2-auth-mock__option">
            <span className="h2-auth-mock__option-icon">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                focusable="false"
              >
                <path d="M20 11v6M20 13h2M3 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 2.072.578" />
                <circle cx="10" cy="7" r="4" />
                <circle cx="20" cy="19" r="2" />
              </svg>
            </span>
            <span>
              <strong>Recover wallet</strong>
              <small>Use your recovery code</small>
            </span>
            <ChevronRight size={14} />
          </div>
        </div>
        <p className="h2-auth-mock__footer">
          Already have a wallet? <strong>Unlock wallet</strong>
        </p>
        <div className="h2-auth-mock__brand">
          <ShieldCheck size={13} strokeWidth={1.6} />
          <span>Secured by</span>
          <SeamsWordmark height={12} />
        </div>
      </div>
    </div>
  );
}
