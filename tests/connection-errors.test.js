import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Connection, ThreadInstance } from '../src/Thread.js';

// Fail promptly instead of letting an unresolved SDK promise stall the test run.
async function observed(promise) {
  let timer;
  try { return await Promise.race([promise.then(() => 'resolved', e => e), new Promise(resolve => { timer = setTimeout(() => resolve('hung'), 100); })]); }
  finally { clearTimeout(timer); }
}

for (const operation of ['start', 'step', 'complete']) {
  test(`${operation} rejects when Engine closes the socket while a response is pending`, async () => {
    const ws = new EventEmitter();
    ws.readyState = 1;
    ws.send = () => {};
    const connection = new Connection(ws, 'test-api-key', 'sdk-test');
    connection.isConnected = true;
    const thread = new ThreadInstance(connection, 'thread-id', null, null, null, {});
    const pending = operation === 'start' ? connection.start('test') : operation === 'step' ? thread.step('test').success() : thread.complete();
    ws.readyState = 3;
    ws.emit('close', 1006, Buffer.alloc(0));
    const result = await observed(pending);
    assert.ok(result instanceof Error, `expected rejection, got ${result}`);
    assert.equal(result.code, 'THREADIFY_CONNECTION_CLOSED');
    assert.equal(connection._pendingResponseHandlers.length, 0);
  });
}

for (const [reason, closeCode, code, status] of [
  ['registry_allowance_exceeded', 1008, 'THREADIFY_ALLOWANCE_EXCEEDED', 429],
  ['license_unavailable', 1008, 'THREADIFY_LICENSE_UNAVAILABLE', 503],
  ['accounting_unavailable', 1013, 'THREADIFY_ACCOUNTING_UNAVAILABLE', 503],
]) {
  test(`explicit ${reason} close preserves a useful SDK error`, async () => {
    const ws = new EventEmitter(); ws.readyState = 1; ws.send = () => {};
    const connection = new Connection(ws, 'test-key'); connection.isConnected = true;
    const pending = connection.start('test');
    ws.readyState = 3; ws.emit('close', closeCode, Buffer.from(reason));
    const error = await observed(pending);
    assert.equal(error.code, code); assert.equal(error.status, status); assert.equal(error.closeCode, closeCode);
  });
}

test('HTTP allowance denial survives SDK GraphQL error handling', async t => {
  const {DataRetriever} = await import('../src/DataRetriever.js');
  t.mock.method(globalThis, 'fetch', async () => new Response('', {status: 429}));
  await assert.rejects(new DataRetriever('http://localhost/graphql', 'key').getThread('id'), {status: 429, code: 'THREADIFY_ALLOWANCE_EXCEEDED'});
});

test('successful response remains successful and clears the pending listener', async () => {
  const ws = new EventEmitter(); ws.readyState = 1; ws.send = () => {};
  const connection = new Connection(ws, 'key'); connection.isConnected = true;
  const pending = connection.start('test');
  ws.emit('message', Buffer.from(JSON.stringify({action: 'startThread', status: 'success', threadId: 'created-id'})));
  assert.equal((await pending).id, 'created-id');
  assert.equal(connection._pendingResponseHandlers.length, 0);
  ws.emit('close', 1000, Buffer.alloc(0));
});

test('SDK connect rejects HTTP upgrade denial with status and clears handshake timeout', async () => {
  const http = await import('node:http');
  const {Threadify} = await import('../src/index.js');
  const server = http.createServer((_req,res) => {res.writeHead(429);res.end();});
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  try {
    await assert.rejects(Threadify.connect('key','test',{wsUrl:`ws://127.0.0.1:${server.address().port}/threads`}), {status:429,code:'THREADIFY_ALLOWANCE_EXCEEDED'});
  } finally {await new Promise(resolve => server.close(resolve));}
});

test('SDK connect rejects an Engine close before the connect acknowledgement', async () => {
  const {WebSocketServer} = await import('ws');
  const {Threadify} = await import('../src/index.js');
  const server = new WebSocketServer({host:'127.0.0.1',port:0});
  await new Promise(resolve => server.once('listening',resolve));
  server.on('connection',socket => socket.close(1008,'license_unavailable'));
  try {
    await assert.rejects(Threadify.connect('key','test',{wsUrl:`ws://127.0.0.1:${server.address().port}/threads`}), {status:503,code:'THREADIFY_LICENSE_UNAVAILABLE'});
  } finally {await new Promise(resolve => server.close(resolve));}
});
