import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { trace, context } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { Threadify } from '../../src/index.js';
import { fileURLToPath } from 'url';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runOnboardingFlow(tracer, { customerName, customerId, simulateFailure = false, tags }) {
  console.log(`🚀 Starting Onboarding Flow for ${customerName}...`);
  const rootSpan = tracer.startSpan('user_onboarding');

  rootSpan.setAttribute('threadify.contract', 'onboarding_workflow');
  rootSpan.setAttribute('threadify.label', `Onboarding: ${customerName}`);
  rootSpan.setAttribute('threadify.service', 'onboarding-service');
  if (tags) {
    rootSpan.setAttribute('threadify.tags', tags);
  }
  
  rootSpan.setAttribute('customer.id', customerId);
  rootSpan.setAttribute('customer.name', customerName);

  try {
    await context.with(trace.setSpan(context.active(), rootSpan), async () => {
      // 1. Business verification
      await verifyBusiness(tracer, simulateFailure);
      
      // 2. KYC/KYB
      await performKYC(tracer);
      
      // 3. Identity check
      await checkIdentity(tracer);
      
      // 4. Compliance review
      await reviewCompliance(tracer);
      
      // 5. Account activation
      await activateAccount(tracer, customerId);
    });

    rootSpan.setStatus({ code: 1 }); // OK
    console.log(`✅ Onboarding complete and account activated for ${customerName}`);
    return true;
  } catch (error) {
    rootSpan.setStatus({ code: 2, message: error.message }); // ERROR
    console.error(`❌ Onboarding Failed: ${error.message}`);
    return false;
  } finally {
    rootSpan.end();
  }
}

async function verifyBusiness(tracer, simulateFailure) {
  const span = tracer.startSpan('business_verification');
  span.setAttribute('threadify.service', 'verification-service');
  
  try {
    await delay(200);
    span.addEvent('fetched_company_registry_data');
    
    if (simulateFailure) {
      throw new Error('Business registration not found in public registry.');
    }
    
    span.setAttribute('business.verified', true);
    span.setStatus({ code: 1 });
  } catch (e) {
    span.setStatus({ code: 2, message: e.message });
    throw e;
  } finally {
    span.end();
  }
}

async function performKYC(tracer) {
  const span = tracer.startSpan('kyc_kyb_processing');
  span.setAttribute('threadify.service', 'compliance-service');
  span.setAttribute('provider', 'jumio');
  
  try {
    await delay(300);
    span.setAttribute('kyc.status', 'passed');
    span.setAttribute('kyc.risk_score', 12); // Low risk
    span.setStatus({ code: 1 });
  } catch (e) {
    span.setStatus({ code: 2, message: e.message });
    throw e;
  } finally {
    span.end();
  }
}

async function checkIdentity(tracer) {
  const span = tracer.startSpan('identity_check');
  span.setAttribute('threadify.service', 'identity-provider');
  
  try {
    await delay(150);
    span.addEvent('biometric_check_completed', { 'match_confidence': 0.98 });
    span.setStatus({ code: 1 });
  } catch (e) {
    span.setStatus({ code: 2, message: e.message });
    throw e;
  } finally {
    span.end();
  }
}

async function reviewCompliance(tracer) {
  const span = tracer.startSpan('compliance_review');
  span.setAttribute('threadify.service', 'compliance-service');
  
  try {
    await delay(400); // Simulating manual human touchpoint/review
    span.addEvent('manual_review_completed', { 'reviewer_id': 'REV-992' });
    span.setAttribute('compliance.decision', 'approved');
    span.setStatus({ code: 1 });
  } catch (e) {
    span.setStatus({ code: 2, message: e.message });
    throw e;
  } finally {
    span.end();
  }
}

async function activateAccount(tracer, customerId) {
  const span = tracer.startSpan('account_activation');
  span.setAttribute('threadify.service', 'account-service');
  
  try {
    await delay(100);
    const accountId = `ACC-${Math.floor(Math.random() * 10000)}`;
    span.setAttribute('account.id', accountId);
    span.setAttribute('account.status', 'active');
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
      connection = await Threadify.connect(API_KEY, 'onboarding-service');
    } catch (err) {
      console.error('❌ Failed to connect to Threadify:', err.message);
      process.exit(1);
    }

    const exporter = connection.createSpanExporter({
      refs: ['customer.id', 'account.id']
    });

    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)]
    });
    trace.setGlobalTracerProvider(provider);

    const contextManager = new AsyncHooksContextManager().enable();
    context.setGlobalContextManager(contextManager);

    const tracer = trace.getTracer('onboarding-tracer');

    await runOnboardingFlow(tracer, { customerName: 'Standalone Corp', customerId: 'CUST-123', simulateFailure: false });

    await provider.forceFlush();
    process.exit(0);
  })();
}
