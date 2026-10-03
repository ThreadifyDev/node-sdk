import { Connection, ThreadInstance, connectionClosedError } from './Thread.js';
import { Notification } from './Notification.js';
import { ThreadifySpanExporter } from './OtelSpanExporter.js';
import { connectionEndpoints } from './Endpoints.js';
import { request } from './Wait.js';
import { BrowserAutoCapture } from './BrowserAutoCapture.js';

// Keep the shared Connection protocol independent of Node's EventEmitter API.
class BrowserSocket {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.listeners = [];
  }
  get readyState() { return this.socket.readyState; }
  send(value) { this.socket.send(value); }
  close() { this.socket.close(); }
  on(name, handler) {
    const listener = event => {
      if (name === 'message') handler(event.data);
      else if (name === 'close') handler(event.code, event.reason);
      else if (name === 'error') handler(new Error('WebSocket error'));
      else handler(event);
    };
    this.listeners.push({ name, handler, listener });
    this.socket.addEventListener(name, listener);
  }
  off(name, handler) {
    const index = this.listeners.findIndex(item => item.name === name && item.handler === handler);
    if (index < 0) return;
    const [item] = this.listeners.splice(index, 1);
    this.socket.removeEventListener(name, item.listener);
  }
}

function validGrant(value) {
  const grant = value;
  if (!grant || typeof grant.token !== 'string' || !grant.token.startsWith('tfb_') ||
      !Number.isFinite(Date.parse(grant.expires_at)) || Date.parse(grant.expires_at) <= Date.now()) {
    throw new TypeError('getAccessToken must return an unexpired { token, expires_at } browser grant');
  }
  return grant;
}

function scheduleRenewal(connection, getAccessToken, expiry) {
	connection._browserRenewalCleanup?.();
  const expiresAt = Date.parse(expiry);
  const remaining = expiresAt - Date.now();
  const delay = Math.max(1000, remaining - Math.min(30000, remaining / 2));
  const timer = setTimeout(async () => {
    connection._browserRenewalCleanup?.();
    if (!connection.isConnected) return;
    try {
      const grant = validGrant(await getAccessToken());
      await request(connection, { action: 'renewBrowserToken', browserToken: grant.token });
      scheduleRenewal(connection, getAccessToken, grant.expires_at);
    } catch (error) {
      connection._debugLog('Browser grant renewal failed:', error);
      connection.ws.close();
    }
  }, delay);
  const clear = () => clearTimeout(timer);
  connection._browserRenewalCleanup = () => { clearTimeout(timer); connection.ws.off('close', clear); };
  connection.ws.on('close', clear);
}

/** Browser entry point for the same Threadify SDK. The service key stays on your backend. */
export class ThreadifyBrowser {
  static autoCapture(options) { return new BrowserAutoCapture(options); }

  static async connect({ engineUrl, wsUrl, graphqlUrl, getAccessToken, serviceName = null, debug = false } = {}) {
    if (typeof WebSocket !== 'function') throw new Error('A browser WebSocket implementation is required');
    if (typeof getAccessToken !== 'function') throw new TypeError('getAccessToken is required');
    const grant = validGrant(await getAccessToken());
    if (graphqlUrl && globalThis.location && new URL(graphqlUrl, globalThis.location.href).origin !== globalThis.location.origin) {
      throw new Error('graphqlUrl must be a same-origin application endpoint');
    }
    const { wsUrl: socketURL } = connectionEndpoints({ engineUrl, wsUrl });
    if (!/^wss:/.test(socketURL) && !/^ws:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::|\/)/.test(socketURL)) {
      throw new Error('Browser connections require WSS outside loopback development');
    }
    return new Promise((resolve, reject) => {
      const ws = new BrowserSocket(socketURL);
      // Archived reads require a same-origin application GraphQL proxy.
      const connection = new Connection(ws, null, serviceName, graphqlUrl || null, debug);
      let settled = false;
      const timeout = setTimeout(() => fail(new Error('Connection timeout')), 10000);
      const fail = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        ws.close();
        reject(error);
      };
      ws.on('open', () => ws.send(JSON.stringify({ action: 'connect', browserToken: grant.token, serviceName })));
      const onMessage = data => {
        let response;
        try { response = JSON.parse(data.toString()); } catch { return; }
        if (response.action !== 'connect') return;
        ws.off('message', onMessage);
        if (response.status !== 'success') return fail(new Error(response.message || 'Connection failed'));
        settled = true;
        clearTimeout(timeout);
        connection.isConnected = true;
        scheduleRenewal(connection, getAccessToken, grant.expires_at);
        resolve(connection);
      };
      ws.on('message', onMessage);
      ws.on('error', error => fail(error));
      ws.on('close', (code, reason) => fail(connectionClosedError(code, reason)));
    });
  }
}

export { Connection, ThreadInstance, Notification, ThreadifySpanExporter, BrowserAutoCapture };
export default ThreadifyBrowser;
