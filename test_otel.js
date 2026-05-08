import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { ThreadifySpanExporter } from './src/OtelSpanExporter.js';
import { Connection } from './src/Thread.js';

// Mock connection
class MockConnection extends Connection {
  constructor() {
    super({}, 'test-api-key', 'test-service', 'http://localhost');
    this.isConnected = true;
  }
  start(label, contractName, options) {
    console.log(`[Mock] Starting thread: ${label}`);
    return Promise.resolve({
      threadId: 'thread-123',
      step: (name, service) => ({
        event: {},
        addContext: (ctx) => console.log(`[Mock] addContext:`, ctx),
        addRefs: (refs) => console.log(`[Mock] addRefs:`, refs),
        success: (msg) => console.log(`[Mock] Step ${name} SUCCESS:`, msg),
        failed: (msg) => console.log(`[Mock] Step ${name} FAILED:`, msg)
      })
    });
  }
  _debugLog(...args) {
    console.log(...args);
  }
}

async function test() {
  const connection = new MockConnection();
  const exporter = new ThreadifySpanExporter(connection, {
    refs: ['rider.id'],
    filters: ['invoke_llm', 'adk.before*', 'llm.*']
  });
  
  const provider = new BasicTracerProvider();
  provider.addSpanProcessor(new SimpleSpanProcessor(exporter));
  provider.register();
  
  const tracer = provider.getTracer('test');
  const span = tracer.startSpan('deliver_order');
  span.setAttribute('rider.id', 'RIDER-456');
  span.setAttribute('threadify.contract', 'delivery_contract');
  span.setAttribute('random.data', 42);
  span.end();
  
  await provider.forceFlush();
}

test().catch(console.error);
