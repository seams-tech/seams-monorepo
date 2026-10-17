export class Counter {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    let count = (await this.state.storage.get('count')) || 0;
    if (request.method === 'POST') {
      count += 1;
      await this.state.storage.put('count', count);
    }
    return Response.json({ count });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/counter') {
      return env.COUNTER.get(env.COUNTER.idFromName('service-restart')).fetch(request);
    }
    if (url.pathname === '/inspect') {
      return Response.json({ url: request.url, bytes: (await request.arrayBuffer()).byteLength });
    }
    return new Response('Unknown application route', { status: 404 });
  },
};
