import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';
import { WebSocketServer } from 'ws';
import { Threadify } from '../src/index.js';

const require = createRequire(import.meta.url);
const commonjs = require('../dist/index.cjs');

// Exercise real HTTP and WebSocket transports, including deployment path prefixes, in both package formats.
for (const [format, SDK] of [['ESM', Threadify], ['CommonJS', commonjs.Threadify]]) {
  for (const prefix of ['', '/proxy/threads/customer']) {
    test(`${format}: one engineUrl connects and queries through ${prefix || '/'}`, async () => {
      const calls = [];
      const server = http.createServer(async (req, res) => {
        let body = '';
        for await (const chunk of req) body += chunk;
        calls.push({ path: req.url, auth: req.headers['x-api-key'], body: JSON.parse(body) });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: { thread: { id: 'thread-test', name: 'Test' } } }));
      });
      const sockets = new WebSocketServer({ server });
      sockets.on('connection', (socket, req) => {
        socket.on('message', bytes => {
          const message = JSON.parse(bytes);
          calls.push({ path: req.url, message });
          socket.send(JSON.stringify({ action: 'connect', status: 'success' }));
        });
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      try {
        const engineUrl = `http://127.0.0.1:${server.address().port}${prefix}/`;
        const connection = await SDK.create({ apiKey: 'test-key', serviceName: 'engine-url-test', engineUrl }).connect();
        const thread = await connection.getThread('thread-test');
        assert.equal(thread.id, 'thread-test');
        assert.equal(calls[0].path, prefix + '/threads');
        assert.equal(calls[0].message.apiKey, 'test-key');
        assert.equal(calls[0].message.serviceName, 'engine-url-test');
        assert.equal(calls[1].path, prefix + '/graphql');
        assert.equal(calls[1].auth, 'test-key');
        assert.equal(calls[1].body.variables.id, 'thread-test');
      } finally {
        for (const socket of sockets.clients) socket.terminate();
        await new Promise(resolve => sockets.close(resolve));
        server.closeAllConnections?.();
        await new Promise(resolve => server.close(resolve));
      }
    });
  }
  test(`${format}: invalid and ambiguous addresses fail before connecting`, async () => {
    for (const engineUrl of ['', null, 123, 'engine.test', 'ws://engine.test', 'https://user:password@engine.test', 'https://engine.test?key=secret', 'https://engine.test#path']) {
      await assert.rejects(SDK.connect('key', 'test', { engineUrl }), /engineUrl/);
    }
    for (const field of ['url', 'wsUrl', 'graphqlUrl']) {
      await assert.rejects(SDK.connect('key', 'test', { engineUrl: 'https://engine.test', [field]: 'https://other.test' }), /on its own/);
    }
  });
}
