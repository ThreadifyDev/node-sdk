import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { trace } from '@opentelemetry/api';
import { Threadify } from '../../src/index.js';

// Configuration
// You can pass the API key as an environment variable: THREADIFY_API_KEY=your_key node index.mjs
const API_KEY = process.env.THREADIFY_API_KEY || 'your-api-key-here';
const SERVICE_NAME = 'otel-demo-service';

async function main() {
  console.log('🔗 Connecting to Threadify...');
  
  // 1. Establish Threadify Connection
  let connection;
  try {
    connection = await Threadify.connect(API_KEY, SERVICE_NAME, {
      wsUrl: 'ws://localhost:8081/threads', // Using local backend
      debug: true
    });
    console.log('✅ Connected successfully!');
  } catch (err) {
    console.error('❌ Failed to connect to Threadify:', err.message);
    console.log('\n💡 Make sure your local engine is running and you provided a valid API Key.');
    process.exit(1);
  }

  // 2. Create the Exporter mapping config
  console.log('⚙️ Initializing Threadify OTel SpanExporter...');
  const exporter = connection.createSpanExporter({
    refs: ['order.id', 'customer.id'] // Map these specific span attributes to Threadify Refs
  });

  // 3. Attach to OpenTelemetry
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)]
  });
  trace.setGlobalTracerProvider(provider);

  const tracer = trace.getTracer('demo-tracer');

  // --- Simulate App Execution ---
  console.log('🚀 Simulating application logic...');
  
  // Start a span (This automatically begins a new Thread in Threadify)
  const span = tracer.startSpan('process_payment');

  // Set explicit mapping attributes
  span.setAttribute('threadify.contract', 'payment_workflow'); // Used to route the thread (Optional)
  
  // These will be extracted as Refs!
  span.setAttribute('order.id', 'ORD-98765');
  span.setAttribute('customer.id', 'CUST-123');
  
  // This will just go into Context
  span.setAttribute('payment.amount', 42.50);
  span.setAttribute('payment.method', 'credit_card');

  // Simulate some work...
  setTimeout(async () => {
    
    // Log a sub-step using a Span Event!
    span.addEvent('validated_credit_card', {
      'card.type': 'visa',
      'fraud.score': 0.05
    });

    // End the span (This triggers the Exporter and pushes the Step to Threadify)
    span.end();
    console.log('✅ Span ended and exported to Threadify!');
    
    // Force flush to ensure it sends before exiting
    await provider.forceFlush();
    
    console.log('👋 Demo complete. Check your Threadify database/dashboard!');
    process.exit(0);
  }, 1000);
}

main().catch(console.error);
