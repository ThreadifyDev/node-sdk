import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ThreadifySpanExporter } from '../src/OtelSpanExporter.js';

const span = (attributes = {}, traceId = 'a'.repeat(32), resource = {}) => ({
  name: 'tool.call', attributes, resource: { attributes: resource },
  spanContext: () => ({ traceId, spanId: '1'.repeat(16) }), events: [], status: { code: 1 }
});
function fixture(options) {
  const calls = { starts: [], steps: [], completions: [], refs: [] };
  const thread = {
    step(name) {
      const event = { name }; calls.steps.push(event);
      return { event, subSteps: [], idempotencyKey(key) { event.key = key; }, addContext(ctx) { event.context = ctx; }, async success() {}, async failed() {} };
    },
    addRefs(refs) { calls.refs.push(refs); },
    async complete() { calls.completions.push('complete'); }, async cancel() { calls.completions.push('cancel'); }
  };
  const connection = { isConnected: true, serviceName: 'worker', _debugLog() {}, async getThreadByRef() { return null; }, async start(...args) { calls.starts.push(args); return thread; } };
  return { exporter: new ThreadifySpanExporter(connection, options), calls, connection };
}

test('reference precedence, resource fallback and workflow opt-out', () => {
  const { exporter } = fixture();
  assert.equal(exporter._externalRef(span({ 'workflow.run_id': 'run' })), 'run');
  assert.equal(exporter._externalRef(span({}, undefined, { 'workflow.run_id': 'resource' })), 'resource');
  assert.equal(exporter._externalRef(span({ 'threadify.external_ref': ' explicit ', 'workflow.run_id': 'run' })), 'explicit');
  assert.equal(exporter._externalRef(span({ 'threadify.thread_id': 'internal', 'workflow.run_id': 42 })), null);
  const disabled = fixture({ useWorkflowRunId: false }).exporter;
  assert.equal(disabled._externalRef(span({ 'workflow.run_id': 'run' })), null);
  assert.equal(disabled._externalRef(span({ 'threadify.external_ref': 'explicit' })), 'explicit');
  assert.throws(() => exporter._externalRef(span({ 'workflow.run_id': 42 })), /must be a string/);
  assert.throws(() => exporter._externalRef(span({ 'threadify.external_ref': 'é'.repeat(513) })), /1024 bytes/);
  assert.throws(() => fixture({ useWorkflowRunId: 'false' }), /boolean/);
});

test('shared roots stay open, keep per-span identity and revalidate contracts', async () => {
  const { exporter, calls } = fixture();
  await exporter._processSpan(span({ 'workflow.run_id': 'run', 'threadify.contract': 'a', 'threadify.ref.threadify.external_ref': 'spoof' }));
  await exporter._processSpan(span({ 'workflow.run_id': 'run', 'threadify.contract': 'b' }, 'b'.repeat(32)));
  assert.equal(calls.starts.length, 2);
  assert.equal(calls.starts[0][2].refs['threadify.external_ref'], 'run');
  assert.equal(calls.starts[1][1], 'b');
  assert.notEqual(calls.steps[0].key, calls.steps[1].key);
  assert.equal(calls.steps[0].context['otel.trace_id'], 'a'.repeat(32));
  assert.equal(calls.refs[0]['otel_trace_id'], undefined);
  assert.equal(calls.refs[0]['threadify.external_ref'], undefined);
  assert.deepEqual(calls.completions, []);
  await exporter._processSpan(span({ 'workflow.run_id': 'run', 'threadify.run.complete': true }, 'c'.repeat(32)));
  assert.deepEqual(calls.completions, ['complete']);
});

test('concurrent exports serialize starts and report failed resolution', async () => {
  const { exporter, connection } = fixture();
  let running = 0, max = 0;
  const original = connection.start;
  connection.start = async (...args) => {
    max = Math.max(max, ++running);
    await new Promise(resolve => setTimeout(resolve, 5));
    running--;
    return original(...args);
  };
  const result = await new Promise(resolve => exporter.export(Array.from({ length: 8 }, (_, i) => span({ 'workflow.run_id': String(i) }, String(i).repeat(32))), resolve));
  assert.equal(result.code, 0);
  assert.equal(max, 1);
  connection.start = async () => { throw new Error('contract conflicts'); };
  const failed = await new Promise(resolve => exporter.export([span({ 'workflow.run_id': 'run' })], resolve));
  assert.equal(failed.code, 1);
  assert.match(failed.error.message, /contract conflicts/);
});

test('later spans remember the trace reference without closing the shared thread', async () => {
 const { exporter, calls } = fixture();
 await exporter._processSpan(span({ 'workflow.run_id': 'run' }));
 await exporter._processSpan(span({}));
 assert.equal(calls.starts[1][2].refs['threadify.external_ref'], 'run');
 assert.deepEqual(calls.completions, []);
});

test('trace-only fallback delegates identity to the same Engine resolver', async () => {
 const { exporter, calls } = fixture({ useWorkflowRunId: false });
 await exporter._processSpan(span({ 'workflow.run_id': 'ignored' }));
 assert.deepEqual(calls.starts[0][2].refs, { otel_trace_id: 'a'.repeat(32) });
});
