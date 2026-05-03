import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { trace, context } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
// Import Threadify local SDK code
import { Threadify } from '../../src/index.js';

// Configuration
// Pass the API key as an environment variable: THREADIFY_API_KEY=your_key node loan-application-example.mjs
const API_KEY = process.env.THREADIFY_API_KEY || 'your-api-key-here';

// Utility for simulating async work
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 UNHANDLED REJECTION:', reason);
  if (Array.isArray(reason)) {
    console.error('Array contents:', JSON.stringify(reason, null, 2));
  }
});

async function main() {
  console.log('🔗 Connecting to Threadify...');

  // Initialize Threadify connection for the root service
  let connection;
  try {
    connection = await Threadify.connect(API_KEY, 'api-gateway', {
      wsUrl: process.env.THREADIFY_WS_URL || 'ws://localhost:8081/threads',
    });
    console.log('✅ Connected successfully!');
  } catch (err) {
    console.error('❌ Failed to connect to Threadify:', err.message);
    process.exit(1);
  }

  // Setup OTel Span Exporter to automatically send traces to Threadify
  const exporter = connection.createSpanExporter({
    refs: ['application.id', 'customer.id', 'account.id'] // Global refs we want extracted from spans
  });

  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)]
  });
  trace.setGlobalTracerProvider(provider);

  // MUST register AsyncHooksContextManager to preserve context across await boundaries
  const contextManager = new AsyncHooksContextManager().enable();
  context.setGlobalContextManager(contextManager);

  const tracer = trace.getTracer('loan-origination-tracer');

  console.log('🚀 Starting Complex Financial Loan Application Flow...');

  // 1. API Gateway Service (Root Span)
  const rootSpan = tracer.startSpan('receive_loan_application');

  // Tagging with Threadify specific attributes
  rootSpan.setAttribute('threadify.contract', 'loan_origination_workflow');
  rootSpan.setAttribute('threadify.label', 'Auto Loan Application');
  rootSpan.setAttribute('threadify.service', 'api-gateway');

  // Business context
  rootSpan.setAttribute('application.id', `APP-${Date.now()}`);
  rootSpan.setAttribute('customer.id', 'CUST-88990');
  rootSpan.setAttribute('loan.type', 'auto');
  rootSpan.setAttribute('loan.amount', 35000);

  try {
    // Run the rest of the flow in the context of the root span
    await context.with(trace.setSpan(context.active(), rootSpan), async () => {

      // 2. User Service - Identity Verification
      await verifyIdentity(tracer);

      // 3. Credit Bureau Service - Credit Check
      const creditScore = await checkCredit(tracer);

      // 4. Risk Assessment Service - Decision Engine
      const decision = await assessRisk(tracer, creditScore);

      if (decision.status !== 'approved') {
        throw new Error('Application rejected due to high risk.');
      }

      // 5. Loan Origination Service - Account Creation & Funding
      await originateLoan(tracer);

    });

    rootSpan.setStatus({ code: 1 }); // OK
    console.log('✅ Loan Application Approved and Funded.');
  } catch (error) {
    rootSpan.setStatus({ code: 2, message: error.message }); // ERROR
    console.error(`❌ Loan Application Failed: ${error.message}`);
  } finally {
    rootSpan.end();
  }

  // Ensure all spans are exported before exiting
  await provider.forceFlush();
  console.log('👋 Flow complete. Check your Threadify database/dashboard!');
  process.exit(0);
}

// --- Service Simulators ---

async function verifyIdentity(tracer) {
  // Creating a child span in the context of the root span
  const span = tracer.startSpan('verify_identity');
  span.setAttribute('threadify.service', 'user-service');

  try {
    await delay(150);
    // Add sub-step events
    span.addEvent('checked_government_db', { 'match.score': 99 });

    await delay(100);
    span.setAttribute('kyc.status', 'verified');
    span.setAttribute('kyc.provider', 'socure');
    span.setStatus({ code: 1 });
  } catch (e) {
    span.setStatus({ code: 2, message: e.message });
    throw e;
  } finally {
    span.end();
  }
}

async function checkCredit(tracer) {
  const span = tracer.startSpan('pull_credit_report');
  span.setAttribute('threadify.service', 'credit-bureau-service');
  span.setAttribute('bureau', 'equifax');

  try {
    await delay(300);
    const score = 750; // Simulated score
    span.setAttribute('credit.score', score);
    span.setAttribute('credit.history_length_years', 8);
    span.setStatus({ code: 1 });
    return score;
  } catch (e) {
    span.setStatus({ code: 2, message: e.message });
    throw e;
  } finally {
    span.end();
  }
}

async function assessRisk(tracer, creditScore) {
  const span = tracer.startSpan('assess_risk');
  span.setAttribute('threadify.service', 'risk-assessment-service');

  try {
    await delay(400);
    span.setAttribute('risk.model_version', 'v2.4.1');

    let decision = { status: 'approved', rate: 4.5 };
    if (creditScore < 650) {
      decision = { status: 'rejected', reason: 'score_too_low' };
      span.setStatus({ code: 2, message: 'Risk too high' });
    } else {
      span.setStatus({ code: 1 });
    }

    span.setAttribute('risk.tier', creditScore >= 750 ? 'tier_1' : 'tier_2');
    span.setAttribute('approval.status', decision.status);
    if (decision.rate) span.setAttribute('approval.interest_rate', decision.rate);

    return decision;
  } catch (e) {
    span.setStatus({ code: 2, message: e.message });
    throw e;
  } finally {
    span.end();
  }
}

async function originateLoan(tracer) {
  const span = tracer.startSpan('originate_loan_account');
  span.setAttribute('threadify.service', 'loan-origination-service');

  try {
    await delay(250);
    const accountId = `LOAN-ACC-${Math.floor(Math.random() * 1000000)}`;

    span.setAttribute('account.id', accountId); // Extracted as a global Ref
    span.setAttribute('funding.status', 'initiated');
    span.setAttribute('funding.disbursement_date', new Date().toISOString());

    span.addEvent('core_banking_system_updated', {
      'system': 'fiserv',
      'latency_ms': 42
    });

    span.setStatus({ code: 1 });
    return accountId;
  } catch (e) {
    span.setStatus({ code: 2, message: e.message });
    throw e;
  } finally {
    span.end();
  }
}

main();
