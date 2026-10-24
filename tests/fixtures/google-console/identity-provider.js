/* global googleAcceptanceToken:readonly */
// Controlled Google boundary. Console code, token verification, cookies, and D1 stay real.
class GoogleAcceptanceIdentity {
  configuration = null;
  prompts = 0;
  cancellations = 0;

  initialize(configuration) {
    this.configuration = configuration;
  }

  renderButton(element, options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Continue with Google';
    button.style.cssText = `width:${options.width}px;height:40px;background:#202124;color:white;border:0;border-radius:4px;font:500 14px Arial;cursor:pointer`;
    button.addEventListener('click', this.openPopup.bind(this));
    element.replaceChildren(button);
  }

  prompt() {
    this.prompts += 1;
    if (new URL(location.href).searchParams.get('google_case') !== 'one_tap') return;
    const prompt = document.createElement('section');
    prompt.setAttribute('aria-label', 'Google One Tap');
    const button = document.createElement('button');
    button.textContent = 'Continue as GetSignal';
    button.addEventListener('click', this.completeOneTap.bind(this));
    prompt.appendChild(button);
    document.body.appendChild(prompt);
  }

  completeOneTap() {
    this.cancel();
    this.configuration.callback({ credential: googleAcceptanceToken });
    this.configuration.callback({ credential: googleAcceptanceToken });
  }

  cancel() {
    this.cancellations += 1;
    document.querySelector('section[aria-label="Google One Tap"]')?.remove();
  }

  openPopup() {
    const url = new URL('https://accounts.google.com/console-acceptance');
    url.searchParams.set('origin', location.origin);
    window.open(url.href, 'google-console-acceptance', 'popup,width=500,height=600');
  }

  receive(event) {
    if (event.origin !== 'https://accounts.google.com' || event.data?.kind !== 'google-acceptance')
      return;
    this.configuration.callback({
      credential: event.data.credential === 'valid' ? googleAcceptanceToken : event.data.credential,
    });
  }
}

const googleAcceptanceIdentity = new GoogleAcceptanceIdentity();
window.google = { accounts: { id: googleAcceptanceIdentity } };
window.addEventListener('message', googleAcceptanceIdentity.receive.bind(googleAcceptanceIdentity));
