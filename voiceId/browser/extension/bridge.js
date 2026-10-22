const WALLET_ORIGINS = new Set(['https://localhost:4002', 'http://127.0.0.1:4313']);
const HOST = 'com.seams.voiceid.prototype';

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function keys(value, expected) {
  if (Object.keys(value).length !== expected.length) return false;
  for (const key of expected) if (!Object.hasOwn(value, key)) return false;
  return true;
}

function attempt(value) {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value);
}

function binding(value) {
  return (
    record(value) &&
    keys(value, ['attemptId', 'operationHash', 'expiresAtMs']) &&
    attempt(value.attemptId) &&
    typeof value.operationHash === 'string' &&
    /^[0-9a-f]{64}$/.test(value.operationHash) &&
    Number.isSafeInteger(value.expiresAtMs)
  );
}

function validRequest(value) {
  if (!record(value)) return false;
  if (value.kind === 'status') return keys(value, ['kind', 'id']) && attempt(value.id);
  if (value.kind !== 'listen' || !keys(value, ['kind', 'binding']) || !binding(value.binding))
    return false;
  const remaining = value.binding.expiresAtMs - Date.now();
  return remaining >= 250 && remaining <= 25_000;
}

function sameBinding(left, right) {
  return (
    left.attemptId === right.attemptId &&
    left.operationHash === right.operationHash &&
    left.expiresAtMs === right.expiresAtMs
  );
}

function validReply(value, request) {
  if (!record(value)) return false;
  if (request.kind === 'status') {
    return (
      keys(value, ['kind', 'id', 'enrollment']) &&
      value.kind === 'status' &&
      value.id === request.id &&
      (value.enrollment === 'ready' || value.enrollment === 'empty')
    );
  }
  if (value.kind === 'listening') {
    return (
      keys(value, ['kind', 'binding']) &&
      binding(value.binding) &&
      sameBinding(value.binding, request.binding) &&
      Date.now() < request.binding.expiresAtMs
    );
  }
  return (
    keys(value, ['kind', 'binding', 'outcome']) &&
    value.kind === 'result' &&
    binding(value.binding) &&
    sameBinding(value.binding, request.binding) &&
    ['approved', 'cancelled', 'rejected', 'failed'].includes(value.outcome) &&
    Date.now() < request.binding.expiresAtMs
  );
}

function allowedSender(port) {
  const sender = port.sender;
  if (
    port.name !== 'seams-voiceid-v1' ||
    !sender ||
    !Number.isInteger(sender.tab?.id) ||
    !Number.isInteger(sender.frameId) ||
    typeof sender.documentId !== 'string' ||
    !WALLET_ORIGINS.has(sender.origin)
  )
    return false;
  try {
    return new URL(sender.url).origin === sender.origin;
  } catch {
    return false;
  }
}

class VoiceConnection {
  constructor(external) {
    this.external = external;
    this.state = { kind: 'waiting' };
    this.receive = this.receive.bind(this);
    this.nativeReply = this.nativeReply.bind(this);
    this.nativeClosed = this.nativeClosed.bind(this);
    this.close = this.close.bind(this);
    this.timer = setTimeout(this.close, 60_000);
    external.onMessage.addListener(this.receive);
    external.onDisconnect.addListener(this.close);
  }

  receive(message) {
    if (this.state.kind !== 'waiting' || !validRequest(message)) {
      this.close();
      return;
    }
    const native = chrome.runtime.connectNative(HOST);
    this.state = { kind: 'pending', request: message, native };
    native.onMessage.addListener(this.nativeReply);
    native.onDisconnect.addListener(this.nativeClosed);
    clearTimeout(this.timer);
    const duration = message.kind === 'listen' ? message.binding.expiresAtMs - Date.now() : 60_000;
    this.timer = setTimeout(this.close, duration);
    native.postMessage(message);
  }

  nativeReply(message) {
    const state = this.state;
    if (
      (state.kind !== 'pending' && state.kind !== 'listening') ||
      !validReply(message, state.request)
    ) {
      this.close();
      return;
    }
    if (message.kind === 'listening') {
      if (state.kind !== 'pending') {
        this.close();
        return;
      }
      this.state = { kind: 'listening', request: state.request, native: state.native };
      this.external.postMessage(message);
      return;
    }
    if (
      state.request.kind === 'listen' &&
      state.kind !== 'listening' &&
      message.outcome !== 'failed'
    ) {
      this.close();
      return;
    }
    this.state = { kind: 'completed' };
    this.external.postMessage(message);
    state.native.disconnect();
  }

  nativeClosed() {
    void chrome.runtime.lastError;
    if (this.state.kind === 'pending' || this.state.kind === 'listening') this.close();
  }

  close() {
    const state = this.state;
    if (state.kind === 'closed') return;
    this.state = { kind: 'closed' };
    clearTimeout(this.timer);
    if (state.kind === 'pending' || state.kind === 'listening') state.native.disconnect();
    this.external.disconnect();
  }
}

function connectWallet(port) {
  if (!allowedSender(port)) {
    port.disconnect();
    return;
  }
  new VoiceConnection(port);
}

chrome.runtime.onConnectExternal.addListener(connectWallet);
