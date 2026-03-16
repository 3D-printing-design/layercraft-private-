const express  = require('express');
const router   = express.Router();
const supabase = require('./db');
const { requireAuth } = require('./auth');
const emailService   = require('./email');
const printerService = require('./printer_service');

// ── GET /api/orders ───────────────────────────────────────────
// Admin: list all orders with optional status filter
router.get('/', requireAuth, async (req, res) => {
  try {
    const { status, type, limit = 50, offset = 0 } = req.query;

    let query = supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (status) query = query.eq('order_status', status);
    if (type)   query = query.eq('payment_method', type);

    const { data, error, count } = await query;
    if (error) throw error;

    res.json({ orders: data, count });
  } catch (err) {
    console.error('[ORDERS] GET / error:', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// ── GET /api/orders/:id ───────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !data) return res.status(404).json({ error: 'Order not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// ── PATCH /api/orders/:id/status ──────────────────────────────
// Update order status
// Body: { status: string }
router.patch('/:id/status', requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['new', 'printing', 'ready', 'complete'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const { data, error } = await supabase
      .from('orders')
      .update({ order_status: status, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// ── POST /api/orders/:id/send-to-printer ─────────────────────
// Manually trigger sending the print file to OctoPrint
router.post('/:id/send-to-printer', requireAuth, async (req, res) => {
  try {
    const { data: order } = await supabase
      .from('orders')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (!order.print_file) return res.status(400).json({ error: 'No print file associated with this order' });
    if (order.payment_status !== 'paid') return res.status(400).json({ error: 'Payment not confirmed' });

    await printerService.sendFileToPrinter(order.id, order.print_file);

    // Update print status
    await supabase
      .from('orders')
      .update({ print_status: 'printing', updated_at: new Date().toISOString() })
      .eq('id', order.id);

    res.json({ success: true, message: `${order.print_file} sent to printer` });

  } catch (err) {
    console.error('[ORDERS] send-to-printer error:', err);

    // Update print status to error
    await supabase
      .from('orders')
      .update({ print_status: 'error', updated_at: new Date().toISOString() })
      .eq('id', req.params.id);

    res.status(500).json({ error: err.message || 'Failed to send to printer' });
  }
});

// ── POST /api/orders/:id/email-customer ──────────────────────
// Send a status update email to the customer
// Body: { message?: string }
router.post('/:id/email-customer', requireAuth, async (req, res) => {
  try {
    const { data: order } = await supabase
      .from('orders')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (!order) return res.status(404).json({ error: 'Order not found' });

    await emailService.sendOrderStatusUpdate(order, req.body.message);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// ── POST /api/orders/:id/refund ───────────────────────────────
router.post('/:id/refund', requireAuth, async (req, res) => {
  try {
    const { data: order } = await supabase
      .from('orders')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.payment_status !== 'paid') return res.status(400).json({ error: 'Order is not in a paid state' });

    if (order.payment_method === 'bank' && order.gc_payment_id) {
      const GoCardless = require('gocardless-nodejs');
      const constants  = require('gocardless-nodejs/constants');
      const gc = GoCardless(
        process.env.GC_ENVIRONMENT === 'live' ? process.env.GC_ACCESS_TOKEN : process.env.GC_SANDBOX_TOKEN,
        process.env.GC_ENVIRONMENT === 'live' ? constants.Environments.Live : constants.Environments.Sandbox
      );
      await gc.refunds.create({
        amount:  Math.round(order.total * 100),
        links:   { payment: order.gc_payment_id },
        metadata: { order_id: order.id, reason: 'Customer requested refund' },
      });
    }

    if (order.payment_method === 'card' && order.stripe_pi_id) {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      await stripe.refunds.create({ payment_intent: order.stripe_pi_id });
    }

    await supabase
      .from('orders')
      .update({ payment_status: 'refunded', updated_at: new Date().toISOString() })
      .eq('id', order.id);

    await emailService.sendRefundConfirmation(order);
    res.json({ success: true });

  } catch (err) {
    console.error('[ORDERS] refund error:', err);
    res.status(500).json({ error: 'Refund failed: ' + err.message });
  }
});

// ── GET /api/orders/stats/summary ────────────────────────────
// Dashboard stats
router.get('/stats/summary', requireAuth, async (req, res) => {
  try {
    const [allOrders, paidOrders, pendingOrders] = await Promise.all([
      supabase.from('orders').select('id, total, order_status, payment_status, created_at'),
      supabase.from('orders').select('total').eq('payment_status', 'paid'),
      supabase.from('orders').select('id').in('order_status', ['new', 'printing']),
    ]);

    const revenue = (paidOrders.data || []).reduce((s, o) => s + Number(o.total), 0);
    const totalOrders = (allOrders.data || []).length;
    const pending = (pendingOrders.data || []).length;
    const avgOrder = totalOrders > 0 ? revenue / totalOrders : 0;

    // Revenue last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const recentOrders = (allOrders.data || []).filter(o =>
      o.payment_status === 'paid' && new Date(o.created_at) > sevenDaysAgo
    );
    const recentRevenue = recentOrders.reduce((s, o) => s + Number(o.total), 0);

    res.json({
      totalOrders,
      revenue:        Math.round(revenue * 100) / 100,
      pending,
      avgOrder:       Math.round(avgOrder * 100) / 100,
      recentRevenue:  Math.round(recentRevenue * 100) / 100,
      recentCount:    recentOrders.length,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ── DELETE /api/orders/:id ────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('orders')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete order' });
  }
});

module.exports = router;
