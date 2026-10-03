import assert from 'node:assert/strict';
import test from 'node:test';
import { ThreadifyBrowser } from '@threadify/sdk/browser';

class FakeWebSocket {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = new Map();
    this.sent = [];
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => { this.readyState = 1; this.emit('open', {}); });
  }
  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) || new Set();
    listeners.add(listener);
    this.listeners.set(name, listeners);
  }
  removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
  emit(name, event) { for (const listener of this.listeners.get(name) || []) listener(event); }
  send(value) {
    const message = JSON.parse(value);
    this.sent.push(message);
    if (message.action === 'connect' || message.action === 'renewBrowserToken') {
      queueMicrotask(() => this.emit('message', { data: JSON.stringify({ action: message.action, status: 'success', requestId: message.requestId }) }));
    }
    if (message.action === 'thread') {
      queueMicrotask(() => this.emit('message', { data: JSON.stringify({ action: 'thread', status: 'success', requestId: message.requestId, threadId: 'thread-1', threadKey: message.threadKey }) }));
    }
    if (message.action === 'recordThreadEvent') {
      queueMicrotask(() => this.emit('message', { data: JSON.stringify({ action: 'recordThreadEvent', status: 'success', requestId: message.requestId, threadId: message.threadId, stepId: 'step-1' }) }));
    }
  }
  close() { this.readyState = 3; this.emit('close', { code: 1000, reason: '' }); }
}

test('browser entry uses a scoped grant and native WebSocket', async () => {
  const previous = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  try {
    const connection = await ThreadifyBrowser.connect({
      engineUrl: 'http://localhost:8081',
      getAccessToken: () => ({ token: 'tfb_test', expires_at: new Date(Date.now() + 300000).toISOString() })
    });
    const socket = FakeWebSocket.instances.at(-1);
    assert.equal(socket.url, 'ws://localhost:8081/threads');
    assert.deepEqual(socket.sent[0], { action: 'connect', browserToken: 'tfb_test', serviceName: null });
    assert.equal(connection.isConnected, true);
    const thread = await connection.thread('order:1');
    await thread.step('order_placed').addContext({ orderId: '1' }).success();
    assert.equal(socket.sent.find(message => message.action === 'thread').threadKey, 'order:1');
    assert.equal(socket.sent.find(message => message.action === 'recordThreadEvent').threadId, 'thread-1');
    await assert.rejects(connection.getThread('id'), /GraphQL URL not configured/);
    socket.close();
  } finally {
    globalThis.WebSocket = previous;
  }
});

test('browser entry renews a grant before expiry', async () => {
  const previous = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  let issued = 0;
  try {
    const connection = await ThreadifyBrowser.connect({
      engineUrl: 'http://localhost:8081',
      getAccessToken: () => ({ token: `tfb_${++issued}`, expires_at: new Date(Date.now() + 2000).toISOString() })
    });
    const socket = FakeWebSocket.instances.at(-1);
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.ok(socket.sent.some(message => message.action === 'renewBrowserToken' && message.browserToken === 'tfb_2'));
    socket.close();
  } finally {
    globalThis.WebSocket = previous;
  }
});
