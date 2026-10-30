// Transcribes one bench case with Whisper turbo through the Workers AI binding,
// the same path that Satyr Plan 82 uses. The bench posts base64 WAV audio.
const MODEL = "@cf/openai/whisper-large-v3-turbo";

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("POST a transcription request\n", { status: 405 });
    const body = await request.json();
    const input = { audio: body.audio };
    for (const key of ["language", "initial_prompt", "vad_filter", "beam_size"]) {
      if (body[key] !== undefined && body[key] !== null) input[key] = body[key];
    }
    const started = Date.now();
    const colo = request.cf?.colo ?? null;
    try {
      const result = await env.AI.run(MODEL, input);
      return Response.json({ text: result.text ?? "", aiMs: Date.now() - started, colo });
    } catch (error) {
      return Response.json({ error: String(error), aiMs: Date.now() - started, colo }, { status: 502 });
    }
  },
};
