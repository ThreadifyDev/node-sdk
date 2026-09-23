// Invoked only by the disposable Engine integration fixture.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Threadify } from '../src/index.js';
const { THREADIFY_ENGINE_URL: engineUrl, THREADIFY_API_KEY: apiKey, THREADIFY_CONTRACT: contract } = process.env;
const a = await Threadify.connect(apiKey, 'worker-service', { engineUrl });
const b = await Threadify.connect(apiKey, 'worker-service', { engineUrl });
const session = randomUUID();
try {
  const first = await a.thread(session, { label: 'Contract session', contract, refs: { customerId: 'customer-1' } });
  const resumed = await b.thread(session);
  assert.equal(resumed.threadId, first.threadId);
  assert.equal(resumed.contractName, contract);
  assert.equal(resumed.contractVersion, 1);
  assert.equal(resumed.refs.customerId, 'customer-1');
  await assert.rejects(b.thread(session, { contract: 'wrong-contract' }), /contract conflicts/);
  await resumed.step('received').idempotencyKey('first-turn').success();
  const freeKey = randomUUID();
  const concurrent = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).thread(freeKey, { label: 'Agent session' })));
  assert.equal(new Set(concurrent.map(t => t.threadId)).size, 1);
  const free = concurrent[0];
  const span = i => ({
    name: 'tool', attributes: { 'threadify.thread_key': freeKey }, resource: { attributes: {} },
    spanContext: () => ({ traceId: i.toString(16).padStart(32, '0'), spanId: i.toString(16).padStart(16, '0') }),
    startTime: [Math.floor(Date.now()/1000), 0], endTime: [Math.floor(Date.now()/1000), 1000], events: [], status: { code: 1 },
  });
  const exporter = b.createSpanExporter();
  const result = await new Promise(resolve => exporter.export([span(1), span(2)], resolve));
  assert.equal(result.code, 0, result.error?.message);
  assert.equal((await b.thread(freeKey)).threadId, free.threadId);
  await free.complete('Session finished');
  await assert.rejects(b.thread(freeKey), /completed thread/);
  await assert.rejects(free.step('late').success(), /completed thread/);
  const late = await new Promise(resolve => exporter.export([span(3)], resolve));
  assert.equal(late.code, 1);
  assert.match(late.error.message, /completed thread/);
  console.log(JSON.stringify({ threadId: free.threadId, threadKey: freeKey, contractThreadId: first.threadId }));
} finally { a.ws.close(); b.ws.close(); }
