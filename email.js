const nodemailer = require('nodemailer');

// ── Transport ─────────────────────────────────────────────────
// Uses Resend SMTP (recommended) — resend.com free tier = 3000 emails/month
// To use standard SMTP instead, swap the transport config below
function getTransport() {
  if (process.env.EMAIL_PROVIDER === 'resend') {
    return nodemailer.createTransport({
      host: 'smtp.resend.com',
      port: 465,
      secure: true,
      auth: {
        user: 'resend',
        pass: process.env.RESEND_API_KEY,
      },
    });
  }
  // Generic SMTP fallback (e.g. Gmail, Zoho, custom)
  return nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

const FROM = () => `Layercraft 3D <${process.env.EMAIL_FROM || 'orders@layercraft.co.uk'}>`;
const ADMIN = () => process.env.ADMIN_EMAIL || 'hello@layercraft.co.uk';

// ── Shared HTML wrapper ───────────────────────────────────────
function wrap(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body{font-family:'Helvetica Neue',Arial,sans-serif;background:#f4f4f0;margin:0;padding:0}
    .wrap{max-width:560px;margin:32px auto;background:#fafaf8;border-radius:12px;overflow:hidden;border:1px solid #e2e2dc}
    .header{background:#0e0e0e;padding:24px 32px;display:flex;align-items:center;gap:12px}
    .header-logo{color:#fff;font-family:monospace;font-size:14px;font-weight:600;letter-spacing:-0.3px}
    .body{padding:28px 32px}
    h2{font-size:20px;font-weight:500;color:#0e0e0e;margin:0 0 8px}
    p{font-size:14px;color:#5a5a52;line-height:1.7;margin:0 0 14px}
    .order-box{background:#f4f4f0;border-radius:8px;padding:16px 18px;margin:18px 0}
    .row{display:flex;justify-content:space-between;font-size:13px;padding:5px 0;border-bottom:1px solid #e2e2dc}
    .row:last-child{border-bottom:none}
    .row .label{color:#7a7a72}
    .row .val{font-weight:500;font-family:monospace;font-size:12px}
    .total-row{display:flex;justify-content:space-between;font-size:14px;font-weight:500;padding-top:12px;border-top:1px solid #e2e2dc;margin-top:4px}
    .total-row .val{font-family:monospace}
    .btn{display:inline-block;background:#0e0e0e;color:#fff;text-decoration:none;padding:11px 24px;border-radius:8px;font-size:13px;font-weight:500;margin-top:8px}
    .footer{padding:16px 32px;background:#eeede8;font-size:12px;color:#7a7a72;text-align:center;line-height:1.6}
    .green{color:#0f6e56;font-weight:500}
    .ref{font-family:monospace;background:#eeede8;padding:4px 10px;border-radius:5px;font-size:13px;font-weight:600;color:#0e0e0e}
  </style></head><body>
  <div class="wrap">
    <div class="header">
      <div class="header-logo">◆ LAYERCRAFT 3D</div>
    </div>
    <div class="body">${body}</div>
    <div class="footer">Layercraft 3D · hello@layercraft.co.uk<br>This is an automated message — reply to this email if you have any questions.</div>
  </div></body></html>`;
}

// ── ORDER CONFIRMATION ────────────────────────────────────────
async function sendOrderConfirmation(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsHtml = items.map(i =>
    `<div class="row"><span class="label">${i.p?.name || i.name} × ${i.qty}</span><span class="val">£${(i.unitPrice * i.qty).toFixed(2)}</span></div>`
  ).join('');

  const html = wrap('Order confirmed', `
    <h2>Order confirmed</h2>
    <p>Thank you for your order, ${order.customer_name.split(' ')[0]}. We've received your payment and will start printing shortly.</p>
    <p>Your order reference is <span class="ref">${order.id}</span></p>
    <div class="order-box">
      ${itemsHtml}
      <div class="row"><span class="label">Delivery</span><span class="val">${order.delivery_method} — £${Number(order.delivery_cost).toFixed(2)}</span></div>
      ${order.discount > 0 ? `<div class="row"><span class="label">Discount</span><span class="val green">−£${Number(order.discount).toFixed(2)}</span></div>` : ''}
      <div class="total-row"><span>Total paid</span><span class="val">£${Number(order.total).toFixed(2)}</span></div>
    </div>
    <p>We'll email you again when your print is complete and ready for collection or dispatch. If you have any questions, just reply to this email.</p>
  `);

  await send({ to: order.customer_email, subject: `Order confirmed — ${order.id}`, html });
}

// ── ORDER STATUS UPDATE ───────────────────────────────────────
async function sendOrderStatusUpdate(order, customMessage) {
  const statusMessages = {
    printing: 'Great news — your order is now being printed! We\'ll let you know as soon as it\'s ready.',
    ready:    'Your print is complete and ready! We\'ll be in touch shortly about collection or dispatch.',
    complete: 'Your order is complete and on its way. Thanks for choosing Layercraft 3D!',
  };
  const message = customMessage || statusMessages[order.order_status] || 'Your order status has been updated.';

  const html = wrap('Order update', `
    <h2>Update on your order</h2>
    <p>Hi ${order.customer_name.split(' ')[0]},</p>
    <p>${message}</p>
    <p>Your order reference: <span class="ref">${order.id}</span></p>
    <p>If you have any questions, just reply to this email.</p>
  `);

  await send({ to: order.customer_email, subject: `Update on your order ${order.id}`, html });
}

// ── PAYMENT FAILED ────────────────────────────────────────────
async function sendPaymentFailed(order) {
  const html = wrap('Payment issue', `
    <h2>There was an issue with your payment</h2>
    <p>Hi ${order.customer_name.split(' ')[0]},</p>
    <p>Unfortunately your payment for order <span class="ref">${order.id}</span> could not be completed.</p>
    <p>Please get in touch so we can help resolve this — just reply to this email or contact us at <strong>hello@layercraft.co.uk</strong>.</p>
  `);
  await send({ to: order.customer_email, subject: `Payment issue — order ${order.id}`, html });
}

// ── REFUND CONFIRMATION ───────────────────────────────────────
async function sendRefundConfirmation(order) {
  const html = wrap('Refund processed', `
    <h2>Your refund is on its way</h2>
    <p>Hi ${order.customer_name.split(' ')[0]},</p>
    <p>We've processed a refund of <strong>£${Number(order.total).toFixed(2)}</strong> for order <span class="ref">${order.id}</span>.</p>
    <p>Refunds typically arrive in your bank account within 1–3 business days.</p>
    <p>If you have any questions, please reply to this email.</p>
  `);
  await send({ to: order.customer_email, subject: `Refund processed — ${order.id}`, html });
}

// ── ADMIN: NEW ORDER NOTIFICATION ────────────────────────────
async function sendAdminNewOrder(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const itemsSummary = items.map(i => `${i.p?.name || i.name} × ${i.qty} (${i.p?.mats?.[i.mi] || i.material || ''})`).join(', ');

  const html = wrap('New order received', `
    <h2>New order: ${order.id}</h2>
    <div class="order-box">
      <div class="row"><span class="label">Customer</span><span class="val">${order.customer_name}</span></div>
      <div class="row"><span class="label">Email</span><span class="val">${order.customer_email}</span></div>
      <div class="row"><span class="label">Items</span><span class="val">${itemsSummary}</span></div>
      <div class="row"><span class="label">Payment</span><span class="val">${order.payment_method === 'bank' ? 'GoCardless bank transfer' : 'Card (Stripe)'}</span></div>
      <div class="total-row"><span>Total</span><span class="val">£${Number(order.total).toFixed(2)}</span></div>
    </div>
    <p><a class="btn" href="${process.env.BASE_URL}/admin">View in admin dashboard →</a></p>
  `);

  await send({ to: ADMIN(), subject: `New order ${order.id} — £${Number(order.total).toFixed(2)}`, html });
}

// ── ADMIN: NEW CUSTOM REQUEST ─────────────────────────────────
async function sendAdminCustomRequest(req) {
  const imagesHtml = req.imageUrls.map((url, i) =>
    `<a href="${url}" style="color:#185fa5">Image ${i + 1}</a>`
  ).join(' · ');

  const html = wrap('New custom print request', `
    <h2>New custom request: ${req.id}</h2>
    <div class="order-box">
      <div class="row"><span class="label">Customer</span><span class="val">${req.name}</span></div>
      <div class="row"><span class="label">Email</span><span class="val">${req.email}</span></div>
      <div class="row"><span class="label">Material</span><span class="val">${req.material} — ${req.size}</span></div>
      <div class="row"><span class="label">Estimate</span><span class="val">from £${Number(req.estimate).toFixed(2)}</span></div>
      <div class="row"><span class="label">Description</span><span class="val" style="max-width:280px;text-align:right;white-space:normal">${req.description}</span></div>
      <div class="row"><span class="label">Reference images</span><span class="val">${imagesHtml}</span></div>
    </div>
    <p><a class="btn" href="${process.env.BASE_URL}/admin">View in admin dashboard →</a></p>
  `);

  await send({ to: ADMIN(), subject: `New custom request ${req.id} from ${req.name}`, html });
}

// ── CUSTOMER: CUSTOM REQUEST ACKNOWLEDGEMENT ──────────────────
async function sendCustomRequestAcknowledgement({ name, email, requestId, estimate }) {
  const html = wrap('Request received', `
    <h2>We've received your request</h2>
    <p>Hi ${name.split(' ')[0]},</p>
    <p>Thank you for your custom print request. We'll review your reference images and send you a quote within 24 hours.</p>
    <p>Your request reference is <span class="ref">${requestId}</span></p>
    <p>Estimated starting from <strong>£${Number(estimate).toFixed(2)}</strong> — your quote may vary based on complexity.</p>
    <p>If you have any questions in the meantime, just reply to this email.</p>
  `);
  await send({ to: email, subject: `Custom print request received — ${requestId}`, html });
}

// ── SEND HELPER ───────────────────────────────────────────────
async function send({ to, subject, html }) {
  try {
    const transport = getTransport();
    await transport.sendMail({ from: FROM(), to, subject, html });
    console.log(`[EMAIL] Sent "${subject}" to ${to}`);
  } catch (err) {
    // Log but don't throw — email failure should never break the main flow
    console.error(`[EMAIL] Failed to send "${subject}" to ${to}:`, err.message);
  }
}

module.exports = {
  sendOrderConfirmation,
  sendOrderStatusUpdate,
  sendPaymentFailed,
  sendRefundConfirmation,
  sendAdminNewOrder,
  sendAdminCustomRequest,
  sendCustomRequestAcknowledgement,
};
