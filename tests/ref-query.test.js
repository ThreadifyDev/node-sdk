import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DataRetriever } from '../src/DataRetriever.js';
import { Connection } from '../src/Thread.js';

const require = createRequire(import.meta.url);
const cjs = require('../dist/DataRetriever.cjs');
for (const [format, Retriever] of [['ESM', DataRetriever], ['CommonJS', cjs.DataRetriever]]) {
  test(`${format}: ref maps preserve values, filters and archived results`, async () => {
    const reader = new Retriever('http://unused/graphql', 'test-key');
    const calls = [];
    reader.graphqlClient.query = async (query, variables) => {
      calls.push({ query, variables });
      return { threadsByRef: { threads: [{ id: 'thread-1', refs: JSON.stringify({order_id: 'ORD-1001'}) }] } };
    };
    const threads = await reader.getThreadsByRef({ order_id: 'ORD-1001' }, {status: 'completed', limit: 10, offset: 5});
    assert.equal(threads[0].id, 'thread-1');
    assert.equal(typeof threads[0].steps, 'function');
    assert.deepEqual(calls[0].variables, {refKey: 'order_id', refValue: 'ORD-1001', status: 'completed', startedAfter: null, startedBefore: null, limit: 10, offset: 5});
    const first = await reader.getThreadByRef({ 'external.id': '  exact-value  ' });
    assert.equal(first.id, 'thread-1');
    assert.deepEqual(calls[1].variables, {refKey: 'external.id', refValue: '  exact-value  '});
    await reader.getThreadsByRef({status: 'order-status'}, {status: 'active'});
    assert.equal(calls[2].variables.refKey, 'status');
    assert.equal(calls[2].variables.refValue, 'order-status');
    assert.equal(calls[2].variables.status, 'active');
  });

  test(`${format}: no matches return an empty array or null`, async () => {
    const reader = new Retriever('http://unused/graphql', 'test-key');
    reader.graphqlClient.query = async () => ({threadsByRef: {threads: []}});
    assert.deepEqual(await reader.getThreadsByRef({order_id: 'missing'}), []);
    assert.equal(await reader.getThreadByRef({order_id: 'missing'}), null);
  });

  test(`${format}: invalid or ambiguous refs fail before a request`, async () => {
    const reader = new Retriever('http://unused/graphql', 'test-key');
    reader.graphqlClient.query = () => assert.fail('must not query');
    for (const refs of [null, undefined, [], 'order', {}, {a: '1', b: '2'}, {a: 123}, {a: ''}, {' ': 'id'}, {a: '   '}, new Date()]) {
      await assert.rejects(reader.getThreadsByRef(refs), TypeError);
      await assert.rejects(reader.getThreadByRef(refs), TypeError);
    }
  });
}

test('public connection forwards the ref map and separate options', async () => {
  const connection = Object.create(Connection.prototype);
  connection._dataRetriever = {
    getThreadsByRef: async (refs, options) => ({refs, options}),
    getThreadByRef: async refs => refs,
  };
  assert.deepEqual(await connection.getThreadsByRef({order_id: 'ORD-1001'}, {limit: 5}), {refs: {order_id: 'ORD-1001'}, options: {limit: 5}});
  assert.deepEqual(await connection.getThreadByRef({order_id: 'ORD-1001'}), {order_id: 'ORD-1001'});
});
