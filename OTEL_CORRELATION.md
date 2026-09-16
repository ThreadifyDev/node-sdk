# OTel thread references

`ThreadifySpanExporter` selects `threadify.external_ref`, then `workflow.run_id` (default), then the trace ID. An explicit `threadify.thread_id` retains precedence. Different traces with the same reference share a thread and its contract; conflicting contracts are rejected by the Engine.

```js
const exporter = new ThreadifySpanExporter(connection, {
  useWorkflowRunId: false, // optional; defaults to true
});
```

The option ignores only `workflow.run_id`. Explicit external references still work. Set reference attributes on every relevant span, or a resource dedicated to that run. References must be nonblank strings of at most 1024 UTF-8 bytes after trimming. Blank values fall through to the next identity choice. Use a unique reference per logical run, not a category shared by unrelated work.

Shared roots do not finish the whole thread. Use `threadify.run.complete: true` to explicitly finish the run. Original trace/span IDs stay in step context, and retries use per-span idempotency keys. A late conflicting identity is rejected; existing stored threads are not merged.

This exporter uses WebSockets and requires the matching Engine correlation update. A standard OTLP/HTTP exporter can instead use `/v1/traces?use_workflow_run_id=false`; both transports share the Engine resolver.

Tests: `node --test tests/otel-correlation.test.mjs`. `tests/live-otel-correlation.mjs` is run by the Engine's disposable binary integration fixture.
