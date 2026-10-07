import { RouterAbDeriverAWalletDurableObject as Original } from './base/index.js';
import { pairIdentity, observeLocation } from './custody-location.mjs';
export * from './base/index.js';
export { default } from './base/index.js';

export class RouterAbDeriverAWalletDurableObject extends Original {
  async fetch(request) {
    const pair = await pairIdentity(request, 'a_execution');
    const response = await super.fetch(request);
    if (pair !== null && response.status === 200) {
      // A runs the protocol inside this exact wallet object.
      await observeLocation(['a_execution', 'a_do'], pair, request);
    }
    return response;
  }
}
