import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Connection } from '../src/Thread.js';
const require = createRequire(import.meta.url);

for (const [format, ConnectionClass] of [['ESM', Connection], ['CommonJS', require('../dist/Thread.cjs').Connection]]) {
  function fixture(t, respond) {
    const ws = new EventEmitter(); ws.readyState = 1;
    ws.send = raw => {
      const request = JSON.parse(raw);
      setImmediate(() => respond(request, body => ws.emit('message', Buffer.from(JSON.stringify({
        action: request.action, requestId: request.requestId, status: 'success', ...body,
      })))));
    };
    const connection = new ConnectionClass(ws, 'key', 'agent-service');
    connection.isConnected = true;
    t.after(() => ws.emit('close', 1000, Buffer.alloc(0)));
    return connection;
  }

  test(`${format}: keyed creation and key-only resume load stored contract metadata`, async t => {
    const requests = [];
    const connection = fixture(t, (q, send) => {
      requests.push(q);
      send({ threadId: 'internal', threadKey: q.threadKey, label: 'Session', contractId: 'contract-uuid', contractName: 'agent', contractVersion: 3, refs: { customerId: 'customer' }, tags: ['agent'] });
    });
    const first = await connection.thread(' session ', { label: 'Session', contract: 'agent:3', role: 'processor', refs: { customerId: 'customer' }, tags: ['agent'] });
    const resumed = await connection.thread('session');
    assert.equal(first, resumed, 'preserve notification handlers and pending grants on the same connection');
    assert.equal(resumed.threadKey, 'session');
    assert.equal(resumed.threadId, 'internal');
    assert.equal(resumed.contractName, 'agent');
    assert.equal(resumed.contractVersion, 3);
    assert.equal(resumed.contractId, 'contract-uuid');
    assert.deepEqual(resumed.refs, { customerId: 'customer' });
    assert.equal(typeof resumed.step('tool').success, 'function');
    assert.equal(requests[0].action, 'thread');
    assert.equal(requests[0].contractName, 'agent:3');
    assert.equal(requests[0].role, 'processor');
    assert.equal(requests[0].serviceName, 'agent-service');
    assert.equal(requests[1].contractName, undefined);
    assert.equal(requests[1].refs, undefined);
    assert.notEqual(requests[0].requestId, requests[1].requestId);
  });

  test(`${format}: concurrent keys accept only their own responses`, async t => {
    const connection = fixture(t, (q, send) => setTimeout(() => send({ threadId: `id-${q.threadKey}`, threadKey: q.threadKey }), q.threadKey === 'a' ? 20 : 0));
    const [a, b] = await Promise.all([connection.thread('a'), connection.thread('b')]);
    assert.equal(a.threadId, 'id-a'); assert.equal(b.threadId, 'id-b');
  });

  test(`${format}: closed threads and contract conflicts propagate without fallback creation`, async t => {
    let requests = 0;
    const connection = fixture(t, (q, send) => {
      requests++;
      send({ status: 'error', message: q.threadKey === 'closed' ? 'Cannot add steps to completed thread' : 'contract conflicts with the existing thread binding' });
    });
    await assert.rejects(connection.thread('closed'), /completed thread/);
    await assert.rejects(connection.thread('conflict', { contract: 'wrong' }), /contract conflicts/);
    assert.equal(requests, 2);
    assert.equal(connection.threads.size, 0);
  });

  test(`${format}: invalid keys and options never reach the Engine`, async t => {
    const connection = fixture(t, () => assert.fail('must not send'));
    for (const key of [undefined, null, {}, 42, '', ' ', 'é'.repeat(513)]) {
      await assert.rejects(connection.thread(key), TypeError);
    }
    for (const options of [null, [], 'label', { contractName: 'typo' }, { role: 42 }, { contract: 42 }, { contract: '' }, { label: 42 }, { refs: [] }, { refs: { id: 42 } }, { tags: [42] }]) {
      await assert.rejects(connection.thread('session', options), TypeError);
    }
  });

  test(`${format}: unexpected identities are rejected`, async t => {
    const connection = fixture(t, (_q, send) => send({ threadId: 'internal', threadKey: 'wrong' }));
    await assert.rejects(connection.thread('session'), /invalid thread identity/);
  });
}
