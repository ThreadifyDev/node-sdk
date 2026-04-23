import { Threadify } from '@threadify/sdk';

/**
 * Customer Checkout Flow Example
 * 
 * Instruments a complete checkout thread with 5 steps:
 * 1. validate_cart
 * 2. check_inventory
 * 3. process_payment
 * 4. generate_shipping_label
 * 5. send_confirmation
 *
 * Uses addRefs to attach a customer_id for cross-system lookup.
 */

async function runCheckout(customerId) {
  // 1. Connect to Threadify
  const connection = await Threadify.connect(
    process.env.THREADIFY_LOCAL_API_KEY,
    'checkout-service',
    { url: 'http://localhost:8081/threads' }
  );

  // 2. Start a new thread (no contract)
  const thread = await connection.start("Checkout Thread");
  console.log('Thread started:', thread.id);

  // 3. Add external references — customer_id for support/CRM lookup
  await thread.addRefs({
    customerId: customerId,
    order_id: `ORD-${Date.now()}`,
  });

  // --- Step 1: Validate Cart ---
  await thread.step('validate_cart')
    .addContext({ items: '3', total: '249.97', currency: 'USD' })
    .success();

  // --- Step 2: Check Inventory ---
  try {
    await checkInventory();
    await thread.step('check_inventory')
      .addContext({ sku_count: '3', warehouse: 'US-EAST-1' })
      .success();
  } catch (err) {
    await thread.step('check_inventory')
      .addContext({ error: err.message, sku_count: '3' })
      .failed();
    throw err; // Stop flow
  }

  // --- Step 3: Process Payment ---
  try {
    const payment = await processPayment(249.97);

    // Add payment provider reference after success
    await thread.addRefs({
      stripe_payment_id: payment.id,
    });

    await thread.step('process_payment')
      .addContext({ amount: '249.97', method: 'card', last4: '4242' })
      .success();
  } catch (err) {
    await thread.step('process_payment')
      .addContext({ error: err.message, amount: '249.97' })
      .failed();
    throw err;
  }

  // --- Step 4: Generate Shipping Label ---
  try {
    const label = await generateShippingLabel();
    await thread.step('generate_shipping_label')
      .addContext({ carrier: 'UPS', tracking: label.trackingNumber })
      .success();
  } catch (err) {
    await thread.step('generate_shipping_label')
      .addContext({ error: err.message })
      .failed();
    throw err;
  }

  // --- Step 5: Send Confirmation ---
  try {
    await sendConfirmationEmail(customerId);
    await thread.step('send_confirmation')
      .addContext({ channel: 'email', template: 'order_confirmed' })
      .success();
  } catch (err) {
    // Non-critical: log failure but don't throw
    await thread.step('send_confirmation')
      .addContext({ error: err.message, channel: 'email' })
      .failed();
  }

  console.log('Checkout complete:', thread.id);
  await thread.complete()
  return thread.id;
}

// --- Stub functions (replace with real implementations) ---

async function checkInventory() {
  // Simulate inventory check
  return { available: true };
}

async function processPayment(amount) {
  // Simulate Stripe charge
  return { id: `pi_${Math.random().toString(36).slice(2, 14)}`, status: 'succeeded' };
}

async function generateShippingLabel() {
  // Simulate UPS label generation
  return { trackingNumber: `1Z${Math.random().toString(36).slice(2, 10).toUpperCase()}` };
}

async function sendConfirmationEmail(customerId) {
  // Simulate email service call
  return { sent: true };
}

// Run example
const customerId = 'cust_abc123xyz';
runCheckout(customerId)
  .then((threadId) => {
    console.log('Done. View thread:', threadId);
    process.exit(0);
  })
  .catch((err) => {
    console.error('Checkout failed:', err.message);
    process.exit(1);
  });
