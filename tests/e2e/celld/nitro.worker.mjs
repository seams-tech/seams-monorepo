/* global WebSocketPair */

export { Counter } from './single-vm.worker.mjs';

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === '/counter') {
      return env.COUNTER.get(env.COUNTER.idFromName('nitro-restart')).fetch(request);
    }
    if (path === '/echo') {
      return new Response(request.body);
    }
    if (path === '/outbound') {
      return fetch('https://s3.us-east-1.amazonaws.com/');
    }
    if (path === '/websocket') {
      const pair = new WebSocketPair();
      pair[1].accept();
      pair[1].addEventListener('message', echoMessage.bind(null, pair[1]));
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return new Response('Not found', { status: 404 });
  },
};

function echoMessage(socket, event) {
  socket.send(event.data);
}
