import type { SpeakToSignEnrollmentResult, SpeakToSignTransferResult } from '@seams/wallet';

type TransferRefusal = Extract<SpeakToSignTransferResult, { kind: 'refused' }>['reason'];
type EnrollmentRefusal = Extract<SpeakToSignEnrollmentResult, { kind: 'refused' }>['reason'];
type Unavailable = Extract<SpeakToSignTransferResult, { kind: 'unavailable' }>['reason'];
type Sent = Extract<SpeakToSignTransferResult, { kind: 'sent' }>;

const TRANSFER_REFUSALS: Record<TransferRefusal, string> = {
  quality: 'The recording was too quiet, too short or too noisy.',
  speaker: 'The voice did not match the enrolled voice.',
  words: 'The words did not match the sentence.',
  audio_reused: 'The verifier already saw this audio.',
  audio_invalid: 'The verifier could not read the audio.',
  template_missing: 'The verifier has no voice template for you. Do step 3 first.',
  unsupported: 'The verifier does not support this request.',
  speaker_unavailable: 'The speaker check did not answer.',
  storage: 'The verifier storage failed.',
  transcriber_unavailable: 'The transcription service did not answer.',
  amount_not_speakable: 'The amount must be whole hundredths of NEAR, from 0.01 to 1,000,000.',
  receiver_not_contact: 'The receiver is not an active contact of your vault.',
  verdict_mismatch: 'The signed verdict did not match this payment.',
  vault_rejected: 'The vault refused the transaction.',
};

const ENROLLMENT_REFUSALS: Record<EnrollmentRefusal, string> = {
  quality: 'A recording was too quiet, too short or too noisy.',
  speaker: 'The three recordings do not sound like one speaker.',
  audio_reused: 'The verifier already saw this audio.',
  audio_invalid: 'The verifier could not read the audio.',
  unsupported: 'The verifier does not support this request.',
  speaker_unavailable: 'The speaker check did not answer.',
  storage: 'The verifier storage failed.',
  template_exists: 'Another enrollment changed your template at the same time.',
  not_authorized: 'The vault holds no live authorization for these recordings.',
  authorization_unavailable: 'The verifier could not read the vault authorization.',
  vault_rejected: 'The vault refused authorize_enrollment.',
};

const UNAVAILABLE: Record<Unavailable, string> = {
  flow_not_available: 'This Wallet cannot start the flow.',
  voiceid_unavailable: 'VoiceID is not on for this wallet. Do step 1 first.',
  vault_missing: 'You have no vault yet. Do step 2 first.',
  verifier_unavailable: 'The vault or the Seams verify route did not answer.',
  not_submitted: 'The Wallet did not send the vault transaction. Nothing was paid.',
  submission_unknown:
    'The vault transaction may have been sent. Check NearBlocks before you pay again.',
};

export function transferRefusalText(reason: TransferRefusal): string {
  return TRANSFER_REFUSALS[reason];
}

export function enrollmentRefusalText(reason: EnrollmentRefusal): string {
  return ENROLLMENT_REFUSALS[reason];
}

export function unavailableText(reason: Unavailable): string {
  return UNAVAILABLE[reason];
}

export const STAGE_LABELS: ReadonlyArray<readonly [keyof Sent['times'], string]> = [
  ['speechMs', 'Speech'],
  ['verifyMs', 'Verify'],
  ['checkMs', 'Local check'],
  ['transactionMs', 'Transaction'],
  ['endOfSpeechToReceiptMs', 'End of speech to receipt'],
];

export function formatSeconds(milliseconds: number): string {
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'Something failed without a message.';
}
