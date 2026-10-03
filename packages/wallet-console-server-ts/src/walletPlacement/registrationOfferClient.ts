import {
  parseGoogleEmailOtpRegistrationAttemptRecord,
  type GoogleEmailOtpRegistrationAttemptStore,
} from '@seams/wallet-server/cloud-host';
import type { WalletHomeServiceClient } from './serviceClient';

type Input<Method extends keyof GoogleEmailOtpRegistrationAttemptStore> = Parameters<
  GoogleEmailOtpRegistrationAttemptStore[Method]
>[0];

export class RegistrationOfferClient implements GoogleEmailOtpRegistrationAttemptStore {
  constructor(private readonly service: WalletHomeServiceClient) {}

  async complete(
    input: Input<'complete'>,
  ): ReturnType<GoogleEmailOtpRegistrationAttemptStore['complete']> {
    const response = await this.service.registrationOffer({ operation: 'complete', input });
    const result = response.value;
    if (!result || typeof result !== 'object' || !('ok' in result)) throw invalidResponse();
    if (result.ok === true) return { ok: true };
    if (
      result.ok === false &&
      'code' in result &&
      result.code === 'registration_incomplete' &&
      'message' in result &&
      typeof result.message === 'string'
    ) {
      return { ok: false, code: result.code, message: result.message };
    }
    throw invalidResponse();
  }

  async claimCandidate(
    input: Input<'claimCandidate'>,
  ): ReturnType<GoogleEmailOtpRegistrationAttemptStore['claimCandidate']> {
    const response = await this.service.registrationOffer({ operation: 'claimCandidate', input });
    const result = response.value;
    if (!result || typeof result !== 'object' || !('ok' in result)) throw invalidResponse();
    if (result.ok === true) return { ok: true };
    if (
      result.ok === false &&
      'code' in result &&
      result.code === 'registration_candidate_unavailable' &&
      'message' in result &&
      typeof result.message === 'string'
    ) {
      return { ok: false, code: result.code, message: result.message };
    }
    throw invalidResponse();
  }

  async create(input: Input<'create'>) {
    return pending(await this.service.registrationOffer({ operation: 'create', input }));
  }
  async findStarted(input: Input<'findStarted'>) {
    const response = await this.service.registrationOffer({ operation: 'findStarted', input });
    return response.value === null ? null : pending(response);
  }
  async read(input: string) {
    const response = await this.service.registrationOffer({ operation: 'read', input });
    return response.value === null ? null : record(response);
  }
  async put(input: Input<'put'>): Promise<void> {
    acknowledge(await this.service.registrationOffer({ operation: 'put', input }));
  }
  async delete(input: string): Promise<void> {
    acknowledge(await this.service.registrationOffer({ operation: 'delete', input }));
  }
  async abandonStartedExceptBinding(input: Input<'abandonStartedExceptBinding'>): Promise<void> {
    acknowledge(
      await this.service.registrationOffer({ operation: 'abandonStartedExceptBinding', input }),
    );
  }
  async cleanupExpired(input: number): Promise<number> {
    const response = await this.service.registrationOffer({ operation: 'cleanupExpired', input });
    if (
      typeof response.value !== 'number' ||
      !Number.isSafeInteger(response.value) ||
      response.value < 0
    )
      throw invalidResponse();
    return response.value;
  }
  async hasLiveStartedWalletAttempt(input: Input<'hasLiveStartedWalletAttempt'>): Promise<boolean> {
    const response = await this.service.registrationOffer({
      operation: 'hasLiveStartedWalletAttempt',
      input,
    });
    if (typeof response.value !== 'boolean') throw invalidResponse();
    return response.value;
  }
}

function record(response: Record<string, unknown>) {
  const parsed = parseGoogleEmailOtpRegistrationAttemptRecord(response.value);
  if (!parsed || !parsed.runtimePolicyScope) throw invalidResponse();
  return parsed;
}
function pending(response: Record<string, unknown>) {
  const parsed = record(response);
  if (parsed.state !== 'started' && parsed.state !== 'key_finalized') throw invalidResponse();
  return parsed;
}
function acknowledge(response: Record<string, unknown>): void {
  if (response.ok !== true) throw invalidResponse();
}
function invalidResponse(): Error {
  return new Error('Invalid shared registration offer response');
}
