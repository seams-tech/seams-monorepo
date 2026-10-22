import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { isD1DatabaseLike } from '@seams/wallet-server/cloud-host';
import { createD1ConsoleSponsorshipSpendCapService } from '../../../packages/wallet-console-server-ts/src/sponsorshipSpendCaps/d1';
import type { ConsoleSponsorshipSpendCapService } from '../../../packages/wallet-console-server-ts/src/sponsorshipSpendCaps/service';
import {
  releaseSponsoredSpendCap,
  reserveSponsoredSpendCap,
  type SponsorshipSpendPricingService,
} from '../../../packages/wallet-console-server-ts/src/sponsorship/spendCaps';

const now = new Date('2026-10-22T12:00:00.000Z');
const context = { orgId: 'reservation-replay-org', actorUserId: 'sponsor' };
const policy = { period: 'WEEKLY', capsByChain: [{ chainId: 1, capMinor: 100 }] } as const;

const pricing: SponsorshipSpendPricingService = {
  async estimateSponsoredExecutionSpend() {
    return { spendMinor: 80, pricingVersion: 'replay-e2e-v1' };
  },
  async finalizeSponsoredExecutionSpend() {
    return { spendMinor: 80, pricingVersion: 'replay-e2e-v1' };
  },
};

function fixedNow(): Date {
  return new Date(now);
}

async function reserve(
  spendCaps: ConsoleSponsorshipSpendCapService,
  sourceEventId: string,
  mode: 'CHAIN_TOTAL' | 'WALLET_CHAIN_TOTAL',
) {
  return reserveSponsoredSpendCap({
    spendCap: {
      mode,
      period: policy.period,
      capsByChain: [...policy.capsByChain],
    },
    spendCaps,
    pricing,
    ctx: context,
    chainFamily: 'evm',
    intentKind: 'evm_call',
    executorKind: 'evm_eoa',
    environmentId: 'reservation-replay-environment',
    policyId: 'reservation-replay-policy',
    accountRef: mode === 'WALLET_CHAIN_TOTAL' ? 'near:caller-selected-wallet' : null,
    targetRef: 'evm:1:0x1111111111111111111111111111111111111111',
    chainId: 1,
    sourceEventId,
    requestDetails: { fixture: 'same-call' },
  });
}

test('a sponsored request replay preserves the original D1 spend-cap hold', async (_fixtures, testInfo) => {
  const worker = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("replay fixture"); } };',
    compatibilityDate: '2026-04-17',
    d1Databases: { CONSOLE_DB: 'reservation-replay' },
    d1Persist: testInfo.outputPath('state'),
  });
  try {
    const database = await worker.getD1Database('CONSOLE_DB');
    if (!isD1DatabaseLike(database)) throw new Error('D1 test database is unavailable');
    const spendCaps = await createD1ConsoleSponsorshipSpendCapService({
      database,
      namespace: 'reservation-replay',
      ensureSchema: true,
      now: fixedNow,
    });
    await expect(
      reserve(spendCaps, 'evm:evm_call:unverified-wallet', 'WALLET_CHAIN_TOTAL'),
    ).rejects.toMatchObject({ code: 'sponsorship_wallet_cap_unverifiable', status: 409 });
    const first = await reserve(spendCaps, 'evm:evm_call:replayed-execution', 'CHAIN_TOTAL');
    expect(first?.sourceEventId).toBe('evm:evm_call:replayed-execution');

    await expect(
      reserve(spendCaps, 'evm:evm_call:replayed-execution', 'CHAIN_TOTAL'),
    ).rejects.toMatchObject({
      code: 'execution_pending',
      status: 409,
    });
    const held = await spendCaps.getReservationBySourceEventId(
      context,
      'evm:evm_call:replayed-execution',
    );
    expect(held?.status).toBe('RESERVED');
    const usage = await spendCaps.getWindowUsage(context, {
      environmentId: 'reservation-replay-environment',
      policyId: 'reservation-replay-policy',
      chainId: 1,
      mode: 'CHAIN_TOTAL',
      period: 'WEEKLY',
      at: now,
    });
    expect(usage?.reservedMinor).toBe(80);
    await expect(
      reserve(spendCaps, 'evm:evm_call:second-execution', 'CHAIN_TOTAL'),
    ).rejects.toMatchObject({
      code: 'spend_cap_exceeded',
    });

    await releaseSponsoredSpendCap({ reservation: first, spendCaps, ctx: context });
    const second = await reserve(spendCaps, 'evm:evm_call:second-execution', 'CHAIN_TOTAL');
    expect(second?.sourceEventId).toBe('evm:evm_call:second-execution');
    const evidencePath = testInfo.outputPath('sponsorship-cap-replay.json');
    await writeFile(
      evidencePath,
      `${JSON.stringify(
        {
          replayStatus: 409,
          unverifiedWalletCapStatus: 409,
          heldReservationStatus: held?.status,
          reservedMinorAfterReplay: usage?.reservedMinor,
          secondExecutionDeniedWhileHeld: true,
          secondExecutionAllowedAfterRelease: second?.sourceEventId,
        },
        null,
        2,
      )}\n`,
    );
    await testInfo.attach('sponsorship-cap-replay', {
      path: evidencePath,
      contentType: 'application/json',
    });
  } finally {
    await worker.dispose();
  }
});
