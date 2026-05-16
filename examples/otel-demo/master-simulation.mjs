import { BasicTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { trace, context } from '@opentelemetry/api';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { Threadify } from '../../src/index.js';

import { runOnboardingFlow } from './onboarding-process.mjs';
import { runPaymentProcessingFlow } from './payment-processing.mjs';
import { runSubscriptionFlow } from './subscription-billing.mjs';
import { runKycRefreshFlow } from './kyc-refresh.mjs';

// Parse command line arguments
const args = process.argv.slice(2);
let customerName = 'Acme Corp';
let paymentPartner = 'stripe';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--customer' && args[i+1]) {
    customerName = args[i+1];
    i++;
  } else if (args[i] === '--payment-partner' && args[i+1]) {
    paymentPartner = args[i+1];
    i++;
  }
}

const customerId = `CUST-${Math.floor(Math.random() * 10000)}`;

async function main() {
  const API_KEY = process.env.THREADIFY_LOCAL_API_KEY || 'your-api-key-here';
  
  console.log('🔗 Connecting to Threadify...');
  let connection;
  try {
    connection = await Threadify.connect(API_KEY, 'user-journey-orchestrator', {
      wsUrl: 'ws://localhost:8081/threads', debug: true
    });
    console.log('✅ Connected successfully!');
  } catch (err) {
    console.error('❌ Failed to connect to Threadify:', err.message);
    process.exit(1);
  }

  // Setup OTel Span Exporter to capture all references globally across flows
  const exporter = connection.createSpanExporter({
    refs: {
      'customer.id': 'customerId',
      'payment.id': 'paymentId',
      'subscription.id': 'subscriptionId',
      'account.id': 'accountId'
    }
  });

  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)]
  });
  trace.setGlobalTracerProvider(provider);

  const contextManager = new AsyncHooksContextManager().enable();
  context.setGlobalContextManager(contextManager);

  console.log(`\n======================================================`);
  console.log(`🚀 Starting Full User Journey Simulation for: ${customerName}`);
  console.log(`   Customer ID: ${customerId}`);
  console.log(`======================================================\n`);

  try {
    // 1. Onboarding
    const onboardingTracer = trace.getTracer('onboarding-tracer');
    const onboardingSuccess = await runOnboardingFlow(onboardingTracer, {
      customerName,
      customerId,
      simulateFailure: false,
      tags: ['onboarding', 'kyc', 'compliance']
    });

      if (!onboardingSuccess) {
        console.log('🛑 User Journey stopped at onboarding.');
        return;
      }

      console.log('\n--- Transitioning to Payment Processing ---\n');
      
      // 2. Initial Setup/Fee Payment
      const paymentTracer = trace.getTracer('payment-tracer');
      const paymentSuccess = await runPaymentProcessingFlow(paymentTracer, {
        amount: 500.00,
        currency: 'USD',
        paymentPartner,
        customerId,
        simulateFailure: false,
        tags: ['payment', 'setup-fee', paymentPartner]
      });

      if (!paymentSuccess) {
        console.log('🛑 User Journey stopped at initial payment.');
        return;
      }

      console.log('\n--- Transitioning to Subscription Billing ---\n');
      
      // 3. Subscription Billing (Simulating a failed renewal/dunning scenario to show tracking)
      const billingTracer = trace.getTracer('billing-tracer');
      await runSubscriptionFlow(billingTracer, {
        customerId,
        planName: 'Enterprise',
        paymentMethod: paymentPartner === 'stripe' ? 'credit_card' : 'bank_transfer',
        simulateDunning: true,
        tags: ['subscription', 'billing', 'recurring']
      });

      console.log('\n--- Transitioning to Scheduled Tasks (Fast Forward 1 Year) ---\n');
      
    // 4. Periodic KYC Refresh (Simulating a silent failure due to partner timeout)
    const complianceTracer = trace.getTracer('compliance-tracer');
    await runKycRefreshFlow(complianceTracer, {
      customerId,
      partner: 'jumio',
      simulateSilentFailure: true,
      tags: ['compliance', 'kyc-refresh', 'periodic']
    });

  } catch (err) {
    console.error(`❌ Unexpected error in orchestration: ${err.message}`);
  }

  console.log(`\n======================================================`);
  console.log(`🏁 User Journey Simulation Complete!`);
  console.log(`======================================================\n`);

  await provider.forceFlush();
  process.exit(0);
}

main();
