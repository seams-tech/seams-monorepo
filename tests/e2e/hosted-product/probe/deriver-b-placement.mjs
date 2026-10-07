import OriginalWorker, { RouterAbDeriverBWalletDurableObject as OriginalObject } from './base/index.js';
import { pairIdentity, observeLocation } from './custody-location.mjs';
export * from './base/index.js';

export default class DeriverBPlacementProbe extends OriginalWorker {
  async fetch(request) {
    const pair = await pairIdentity(request, 'b_execution');
    const response = await super.fetch(request);
    if (pair !== null && response.status === 101) {
      await observeLocation(['b_execution'], pair, request);
    }
    return response;
  }
}

export class RouterAbDeriverBWalletDurableObject extends OriginalObject {
  async fetch(request) {
    const pair = await pairIdentity(request, 'b_do');
    const response = await super.fetch(request);
    if (pair !== null && response.status === 200) {
      await observeLocation(['b_do'], pair, request);
    }
    return response;
  }
}
