const express  = require('express');
const router   = express.Router();
const supabase = require('./db');

// Lazy-load payment providers so missing keys don't crash server
function getGoCardless() {
  const GoCardless  = require('gocardless-nodejs');
  const constants   = require('gocardless-nodejs/constants');
  return GoCardless(
    process.env.GC_ENVIRONMENT === 'live'
      ? process.env.GC_ACCESS_TOKEN
      : process.env.GC_SANDBOX_TOKEN,
    process.env.GC_ENVIRONMENT === 'live'
      ? constants.Environments.Live
      : constants.Environments.Sandbox
  );
}

function getStripe() {
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// ── Helper: generate order ID ─────────────────────────────────
async function generateOrderId() {
  const { data } = await supabase
    .from('orders')
    .select('id')
    .order('created_at', { ascending: false })
    .limit(1);
  const last = data && data[0] ? parseInt(data[0].id.replace('LC-', ''), 10) : 24;
  return `LC-${String(last + 1).padStart(4, '0')}`;
}

// ── Helper: validate promo code ───────────────────────────────
async function validatePromo(code) {
  if (!code) return null;
  const { data } = await supabase
    .from('promo_codes')
    .select('*')
    .eq('code', code.toUpperCase())
    .eq('active', true)
    .single();
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  if (data.max_uses && data.uses_count >= data.max_uses) return null;
  return data;
}

// ── POST /api/payments/create-bank-payment ────────────────────
// Creates a GoCardless BillingRequest + Flow
// Body: { cart, deliveryMethod, deliveryCost, promoCode, customer: { email, firstName, lastName } }
router.post('/create-bank-payment', async (req, res) => {
  try {
    const { cart, deliveryMethod, deliveryCost, promoCode, customer } = req.body;

    if (!cart || !cart.length) return res.status(400).json({ error: 'Cart is empty' });
    if (!customer?.email) return res.status(400).json({ error: 'Customer email required' });

    // Calculate totals
    const subtotal = cart.reduce((s, i) => s + (i.unitPrice * i.qty), 0);
    let discount = 0;
    let promo = null;
    if (promoCode) {
      promo = await validatePromo(promoCode);
      if (promo) discount = Math.round(subtotal * (promo.discount_pct / 100) * 100) / 100;
    }
    const total = Math.round((subtotal - discount + (deliveryCost || 0)) * 100) / 100;
    const amountPence = Math.round(total * 100);

    const orderId = await generateOrderId();

    // Create the order in DB as 'pending' payment
    await supabase.from('orders').insert({
      id:              orderId,
      customer_name:   `${customer.firstName} ${customer.lastName}`,
      customer_email:  customer.email,
      customer_phone:  customer.phone || null,
      address_line1:   customer.address1 || null,
      address_line2:   customer.address2 || null,
      city:            customer.city || null,
      postcode:        customer.postcode || null,
      country:         customer.country || 'United Kingdom',
      items:           cart,
      subtotal,
      discount,
      promo_code:      promoCode || null,
      delivery_method: deliveryMethod,
      delivery_cost:   deliveryCost || 0,
      total,
      payment_method:  'bank',
      payment_status:  'pending',
      order_status:    'new',
    });

    // Create GoCardless BillingRequest
    const gc = getGoCardless();
    const billingRequest = await gc.billingRequests.create({
      payment_request: {
        description: `Layercraft 3D order ${orderId}`,
        amount:      amountPence,
        currency:    'GBP',
        metadata:    { order_id: orderId },
      },
    });

    // Store billing request ID against order
    await supabase
      .from('orders')
      .update({ gc_billing_req_id: billingRequest.id })
      .eq('id', orderId);

    // Create BillingRequestFlow to get the redirect URL
    const flow = await gc.billingRequestFlows.create({
      redirect_uri: `${process.env.BASE_URL}/payment/success?ref=${orderId}`,
      exit_uri:     `${process.env.BASE_URL}/payment/cancelled?ref=${orderId}`,
      billing_request: { id: billingRequest.id },
      prefilled_customer: {
        email:       customer.email,
        given_name:  customer.firstName,
        family_name: customer.lastName,
      },
    });

    // Increment promo code usage
    if (promo) {
      await supabase
        .from('promo_codes')
        .update({ uses_count: promo.uses_count + 1 })
        .eq('code', promo.code);
    }

    res.json({
      orderId,
      billingRequestId:  billingRequest.id,
      authorisationUrl:  flow.authorisation_url,
    });

  } catch (err) {
    console.error('[PAYMENTS] create-bank-payment error:', err);
    res.status(500).json({ error: 'Failed to create payment. Please try again.' });
  }
});

// ── POST /api/payments/create-card-payment ────────────────────
// Creates a Stripe PaymentIntent
// Body: { cart, deliveryMethod, deliveryCost, promoCode, customer }
router.post('/create-card-payment', async (req, res) => {
  try {
    const { cart, deliveryMethod, deliveryCost, promoCode, customer } = req.body;

    if (!cart || !cart.length) return res.status(400).json({ error: 'Cart is empty' });

    const subtotal = cart.reduce((s, i) => s + (i.unitPrice * i.qty), 0);
    let discount = 0;
    if (promoCode) {
      const promo = await validatePromo(promoCode);
      if (promo) discount = Math.round(subtotal * (promo.discount_pct / 100) * 100) / 100;
    }
    const total = Math.round((subtotal - discount + (deliveryCost || 0)) * 100) / 100;
    const amountPence = Math.round(total * 100);

    const orderId = await generateOrderId();

    // Create order in DB
    await supabase.from('orders').insert({
      id:              orderId,
      customer_name:   `${customer.firstName} ${customer.lastName}`,
      customer_email:  customer.email,
      customer_phone:  customer.phone || null,
      address_line1:   customer.address1 || null,
      city:            customer.city || null,
      postcode:        customer.postcode || null,
      country:         customer.country || 'United Kingdom',
      items:           cart,
      subtotal,
      discount,
      promo_code:      promoCode || null,
      delivery_method: deliveryMethod,
      delivery_cost:   deliveryCost || 0,
      total,
      payment_method:  'card',
      payment_status:  'pending',
      order_status:    'new',
    });

    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.create({
      amount:   amountPence,
      currency: 'gbp',
      metadata: { order_id: orderId },
      automatic_payment_methods: { enabled: true },
      receipt_email: customer.email,
    });

    // Store Stripe PI ID
    await supabase
      .from('orders')
      .update({ stripe_pi_id: paymentIntent.id })
      .eq('id', orderId);

    res.json({
      orderId,
      clientSecret: paymentIntent.client_secret,
    });

  } catch (err) {
    console.error('[PAYMENTS] create-card-payment error:', err);
    res.status(500).json({ error: 'Failed to create payment. Please try again.' });
  }
});

// ── POST /api/payments/validate-promo ─────────────────────────
// Body: { code: string }
router.post('/validate-promo', async (req, res) => {
  try {
    const promo = await validatePromo(req.body.code);
    if (!promo) return res.status(404).json({ valid: false, error: 'Code not recognised or expired' });
    res.json({ valid: true, discountPct: promo.discount_pct, code: promo.code });
  } catch (err) {
    res.status(500).json({ error: 'Could not validate code' });
  }
});

module.exports = router;
