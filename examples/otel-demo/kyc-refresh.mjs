import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { trace, context } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { Threadify, ThreadifySpanExporter } from '../../src/index.js';

const TAGS_KEY = ThreadifySpanExporter.getTagsContextKey();
import { fileURLToPath } from 'url';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runKycRefreshFlow(tracer, { customerId, partner = 'jumio', simulateSilentFailure = false, tags }) {
  console.log(`🚀 Starting Scheduled KYC Refresh for ${customerId}...`);
  const rootSpan = tracer.startSpan('kyc_periodic_refresh');

  rootSpan.setAttribute('threadify.contract', 'kyc_refresh_workflow');
  rootSpan.setAttribute('threadify.label', `KYC Refresh: ${customerId}`);
  rootSpan.setAttribute('threadify.service', 'compliance-scheduler');
  if (tags) {
    rootSpan.setAttribute('threadify.tags', tags);
  }
  
  const refreshId = `REFRESH-${Date.now()}`;
  rootSpan.setAttribute('refresh.id', refreshId);
  rootSpan.setAttribute('customer.id', customerId);
  rootSpan.setAttribute('trigger.type', 'scheduled');

  try {
    const spanCtx = trace.setSpan(context.active(), rootSpan);
    const ctxWithTags = tags ? spanCtx.setValue(TAGS_KEY, tags) : spanCtx;
    await context.with(ctxWithTags, async () => {
      // 1. Fetch Customer Profile
      await fetchCustomerProfile(tracer, customerId);
      
      // 2. Partner Document Check
      await requestPartnerReverification(tracer, partner, simulateSilentFailure);
      
      // 3. Sanctions List Screening
      await checkSanctionsList(tracer);
      
      // 4. Update Compliance Status
      await updateComplianceStatus(tracer, customerId);
    });

    rootSpan.setStatus({ code: 1 }); // OK
    console.log(`✅ KYC Refresh completed for ${customerId}.`);
    return true;
  } catch (error) {
    if (simulateSilentFailure) {
      // Failing silently, not marking the root as error to avoid waking up on-call
      rootSpan.addEvent('refresh_aborted_silently', { reason: error.message });
      rootSpan.setStatus({ code: 1, message: 'Silently aborted' });
      console.log(`⚠️ KYC Refresh silently aborted: ${error.message}`);
      return false;
    } else {
      rootSpan.setStatus({ code: 2, message: error.message }); // ERROR
      console.error(`❌ KYC Refresh Failed: ${error.message}`);
      return false;
    }
  } finally {
    rootSpan.end();
  }
}

async function fetchCustomerProfile(tracer, customerId) {
  const span = tracer.startSpan('fetch_profile');
  span.setAttribute('threadify.service', 'customer-service');
  try {
    await delay(80);
    span.setAttribute('profile.last_verified', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString()); // 1 year ago
    span.setStatus({ code: 1 });
  } finally {
    span.end();
  }
}

async function requestPartnerReverification(tracer, partner, simulateSilentFailure) {
  const span = tracer.startSpan('partner_reverification');
  span.setAttribute('threadify.service', 'identity-integration');
  span.setAttribute('partner.name', partner);
  
  try {
    await delay(300);
    
    if (simulateSilentFailure) {
      span.addEvent('partner_timeout', { timeout_ms: 10000 });
      span.setStatus({ code: 2, message: 'Partner API timeout' });
      throw new Error('Partner integration timeout');
    }
    
    span.setAttribute('partner.status', 'clean');
    span.setStatus({ code: 1 });
  } catch (e) {
    if (!simulateSilentFailure) {
      span.setStatus({ code: 2, message: e.message });
    }
    throw e;
  } finally {
    span.end();
  }
}

async function checkSanctionsList(tracer) {
  const span = tracer.startSpan('sanctions_screening');
  span.setAttribute('threadify.service', 'compliance-service');
  
  try {
    await delay(150);
    span.addEvent('ofac_list_checked', { hits: 0 });
    span.addEvent('pep_list_checked', { hits: 0 });
    span.setStatus({ code: 1 });
  } finally {
    span.end();
  }
}

async function updateComplianceStatus(tracer, customerId) {
  const span = tracer.startSpan('update_compliance_status');
  span.setAttribute('threadify.service', 'compliance-service');
  
  try {
    await delay(100);
    span.setAttribute('compliance.next_review_date', new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString());
    span.setStatus({ code: 1 });
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
      connection = await Threadify.connect(API_KEY, 'compliance-scheduler');
    } catch (err) {
      console.error('❌ Failed to connect to Threadify:', err.message);
      process.exit(1);
    }

    const exporter = connection.createSpanExporter({
      refs: ['customer.id', 'refresh.id']
    });

    const provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)]
    });
    trace.setGlobalTracerProvider(provider);

    const contextManager = new AsyncHooksContextManager().enable();
    context.setGlobalContextManager(contextManager);

    const tracer = trace.getTracer('kyc-refresh-tracer');

    // To see silent failure in action, change simulateSilentFailure to true
    await runKycRefreshFlow(tracer, { customerId: 'CUST-123', simulateSilentFailure: true });

    await provider.forceFlush();
    process.exit(0);
  })();
}
