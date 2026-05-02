/**
 * ThreadifySpanExporter - OpenTelemetry SpanExporter implementation
 * This hooks into OpenTelemetry and automatically translates Spans into Threadify Threads and Steps.
 */
export class ThreadifySpanExporter {
  /**
   * Initialize the Threadify Span Exporter
   * @param {import('./Thread.js').Connection} connection - An established Threadify Connection
   * @param {Object} options - Configuration options
   * @param {string[]} [options.refs=[]] - Array of attribute keys to extract into Threadify refs
   */
  constructor(connection, options = {}) {
    if (!connection) {
      throw new Error('A Threadify connection is required to initialize ThreadifySpanExporter');
    }
    this.connection = connection;
    this.options = {
      refs: [],
      ...options
    };
    
    // Map of traceId -> Promise<ThreadInstance>
    // Used to ensure we only create one ThreadInstance per trace
    this.traceThreadMap = new Map();
  }

  /**
   * Internal method to get or start a ThreadInstance for a given trace
   * @private
   */
  async _getOrStartThread(span) {
    const traceId = span.spanContext().traceId;
    
    if (!this.traceThreadMap.has(traceId)) {
      // Create a promise that resolves to the thread instance
      const threadPromise = (async () => {
        // Look for an existing thread ID if provided via attributes
        const existingThreadId = span.attributes['threadify.thread_id'];
        
        if (existingThreadId) {
          const role = span.attributes['threadify.role'] || 'participant';
          return await this.connection.join(existingThreadId, role);
        } else {
          // Determine contract, label, and service
          const contractName = span.attributes['threadify.contract'] || null;
          const label = span.attributes['threadify.label'] || span.name;
          const serviceName = span.attributes['threadify.service'] || this.connection.serviceName;
          const role = span.attributes['threadify.role'] || 'participant';
          
          // Hybrid Approach: Check if thread exists in the backend using getThreadByRef
          try {
            const archivedThread = await this.connection.getThreadByRef({ 
              refKey: 'otel_trace_id', 
              refValue: traceId 
            });
            
            if (archivedThread) {
              this.connection._debugLog(`[ThreadifySpanExporter] Found existing thread ${archivedThread.id} via GraphQL, joining...`);
              return await this.connection.join(archivedThread.id, role);
            }
          } catch (err) {
            this.connection._debugLog('[ThreadifySpanExporter] Failed to query thread by ref, falling back to start:', err.message);
          }
          
          return await this.connection.start(label, contractName, { serviceName });
        }
      })();
      
      this.traceThreadMap.set(traceId, threadPromise);
      
      // Start cleanup timer to prevent memory leaks (traces are usually short-lived)
      // We remove it from the map after 10 minutes. If a span for this trace arrives after 10 mins,
      // it will simply create a new Thread, which is an acceptable edge case for long-running traces.
      setTimeout(() => {
        this.traceThreadMap.delete(traceId);
      }, 10 * 60 * 1000).unref?.(); // Use unref if in Node.js so it doesn't keep process alive
    }
    
    return await this.traceThreadMap.get(traceId);
  }

  /**
   * Process a single span and map it to a Threadify Step
   * @private
   */
  async _processSpan(span) {
    try {
      const thread = await this._getOrStartThread(span);
      
      // Step Name
      const stepName = span.attributes['threadify.step_name'] || span.name;
      const step = thread.step(stepName, span.attributes['threadify.service']);
      
      // Separate attributes into refs, context, and custom mapping
      const context = {};
      const refs = {
        otel_trace_id: span.spanContext().traceId,
        otel_span_id: span.spanContext().spanId
      };
      
      // Map attributes
      for (const [key, value] of Object.entries(span.attributes)) {
        // Skip internal threadify directives
        if (['threadify.thread_id', 'threadify.contract', 'threadify.label', 'threadify.step_name', 'threadify.role', 'threadify.service'].includes(key)) {
          continue;
        }

        if (this.options.refs.includes(key) || key.startsWith('threadify.ref.')) {
          const refKey = key.startsWith('threadify.ref.') ? key.replace('threadify.ref.', '') : key;
          refs[refKey] = value;
        } else if (key.startsWith('threadify.context.')) {
          context[key.replace('threadify.context.', '')] = value;
        } else {
          context[key] = value;
        }
      }
      
      if (Object.keys(context).length > 0) step.addContext(context);
      if (Object.keys(refs).length > 0) step.addRefs(refs);

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
      // In OpenTelemetry, UNSET (0) is the default and implies no error occurred.
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
      if (!span.parentSpanId) {
        if (targetStatus === 'success') {
          await thread.complete('Root span completed successfully');
        } else {
          await thread.cancel(message || 'Root span failed');
        }
        
        // Immediately clean up the map since the trace is completely finished
        this.traceThreadMap.delete(span.spanContext().traceId);
      }
    } catch (error) {
      this.connection._debugLog('[ThreadifySpanExporter] Failed to process span:', error.message);
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

    Promise.all(spans.map(span => this._processSpan(span)))
      .then(() => {
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
