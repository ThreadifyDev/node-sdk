// Invoked against the disposable compiled Engine integration fixture.
import assert from 'node:assert/strict';
import { Threadify } from '../src/index.js';
import { ThreadifySpanExporter } from '../src/OtelSpanExporter.js';
const [url, key, ref, expected] = process.argv.slice(2);
const connection = await Threadify.connect(key, 'correlation-test', { wsUrl: url.replace('http', 'ws') + '/threads' });
const exporter = new ThreadifySpanExporter(connection);
const ids = [];
const start = connection.start.bind(connection);
connection.start = async (...args) => { const thread = await start(...args); ids.push(thread.threadId); return thread; };
const span = (index, attrs = {}) => ({
  name: 'sdk.tool', resource: { attributes: {} }, attributes: { 'workflow.run_id': ref, ...attrs },
  spanContext: () => ({ traceId: index.toString(16).padStart(32, '0'), spanId: index.toString(16).padStart(16, '0') }),
  startTime: [Math.floor(Date.now()/1000), 0], endTime: [Math.floor(Date.now()/1000), 1000], events: [], status: { code: 1 }
});
try {
  const result = await new Promise(resolve => exporter.export([span(1001), span(1002)], resolve));
  assert.equal(result.code, 0, result.error?.message);
  assert.deepEqual(ids, [expected, expected]);
  const conflict = await new Promise(resolve => exporter.export([span(1003, { 'threadify.contract': 'different-contract' })], resolve));
  assert.equal(conflict.code, 1);
  assert.match(conflict.error.message, /contract conflicts/);
  const later = span(1001);
  later.attributes = {};
  later.spanContext = () => ({ traceId: (1001).toString(16).padStart(32, '0'), spanId: 'f'.repeat(16) });
  const missingRef = await new Promise(resolve => exporter.export([later], resolve));
  assert.equal(missingRef.code, 0, missingRef.error?.message);
  assert.equal(ids.at(-1), expected);
  const traceOnly = new ThreadifySpanExporter(connection, { useWorkflowRunId: false });
  const optOut = await new Promise(resolve => traceOnly.export([span(2001), span(2002)], resolve));
  assert.equal(optOut.code, 0, optOut.error?.message);
  assert.notEqual(ids.at(-1), ids.at(-2));
  assert.notEqual(ids.at(-1), expected);
  console.log(JSON.stringify({ passed: true, threadId: expected, sharedSpans: 3, contractConflictRejected: true, workflowOptOut: true }));
} finally { connection.ws.close(); }
