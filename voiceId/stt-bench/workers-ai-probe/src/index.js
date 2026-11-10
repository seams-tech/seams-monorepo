const WHISPER = "@cf/openai/whisper-large-v3-turbo";
const NOVA = "@cf/deepgram/nova-3";
const FLUX = "@cf/deepgram/flux";

function decodeBase64(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

async function timed(request, run) {
  const started = Date.now();
  const colo = request.cf?.colo ?? null;
  try {
    return Response.json({ ...(await run()), aiMs: Date.now() - started, colo });
  } catch (error) {
    return Response.json({ error: String(error), aiMs: Date.now() - started, colo }, { status: 502 });
  }
}

async function whisper(request, env) {
  const body = await request.json();
  const input = { audio: body.audio };
  for (const key of ["language", "initial_prompt", "vad_filter", "beam_size"]) {
    if (body[key] !== undefined && body[key] !== null) input[key] = body[key];
  }
  return timed(request, async () => {
    const result = await env.AI.run(WHISPER, input);
    return { text: result.text ?? "" };
  });
}

async function nova(request, env) {
  const body = await request.json();
  const audio = decodeBase64(body.audio);
  const input = {
    audio: { body: new Blob([audio]).stream(), contentType: "audio/wav" },
    language: body.language,
    smart_format: true,
    mip_opt_out: true,
  };
  if (body.keyterm) input.keyterm = body.keyterm;
  return timed(request, async () => {
    const result = await env.AI.run(NOVA, input);
    return { text: result.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "" };
  });
}

async function flux(request, url, env) {
  const input = { encoding: "linear16", sample_rate: "16000", mip_opt_out: "true" };
  for (const key of ["eot_threshold", "eager_eot_threshold", "eot_timeout_ms"]) {
    if (url.searchParams.has(key)) input[key] = url.searchParams.get(key);
  }
  const keyterms = url.searchParams.getAll("keyterm");
  if (keyterms.length > 0) input.keyterm = keyterms;
  const response = await env.AI.run(FLUX, input, { websocket: true });
  return new Response(null, {
    status: 101,
    webSocket: response.webSocket,
    headers: { "x-probe-colo": request.cf?.colo ?? "" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/flux") return flux(request, url, env);
    if (url.pathname === "/colo") return Response.json({ colo: request.cf?.colo ?? null });
    if (request.method !== "POST") return new Response("POST a transcription request\n", { status: 405 });
    return url.pathname === "/nova-3" ? nova(request, env) : whisper(request, env);
  },
};
