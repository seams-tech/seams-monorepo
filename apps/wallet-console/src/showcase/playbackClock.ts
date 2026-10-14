import './playbackFocus.css';

// The canvas controls this clock through the embedded document. Standalone
// examples run normally, and manual interaction retains their normal timing.
class PlaybackDelay {
  private remaining: number;
  private previous = performance.now();
  private timer: number;

  constructor(
    private readonly callback: () => void,
    milliseconds: number,
  ) {
    this.remaining = milliseconds;
    this.timer = window.setInterval(this.tick, 50);
  }

  cancel = (): void => {
    window.clearInterval(this.timer);
  };

  private tick = (): void => {
    const now = performance.now();
    if (document.documentElement.dataset.showcaseClock !== 'paused')
      this.remaining -= now - this.previous;
    this.previous = now;
    if (this.remaining <= 0) {
      this.cancel();
      this.callback();
    }
  };
}

export function schedulePlayback(callback: () => void, milliseconds: number): () => void {
  return new PlaybackDelay(callback, milliseconds).cancel;
}
