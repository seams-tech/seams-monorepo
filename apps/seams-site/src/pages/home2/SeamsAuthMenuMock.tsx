import { Fingerprint, Mail, QrCode } from 'lucide-react';

// Display-only hero artwork; the enclosing panel links to the wallet demo.
export function SeamsAuthMenuMock() {
  return (
    <div className="h2-heroscene__shell" aria-hidden="true">
      <div className="h2-auth-mock">
        <h3>Sign in</h3>
        <p>Welcome back to your wallet</p>
        <div className="h2-auth-mock__input">Enter your username</div>
        <div className="h2-auth-mock__method h2-auth-mock__method--primary">
          <Fingerprint size={22} /> Continue with passkey
        </div>
        <div className="h2-auth-mock__divider">or</div>
        <div className="h2-auth-mock__method">
          <Mail size={20} /> Continue with Google
        </div>
        <div className="h2-auth-mock__method">
          <QrCode size={20} /> Link another device
        </div>
        <p className="h2-auth-mock__footer">
          Don’t have an account? <strong>Sign up</strong>
        </p>
      </div>
    </div>
  );
}
