const ENROLLMENT_PROOF_KEY = 'seams.console.stepUpEnrollmentProof';
const ENROLLMENT_RETURN_KEY = 'seams.console.stepUpEnrollmentReturn';

export function rememberStepUpEnrollmentProof(proof: string): void {
  window.sessionStorage.setItem(ENROLLMENT_PROOF_KEY, proof);
}

export function readStepUpEnrollmentProof(): string | null {
  return window.sessionStorage.getItem(ENROLLMENT_PROOF_KEY);
}

export function clearStepUpEnrollmentProof(): void {
  window.sessionStorage.removeItem(ENROLLMENT_PROOF_KEY);
}

export function rememberStepUpEnrollmentReturn(): void {
  const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.sessionStorage.setItem(ENROLLMENT_RETURN_KEY, returnPath);
}

export function takeStepUpEnrollmentReturn(): string | null {
  const returnPath = window.sessionStorage.getItem(ENROLLMENT_RETURN_KEY);
  window.sessionStorage.removeItem(ENROLLMENT_RETURN_KEY);
  if (!returnPath?.startsWith('/dashboard/')) return null;
  const url = new URL(returnPath, window.location.origin);
  if (url.origin !== window.location.origin) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
