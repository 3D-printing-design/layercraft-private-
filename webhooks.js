const express  = require('express');
const router   = express.Router();
const supabase = require('./db');
const emailService = require('./email');
const printerService = require('./printer_service');

// ── POST /api/webhooks/gocardless ─────────────────────────────
// Raw body required — configured in server.js before json middleware
router.post('/gocardless', async (req, res) => {
  const signature = req.headers['webhook-signature'];

  let events;
  try {
    const Webhooks = require('gocardless-nodejs/webhooks');
    events = Webhooks.parse(
      req.body,           // raw Buffer
      signature,
      process.env.GC_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[WEBHOOK/GC] Signature verification failed:', err.message);
    return res.status(498).send('Invalid signature');
  }

  // Process each event
  for (const event of events) {
    console.log(`[WEBHOOK/GC] Event: ${event.resource_type}.${event.action}`);

    try {
      // Payment collected from customer's bank
      if (event.resource_type === 'payments' && event.action === 'paid_out') {
        await handleGCPaymentPaid(event);
      }

      // Payment failed
      if (event.resource_type === 'payments' && event.action === 'failed') {
        await handleGCPaymentFailed(event);
      }

      // Billing request fulfilled (customer completed bank flow)
      if (event.resource_type === 'billing_requests' && event.action === 'fulfilled') {
        await handleGCBillingRequestFulfilled(event);
      }

    } catch (err) {
      console.error(`[WEBHOOK/GC] Error processing ${event.resource_type}.${event.action}:`, err);
    }
  }

  res.status(200).send('OK');
});

// ── POST /api/webhooks/stripe ─────────────────────────────────
router.post('/stripe', async (req, res) => {
  const signature = req.headers['stripe-signature'];
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[WEBHOOK/STRIPE] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[WEBHOOK/STRIPE] Event: ${event.type}`);

  try {
    if (event.type === 'payment_intent.succeeded') {
      await handleStripePaymentSucceeded(event.data.object);
    }
    if (event.type === 'payment_intent.payment_failed') {
      await handleStripePaymentFailed(event.data.object);
    }
  } catch (err) {
    console.error('[WEBHOOK/STRIPE] Processing error:', err);
  }

  res.json({ received: true });
});

// ── GOCARDLESS HANDLERS ───────────────────────────────────────

async function handleGCBillingRequestFulfilled(event) {
  // This fires as soon as the customer approves in their bank app
  // The payment hasn't cleared yet but we know it's coming
  const billingReqId = event.links.billing_request;

  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('gc_billing_req_id', billingReqId)
    .single();

  if (!order) {
    console.error(`[WEBHOOK/GC] No order found for billing request: ${billingReqId}`);
    return;
  }

  // Update with GoCardless payment ID
  await supabase
    .from('orders')
    .update({
      gc_payment_id:  event.links.payment,
      payment_status: 'processing',
      updated_at:     new Date().toISOString(),
    })
    .eq('id', order.id);

  console.log(`[WEBHOOK/GC] Billing request fulfilled for order ${order.id}`);
}

async function handleGCPaymentPaid(event) {
  const paymentId = event.links.payment;

  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('gc_payment_id', paymentId)
    .single();

  if (!order) {
    console.error(`[WEBHOOK/GC] No order found for payment: ${paymentId}`);
    return;
  }

  // Mark as paid
  await supabase
    .from('orders')
    .update({
      payment_status: 'paid',
      order_status:   'new',
      updated_at:     new Date().toISOString(),
    })
    .eq('id', order.id);

  console.log(`[WEBHOOK/GC] Payment confirmed for order ${order.id} — £${order.total}`);

  // Send confirmation email to customer
  await emailService.sendOrderConfirmation(order);

  // Notify admin of new order
  await emailService.sendAdminNewOrder(order);

  // Auto-send to printer if enabled and print file exists
  if (process.env.OCTOPRINT_AUTO_SEND === 'true' && order.print_file) {
    try {
      await printerService.sendFileToPrinter(order.id, order.print_file);
      console.log(`[WEBHOOK/GC] Auto-sent ${order.print_file} to printer for order ${order.id}`);
    } catch (printerErr) {
      console.error(`[WEBHOOK/GC] Auto-print failed for order ${order.id}:`, printerErr.message);
      // Don't fail the webhook — order is confirmed regardless of printer status
    }
  }
}

async function handleGCPaymentFailed(event) {
  const paymentId = event.links.payment;

  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('gc_payment_id', paymentId)
    .single();

  if (!order) return;

  await supabase
    .from('orders')
    .update({
      payment_status: 'failed',
      updated_at:     new Date().toISOString(),
    })
    .eq('id', order.id);

  console.log(`[WEBHOOK/GC] Payment FAILED for order ${order.id}`);
  await emailService.sendPaymentFailed(order);
}

// ── STRIPE HANDLERS ───────────────────────────────────────────

async function handleStripePaymentSucceeded(paymentIntent) {
  const orderId = paymentIntent.metadata.order_id;
  if (!orderId) return;

  await supabase
    .from('orders')
    .update({
      payment_status: 'paid',
      order_status:   'new',
      updated_at:     new Date().toISOString(),
    })
    .eq('id', orderId);

  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

  if (!order) return;

  console.log(`[WEBHOOK/STRIPE] Payment confirmed for order ${orderId}`);
  await emailService.sendOrderConfirmation(order);
  await emailService.sendAdminNewOrder(order);

  if (process.env.OCTOPRINT_AUTO_SEND === 'true' && order.print_file) {
    try {
      await printerService.sendFileToPrinter(order.id, order.print_file);
    } catch (err) {
      console.error(`[WEBHOOK/STRIPE] Auto-print failed:`, err.message);
    }
  }
}

async function handleStripePaymentFailed(paymentIntent) {
  const orderId = paymentIntent.metadata.order_id;
  if (!orderId) return;

  await supabase
    .from('orders')
    .update({ payment_status: 'failed', updated_at: new Date().toISOString() })
    .eq('id', orderId);

  const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
  if (order) await emailService.sendPaymentFailed(order);
}

module.exports = router;
