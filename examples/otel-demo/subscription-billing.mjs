import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { trace, context } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { Threadify, ThreadifySpanExporter } from '../../src/index.js';
import { fileURLToPath } from 'url';

const TAGS_KEY = ThreadifySpanExporter.getTagsContextKey();

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runSubscriptionFlow(tracer, { customerId, planName = 'Pro', paymentMethod = 'card', simulateDunning = false, tags }) {
  console.log(`🚀 Starting Subscription Flow for ${customerId} on ${planName} plan...`);
  const rootSpan = tracer.startSpan('manage_subscription');

  rootSpan.setAttribute('threadify.contract', 'subscription_lifecycle_workflow');
  rootSpan.setAttribute('threadify.label', `Subscription: ${customerId}`);
  rootSpan.setAttribute('threadify.service', 'billing-service');
  if (tags) {
    rootSpan.setAttribute('threadify.tags', tags);
  }
  
  const subscriptionId = `SUB-${Date.now()}`;
  rootSpan.setAttribute('subscription.id', subscriptionId);
  rootSpan.setAttribute('customer.id', customerId);
  rootSpan.setAttribute('plan.name', planName);

  try {
    const spanCtx = trace.setSpan(context.active(), rootSpan);
    const ctxWithTags = tags ? spanCtx.setValue(TAGS_KEY, tags) : spanCtx;
    await context.with(ctxWithTags, async () => {
      // 1. Plan Selection
      await selectPlan(tracer, planName);
      
      // 2. Payment Method Setup
      await setupPaymentMethod(tracer, paymentMethod);
      
      // 3. Provisioning
      await provisionServices(tracer, planName);
      
      // 4. Renewal
      await simulateRenewal(tracer, simulateDunning);
      
      if (simulateDunning) {
        // 5. Dunning (if renewal fails)
        await executeDunning(tracer);
      }
    });

    rootSpan.setStatus({ code: 1 }); // OK
    console.log(`✅ Subscription ${subscriptionId} flow completed.`);
    return true;
  } catch (error) {
    rootSpan.setStatus({ code: 2, message: error.message }); // ERROR
    console.error(`❌ Subscription Flow Encountered Issues: ${error.message}`);
    // Might still return true if we just entered dunning and consider that part of the flow
    return !simulateDunning; 
  } finally {
    rootSpan.end();
  }
}

async function selectPlan(tracer, planName) {
  const span = tracer.startSpan('plan_selection');
  span.setAttribute('threadify.service', 'catalog-service');
  try {
    await delay(50);
    span.setAttribute('plan.selected', planName);
    span.setAttribute('plan.price_monthly', planName === 'Enterprise' ? 99.99 : 29.99);
    span.setStatus({ code: 1 });
  } finally {
    span.end();
  }
}

async function setupPaymentMethod(tracer, method) {
  const span = tracer.startSpan('setup_payment_method');
  span.setAttribute('threadify.service', 'billing-service');
  try {
    await delay(100);
    span.setAttribute('payment_method.type', method);
    span.setStatus({ code: 1 });
  } finally {
    span.end();
  }
}

async function provisionServices(tracer, planName) {
  const span = tracer.startSpan('provision_services');
  span.setAttribute('threadify.service', 'provisioning-service');
  try {
    await delay(150);
    span.addEvent('allocated_resources', { storage_gb: planName === 'Enterprise' ? 1000 : 100 });
    span.setStatus({ code: 1 });
  } finally {
    span.end();
  }
}

async function simulateRenewal(tracer, simulateDunning) {
  const span = tracer.startSpan('subscription_renewal');
  span.setAttribute('threadify.service', 'billing-service');
  
  try {
    await delay(120);
    span.setAttribute('renewal.attempt', 1);
    
    if (simulateDunning) {
      span.addEvent('payment_declined', { reason: 'insufficient_funds' });
      throw new Error('Renewal payment failed');
    } else {
      span.setAttribute('renewal.status', 'success');
      span.setStatus({ code: 1 });
    }
  } catch (e) {
    span.setStatus({ code: 2, message: e.message });
    throw e;
  } finally {
    span.end();
  }
}

async function executeDunning(tracer) {
  const span = tracer.startSpan('dunning_process');
  span.setAttribute('threadify.service', 'billing-service');
  
  try {
    await delay(200);
    // Simulate retry logic tracking
    span.addEvent('retry_attempt_1', { status: 'failed', delay_hours: 24 });
    span.addEvent('sent_warning_email', { template: 'payment_failed_warning' });
    
    span.setAttribute('dunning.status', 'active');
    span.setAttribute('account.grace_period_days', 3);
    
    span.setStatus({ code: 2, message: 'Entering grace period due to failed payment' });
  } finally {
    span.end();
  }
}

// Standalone execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const API_KEY = process.env.THREADIFY_API_KEY || 'your-api-key-here';
  
  (async () => {
    let connection;
    try {
      connection = await Threadify.connect(API_KEY, 'billing-service');
    } catch (err) {
      console.error('❌ Failed to connect to Threadify:', err.message);
      process.exit(1);
    }

    const exporter = connection.createSpanExporter({
      refs: ['customer.id', 'subscription.id']
    });

    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)]
    });
    trace.setGlobalTracerProvider(provider);

    const contextManager = new AsyncHooksContextManager().enable();
    context.setGlobalContextManager(contextManager);

    const tracer = trace.getTracer('billing-tracer');

    await runSubscriptionFlow(tracer, { customerId: 'CUST-123', planName: 'Pro', paymentMethod: 'credit_card', simulateDunning: true });

    await provider.forceFlush();
    process.exit(0);
  })();
}
