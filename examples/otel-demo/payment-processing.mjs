import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { trace, context } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { Threadify } from '../../src/index.js';
import { fileURLToPath } from 'url';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runPaymentProcessingFlow(tracer, { amount, currency = 'USD', paymentPartner = 'stripe', simulateFailure = false, customerId, tags }) {
  console.log(`🚀 Starting Payment Processing Flow for ${amount} ${currency} via ${paymentPartner}...`);
  const rootSpan = tracer.startSpan('process_payment');

  rootSpan.setAttribute('threadify.contract', 'payment_processing_workflow');
  rootSpan.setAttribute('threadify.label', `Payment: ${customerId}`);
  rootSpan.setAttribute('threadify.service', 'payment-gateway');
  if (tags) {
    rootSpan.setAttribute('threadify.tags', tags);
  }
  
  const paymentId = `PAY-${Date.now()}`;
  rootSpan.setAttribute('payment.id', paymentId);
  rootSpan.setAttribute('payment.amount', amount);
  rootSpan.setAttribute('payment.currency', currency);
  rootSpan.setAttribute('payment.partner', paymentPartner);
  if (customerId) rootSpan.setAttribute('customer.id', customerId);

  try {
    await context.with(trace.setSpan(context.active(), rootSpan), async () => {
      // 1. Payment Initiated
      await initiatePayment(tracer, paymentId);
      
      // 2. Fraud Check
      await checkFraud(tracer, amount);
      
      // 3. Bank Partner processing
      await processWithBankPartner(tracer, paymentPartner, simulateFailure);
      
      // 4. Settlement
      await settlePayment(tracer);
      
      // 5. Notification
      await sendNotification(tracer, customerId);
    });

    rootSpan.setStatus({ code: 1 }); // OK
    console.log(`✅ Payment ${paymentId} processed successfully.`);
    return true;
  } catch (error) {
    rootSpan.setStatus({ code: 2, message: error.message }); // ERROR
    console.error(`❌ Payment Failed: ${error.message}`);
    return false;
  } finally {
    rootSpan.end();
  }
}

async function initiatePayment(tracer, paymentId) {
  const span = tracer.startSpan('initiate_payment');
  span.setAttribute('threadify.service', 'payment-gateway');
  
  try {
    await delay(50);
    span.setAttribute('payment.status', 'initiated');
    span.setStatus({ code: 1 });
  } catch (e) {
    span.setStatus({ code: 2, message: e.message });
    throw e;
  } finally {
    span.end();
  }
}

async function checkFraud(tracer, amount) {
  const span = tracer.startSpan('fraud_check');
  span.setAttribute('threadify.service', 'fraud-service');
  
  try {
    await delay(100);
    const score = amount > 10000 ? 85 : 15; // Higher amount = higher risk score
    span.setAttribute('fraud.score', score);
    
    if (score > 90) {
      throw new Error('Transaction blocked by fraud detection rules.');
    }
    
    span.setStatus({ code: 1 });
  } catch (e) {
    span.setStatus({ code: 2, message: e.message });
    throw e;
  } finally {
    span.end();
  }
}

async function processWithBankPartner(tracer, partner, simulateFailure) {
  const span = tracer.startSpan('bank_partner_processing');
  span.setAttribute('threadify.service', 'bank-integration-service');
  span.setAttribute('partner.name', partner);
  
  try {
    await delay(200);
    
    if (simulateFailure) {
      span.addEvent('partner_timeout', { timeout_ms: 5000 });
      throw new Error(`Timeout communicating with bank partner ${partner}`);
    }
    
    span.setAttribute('partner.transaction_id', `TXN-${Math.floor(Math.random() * 1000000)}`);
    span.setStatus({ code: 1 });
  } catch (e) {
    span.setStatus({ code: 2, message: e.message });
    throw e;
  } finally {
    span.end();
  }
}

async function settlePayment(tracer) {
  const span = tracer.startSpan('settlement');
  span.setAttribute('threadify.service', 'ledger-service');
  
  try {
    await delay(80);
    span.setAttribute('settlement.status', 'cleared');
    span.setStatus({ code: 1 });
  } catch (e) {
    span.setStatus({ code: 2, message: e.message });
    throw e;
  } finally {
    span.end();
  }
}

async function sendNotification(tracer, customerId) {
  const span = tracer.startSpan('send_receipt_notification');
  span.setAttribute('threadify.service', 'notification-service');
  
  try {
    await delay(40);
    span.addEvent('email_sent', { template: 'payment_receipt' });
    span.setStatus({ code: 1 });
  } catch (e) {
    span.setStatus({ code: 2, message: e.message });
    throw e;
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
      connection = await Threadify.connect(API_KEY, 'payment-gateway');
    } catch (err) {
      console.error('❌ Failed to connect to Threadify:', err.message);
      process.exit(1);
    }

    const exporter = connection.createSpanExporter({
      refs: ['customer.id', 'payment.id']
    });

    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)]
    });
    trace.setGlobalTracerProvider(provider);

    const contextManager = new AsyncHooksContextManager().enable();
    context.setGlobalContextManager(contextManager);

    const tracer = trace.getTracer('payment-tracer');

    await runPaymentProcessingFlow(tracer, { amount: 150.00, currency: 'USD', paymentPartner: 'stripe', customerId: 'CUST-123' });

    await provider.forceFlush();
    process.exit(0);
  })();
}
