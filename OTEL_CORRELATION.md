# OTel thread keys

`ThreadifySpanExporter` and OTLP ingestion use the same Engine resolver as
`connection.thread(threadKey, options?)`. The identity precedence is:

1. `threadify.thread_id`: an existing internal thread ID.
2. `threadify.thread_key`: the application-owned key, such as a session ID.
3. `workflow.run_id`: optional fallback, enabled by default.
4. Trace ID: fallback when no shared key applies.

```js
await connection.thread(sessionId, {
  label: 'Agent session', contract: 'agent_contract:3', refs: { customerId },
});
const exporter = connection.createSpanExporter({ useWorkflowRunId: false });
// Every turn/tool call can contribute using only the existing session ID.
span.setAttribute('threadify.thread_key', sessionId);
```

Keys are scoped to the authenticated company, trimmed, and limited to 1024 UTF-8
bytes. An explicit `threadify.thread_key` must be a nonblank string. The workflow fallback retains its blank-value fallback behavior. Set the key on
every relevant span or on a resource dedicated to the session.

An existing thread loads its stored contract and pinned version. Spans do not need
to repeat `threadify.contract`; an explicitly conflicting contract is rejected.
Initialize contracted sessions before telemetry starts: a new key without a
contract creates a free-form thread. Labels and tags are creation defaults.
`threadify.ref.*` continues to add ordinary business references.

Shared roots keep the thread open across requests. For free-form threads, send
`threadify.run.complete: true` when the session finishes. Contracted threads
complete through their contract rules. Completion is deferred until all accepted
spans in the current export have been recorded. Closed/terminal threads reject
later writes, including delayed OTLP spans; keep the session open until its work
has arrived. Trace-only threads still complete when their root is exported.

Original trace/span IDs remain in step context, and retries use per-span
idempotency keys. A trace already bound to one thread cannot move to another.
Keys retain their durable identity after cache loss.

`useWorkflowRunId: false` disables only `workflow.run_id`. On OTLP/HTTP use
`/v1/traces?use_workflow_run_id=false`. The JS exporter requires an Engine that
supports the `thread` WebSocket action; `start()`/`join()` remain compatible.

Run `npm test` for ESM/CommonJS, keyed-thread, and exporter tests.
