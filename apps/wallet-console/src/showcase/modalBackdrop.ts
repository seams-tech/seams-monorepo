export type ModalBackdrop = 'dimmed' | 'none';

/** The demo document owns the native dialog backdrop around the SDK card. */
export function configureModalBackdrop(): void {
  const value = new URLSearchParams(window.location.search).get('backdrop');
  const backdrop: ModalBackdrop = value === 'none' ? 'none' : 'dimmed';
  document.documentElement.dataset.modalBackdrop = backdrop;
}
