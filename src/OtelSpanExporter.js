import { context, createContextKey } from '@opentelemetry/api';

const startQueues = new WeakMap();

// Trace-only fallback preserves the Engine trace identity namespace.
// The legacy WebSocket protocol matches start responses by action. Serialize those starts
// on each connection so concurrent traces cannot consume each other's response.
function startThread(connection, ...args) {
  const previous = startQueues.get(connection) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => connection.start(...args));
  const settled = current.catch(() => {});
  startQueues.set(connection, settled);
  settled.then(() => { if (startQueues.get(connection) === settled) startQueues.delete(connection); });
  return current;
}

const THREADIFY_TAGS_KEY = createContextKey('threadify.tags');

/**
 * ThreadifySpanExporter - OpenTelemetry SpanExporter implementation
 * This hooks into OpenTelemetry and automatically translates Spans into Threadify Threads and Steps.
 */
export class ThreadifySpanExporter {
  /**
   * Get the OTel context key used for propagating threadify.tags across child spans.
   * @returns {symbol}
   */
  static getTagsContextKey() {
    return THREADIFY_TAGS_KEY;
  }
  /**
   * Initialize the Threadify Span Exporter
   * @param {import('./Thread.js').Connection} connection - An established Threadify Connection
   * @param {Object} options - Configuration options
   * @param {(string[]|Object)} [options.refs=[]] - Array of attribute keys or object mapping {attributeKey: refKey}
   * @param {string[]} [options.filters=[]] - Span-name patterns to drop. Trailing * is a wildcard prefix match; otherwise exact match. Example: ["invoke_llm", "adk.before*", "llm.*"]
   */
  constructor(connection, options = {}) {
    if (!connection) {
      throw new Error('A Threadify connection is required to initialize ThreadifySpanExporter');
    }
    this.connection = connection;
    this.options = {
      refs: [],
      filters: [],
      useWorkflowRunId: true,
      ...options
    };
    
    if (typeof this.options.useWorkflowRunId !== 'boolean') {
      throw new TypeError('useWorkflowRunId must be a boolean');
    }

    // Normalize refs to object format for easier lookup
    if (Array.isArray(this.options.refs)) {
      const refMap = {};
      this.options.refs.forEach(key => {
        refMap[key] = key;
      });
      this.options.refsMap = refMap;
    } else {
      this.options.refsMap = this.options.refs || {};
    }
    
    // Span-name filters; e.g. ["invoke_llm", "adk.before*", "llm.*"]
    this.filters = this.options.filters || [];

    // Map of traceId -> Promise<ThreadInstance>
    // Used to ensure we only create one ThreadInstance per trace
    this.traceThreadMap = new Map();
    this.traceThreadKeys = new Map();
  }

  /**
   * Check whether a span name matches any configured drop filter.
   * @private
   * @param {string} name - The span name to test
   * @returns {boolean} - True if the span should be dropped
   */
  _shouldDrop(name) {
    for (const filter of this.filters) {
      if (!filter) continue;
      if (filter.endsWith('*')) {
        const prefix = filter.slice(0, -1);
        if (name.startsWith(prefix)) {
          return true;
        }
        continue;
      }
      if (name === filter) {
        return true;
      }
    }
    return false;
  }

  /**
   * Internal method to get or start a ThreadInstance for a given trace
   * @private
   */
  // Explicit internal thread targets preserve their existing behavior.
  _threadKey(span) {
    const attrs = { ...(span.resource?.attributes || {}), ...span.attributes };
    if (attrs['threadify.thread_id']) return null;
    for (const key of ['threadify.thread_key', ...(this.options.useWorkflowRunId ? ['workflow.run_id'] : [])]) {
      const value = attrs[key];
      if (value === undefined) continue;
      if (typeof value !== 'string') throw new TypeError(`${key} must be a string`);
      const ref = value.trim();
      if (new TextEncoder().encode(ref).length > 1024) throw new Error(`${key} exceeds 1024 bytes`);
      if (ref) return ref;
      if (key === 'threadify.thread_key') throw new TypeError('threadKey must be a non-empty string');
    }
    return this.traceThreadKeys.get(span.spanContext().traceId) || null;
  }

  async _getOrStartThread(span) {
    const traceId = span.spanContext().traceId;
    const threadKey = this._threadKey(span);
    // Resolve every correlated span at the Engine so contract changes cannot hide in a client cache.
    if (threadKey) {
      const attrs = { ...(span.resource?.attributes || {}), ...span.attributes };
      const options = { label: attrs['threadify.label'] || span.name, serviceName: attrs['threadify.service'] || this.connection.serviceName, refs: { otel_trace_id: traceId } };
      if (attrs['threadify.contract']) options.contract = attrs['threadify.contract'];
      if (attrs['threadify.role']) options.role = attrs['threadify.role'];
      if (attrs['threadify.tags']) options.tags = Array.isArray(attrs['threadify.tags']) ? attrs['threadify.tags'] : [attrs['threadify.tags']];
      const thread = await this.connection.thread(threadKey, options);
      if (!this.traceThreadKeys.has(traceId)) {
        this.traceThreadKeys.set(traceId, threadKey);
        setTimeout(() => this.traceThreadKeys.delete(traceId), 10 * 60 * 1000).unref?.();
      }
      return thread;
    }
    
    if (!this.traceThreadMap.has(traceId)) {
      // Create a promise that resolves to the thread instance
      const threadPromise = (async () => {
        // Look for an existing thread ID if provided via attributes
        const existingThreadId = span.attributes['threadify.thread_id'] ?? span.resource?.attributes?.['threadify.thread_id'];
        
        if (existingThreadId) {
          const role = span.attributes['threadify.role'] || 'participant';
          return await this.connection.join(existingThreadId, role);
        } else {
          // Determine contract, label, and service
          const contractName = span.attributes['threadify.contract'] || null;
          const label = span.attributes['threadify.label'] || span.name;
          const serviceName = span.attributes['threadify.service'] || this.connection.serviceName;
          const role = span.attributes['threadify.role'] || 'participant';
          
          const tagsFromSpan = span.attributes['threadify.tags'];
          const tagsFromContext = context.active().getValue(THREADIFY_TAGS_KEY);
          const tags = tagsFromSpan || tagsFromContext;
          const startOpts = { serviceName, refs: { otel_trace_id: traceId } };
          if (tags) {
            startOpts.tags = Array.isArray(tags) ? tags : [tags];
          }
          return await startThread(this.connection, label, contractName, startOpts);
        }
      })();
      
      this.traceThreadMap.set(traceId, threadPromise);
      
      // Start cleanup timer to prevent memory leaks (traces are usually short-lived)
      // We remove it from the map after 10 minutes. If a span for this trace arrives after 10 mins,
      // the Engine resolves the same durable trace identity again.
      setTimeout(() => {
        this.traceThreadMap.delete(traceId);
      }, 10 * 60 * 1000).unref?.(); // Use unref if in Node.js so it doesn't keep process alive
    }
    
    const thread = await this.traceThreadMap.get(traceId);
    if (thread.threadKey && !this.traceThreadKeys.has(traceId)) {
      this.traceThreadKeys.set(traceId, thread.threadKey);
      setTimeout(() => this.traceThreadKeys.delete(traceId), 10 * 60 * 1000).unref?.();
    }
    return thread;
  }

  /**
   * Process a single span and map it to a Threadify Step
   * @private
   */
  async _processSpan(span, completions = null) {
    try {
      const thread = await this._getOrStartThread(span);
      
      // Step Name
      const stepName = span.attributes['threadify.step_name'] || span.name;
      const step = thread.step(stepName, span.attributes['threadify.service']);
      step.idempotencyKey(`otel:${span.spanContext().traceId}:${span.spanContext().spanId}`);
      if (span.attributes['threadify.invocation_id']) step.event.invocationId = span.attributes['threadify.invocation_id'];
      
      // Separate attributes into refs, context, and custom mapping
      const context = {};
      const refs = {
        otel_trace_id: span.spanContext().traceId,
        otel_span_id: span.spanContext().spanId
      };
      
      if (this._threadKey(span)) delete refs.otel_trace_id;
      context['otel.trace_id'] = span.spanContext().traceId;
      context['otel.span_id'] = span.spanContext().spanId;

      // Map attributes
      for (const [key, value] of Object.entries(span.attributes)) {
        // Skip internal threadify directives
        if (['threadify.thread_key', 'threadify.thread_id', 'threadify.contract', 'threadify.label', 'threadify.step_name', 'threadify.role', 'threadify.service', 'threadify.tags', 'threadify.invocation_id'].includes(key)) {
          continue;
        }

        if (this.options.refsMap[key] || key.startsWith('threadify.ref.')) {
          const refKey = key.startsWith('threadify.ref.') ? key.replace('threadify.ref.', '') : this.options.refsMap[key];
          if (refKey !== 'threadify.thread_key') refs[refKey] = value;
        } else if (key.startsWith('threadify.context.')) {
          context[key.replace('threadify.context.', '')] = value;
        } else {
          context[key] = value;
        }
      }
      
      if (Object.keys(context).length > 0) step.addContext(context);
      if (Object.keys(refs).length > 0) await thread.addRefs(refs);

      // Map Timing
      if (span.startTime) {
        // startTime is [seconds, nanoseconds]
        const startTimeMs = span.startTime[0] * 1000 + span.startTime[1] / 1000000;
        step.event.startedAt = new Date(startTimeMs).toISOString();
      }
      
      if (span.endTime) {
        const endTimeMs = span.endTime[0] * 1000 + span.endTime[1] / 1000000;
        step.event.finishedAt = new Date(endTimeMs).toISOString();
      }

      // Map Events to Sub-Steps
      if (span.events && span.events.length > 0) {
        for (const event of span.events) {
          const eventTimeMs = event.time ? (event.time[0] * 1000 + event.time[1] / 1000000) : Date.now();
          step.subSteps.push({
            name: event.name,
            status: 'success',
            payload: event.attributes || {},
            recordedAt: new Date(eventTimeMs).toISOString()
          });
        }
      }

      // Map Status
      // SpanStatusCode: 0 = UNSET, 1 = OK, 2 = ERROR
      const statusCode = span.status ? span.status.code : 0;
      let targetStatus = 'success';
      let message = span.status ? span.status.message : undefined;
      
      if (statusCode === 2) { // ERROR
        targetStatus = 'failed';
      }
      
      if (targetStatus === 'success') {
        await step.success(message);
      } else {
        await step.failed(message || 'Span ended with error status');
      }

      // Root Span Auto-Complete
      // If this span has no parent, it is the Root Span. When it ends, the trace is done.
      // We automatically end the Threadify thread based on the root span's status.
      const parentSpanId = span.parentSpanId || span.parentSpanContext?.spanId || null;
      const explicitTarget = span.attributes['threadify.thread_id'] ?? span.resource?.attributes?.['threadify.thread_id'];
      if (!explicitTarget && !thread.contractName && !thread.contractId &&
          ((!parentSpanId && !this._threadKey(span)) || (this._threadKey(span) && span.attributes['threadify.run.complete'] === true))) {
        const complete = async () => {
          if (targetStatus === 'success') await thread.complete('Root span completed successfully');
          else await thread.cancel(message || 'Root span failed');
          this.traceThreadMap.delete(span.spanContext().traceId);
        };
        if (completions) completions.set(thread.threadId || this._threadKey(span) || span.spanContext().traceId, complete);
        else await complete();
      }
    } catch (error) {
      this.connection._debugLog('[ThreadifySpanExporter] Failed to process span:', error.message);
      throw error;
    }
  }

  /**
   * Export batch of spans
   * @param {import('@opentelemetry/sdk-trace-base').ReadableSpan[]} spans 
   * @param {Function} resultCallback 
   */
  export(spans, resultCallback) {
    if (!this.connection.isConnected) {
      // If not connected, fail the export
      resultCallback({ code: 1, error: new Error('Threadify connection is not open') }); // ExportResultCode.FAILED
      return;
    }

    const filtered = spans.filter(span => !this._shouldDrop(span.name));
    const completions = new Map();
    Promise.all(filtered.map(span => this._processSpan(span, completions)))
      .then(async () => {
        // A completion marker must not close a thread ahead of other spans in this batch.
        for (const complete of completions.values()) await complete();
        resultCallback({ code: 0 }); // ExportResultCode.SUCCESS
      })
      .catch(error => {
        resultCallback({ code: 1, error }); // ExportResultCode.FAILED
      });
  }

  /**
   * Force flush
   * @returns {Promise<void>}
   */
  forceFlush() {
    return Promise.resolve();
  }

  /**
   * Shutdown the exporter
   * @returns {Promise<void>}
   */
  shutdown() {
    return Promise.resolve();
  }
}
