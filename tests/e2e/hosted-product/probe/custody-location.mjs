// Temporary hosted diagnostics. Restore the original Worker versions after the run.
export async function pairIdentity(request, role) {
  const path = new URL(request.url).pathname;
  let value;
  if (role === 'b_execution' && path.endsWith('/ed25519-yao/duplex')) {
    const scope = request.headers.get('x-seams-yao-wallet-pair-scope');
    if (scope === null) return null;
    value = JSON.parse(scope);
  } else if (role === 'a_execution' && path.endsWith('/wallet-pair/execute-work')) {
    value = await request.clone().json();
  } else if (role === 'b_do' && path === '/router-ab/internal/deriver-b/wallet-pair') {
    value = (await request.clone().json()).scope;
  } else {
    return null;
  }
  const bytes = value.pair_binding.pair_digest.bytes;
  if (!Array.isArray(bytes) || bytes.length !== 32) throw new Error('Invalid probe pair digest');
  return bytes.map(hexByte).join('');
}

function hexByte(byte) {
  return byte.toString(16).padStart(2, '0');
}

export async function observeLocation(scopes, pairDigest, request) {
  const startedAt = Date.now();
  const observation = {
    event: 'custody_execution_location_probe',
    scopes,
    pairDigest,
    observedAt: new Date(startedAt).toISOString(),
    ingressColo: request.cf?.colo ?? null,
    kind: 'outbound_trace_observation',
  };
  try {
    const response = await fetch('https://cloudflare.com/cdn-cgi/trace', {
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error(`Trace returned ${response.status}`);
    const fields = new URLSearchParams((await response.text()).trim().replaceAll('\n', '&'));
    const colo = fields.get('colo');
    const country = fields.get('loc');
    if (!/^[A-Z]{3}$/.test(colo ?? '') || !/^[A-Z]{2}$/.test(country ?? '')) {
      throw new Error('Trace location is absent');
    }
    console.log(JSON.stringify({ ...observation, status: 'observed', colo, country, probeMs: Date.now() - startedAt }));
  } catch (error) {
    console.log(JSON.stringify({ ...observation, status: 'unavailable', error: String(error), probeMs: Date.now() - startedAt }));
  }
}
