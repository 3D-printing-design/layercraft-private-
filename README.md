# Layercraft 3D — Backend

Production-ready Node.js backend for the Layercraft 3D print studio app.

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Copy environment file and fill in your values
cp .env.example .env

# 3. Set up the database (paste the SQL from src/db.js into Supabase SQL Editor)

# 4. Test all connections
npm test

# 5. Start in development mode
npm run dev

# 6. Start in production
npm start
```

---

## Environment variables

Copy `.env.example` to `.env` and fill in every value. Full descriptions are in the file.

| Variable | Where to get it |
|---|---|
| `SUPABASE_URL` | supabase.com → Project Settings → API |
| `SUPABASE_SERVICE_KEY` | supabase.com → Project Settings → API → service_role key |
| `GC_SANDBOX_TOKEN` | manage-sandbox.gocardless.com → Developers → API Keys |
| `GC_ACCESS_TOKEN` | manage.gocardless.com → Developers → API Keys (live) |
| `GC_WEBHOOK_SECRET` | GoCardless dashboard → Developers → Webhooks → create endpoint |
| `STRIPE_SECRET_KEY` | dashboard.stripe.com → Developers → API Keys |
| `STRIPE_WEBHOOK_SECRET` | Stripe dashboard → Developers → Webhooks → create endpoint |
| `RESEND_API_KEY` | resend.com → API Keys |
| `OCTOPRINT_URL` | Local network address of your Raspberry Pi e.g. `http://192.168.1.50` |
| `OCTOPRINT_API_KEY` | OctoPrint → Settings → API → Global API Key |
| `JWT_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `ADMIN_PASSWORD` | Choose a strong password |

---

## Database setup

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** in your Supabase dashboard
3. Copy all the SQL from `src/db.js` (it's in the comments at the bottom of the file)
4. Run it — this creates all tables, policies, and seeds the LAYER10 promo code

---

## API routes

### Public (no auth required)
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/catalogue` | List active catalogue items |
| `POST` | `/api/payments/create-bank-payment` | Create GoCardless payment |
| `POST` | `/api/payments/create-card-payment` | Create Stripe payment intent |
| `POST` | `/api/payments/validate-promo` | Check a promo code |
| `POST` | `/api/uploads/custom-request` | Submit custom print request with images |
| `POST` | `/api/webhooks/gocardless` | GoCardless webhook receiver |
| `POST` | `/api/webhooks/stripe` | Stripe webhook receiver |

### Admin (JWT required — pass as `Authorization: Bearer <token>`)
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Admin login → returns JWT |
| `POST` | `/api/auth/verify` | Verify token is valid |
| `GET` | `/api/orders` | List all orders |
| `GET` | `/api/orders/:id` | Get single order |
| `PATCH` | `/api/orders/:id/status` | Update order status |
| `POST` | `/api/orders/:id/send-to-printer` | Send print file to OctoPrint |
| `POST` | `/api/orders/:id/email-customer` | Send status email to customer |
| `POST` | `/api/orders/:id/refund` | Issue refund via GoCardless or Stripe |
| `GET` | `/api/orders/stats/summary` | Dashboard statistics |
| `GET` | `/api/uploads/custom-requests` | List custom requests |
| `PATCH` | `/api/uploads/custom-requests/:id` | Update custom request |
| `POST` | `/api/uploads/print-file` | Upload G-code file for an order |
| `GET` | `/api/printer/status` | Live OctoPrint status |
| `POST` | `/api/printer/test` | Test OctoPrint connection |
| `POST` | `/api/printer/control` | Pause / resume / cancel print |
| `GET` | `/api/catalogue` | List catalogue (admin sees inactive too) |
| `POST` | `/api/catalogue` | Add catalogue item |
| `PATCH` | `/api/catalogue/:id` | Edit catalogue item |
| `DELETE` | `/api/catalogue/:id` | Remove catalogue item |

---

## Deployment (Render — recommended for simplicity)

1. Push this folder to a GitHub repo
2. Go to [render.com](https://render.com) → New → Web Service
3. Connect your repo, set **Build command**: `npm install`, **Start command**: `npm start`
4. Add all environment variables from `.env.example` in the Render dashboard
5. Deploy — Render gives you a free HTTPS URL instantly

Alternatively deploy to **Railway**, **Fly.io**, or a **VPS** (DigitalOcean, Hetzner).

---

## Registering webhooks

### GoCardless
1. Go to GoCardless dashboard → **Developers → Webhooks**
2. Create endpoint: `https://your-domain.com/api/webhooks/gocardless`
3. Copy the **Webhook Secret** → set as `GC_WEBHOOK_SECRET` in your `.env`
4. Do this separately for Sandbox and Live environments

### Stripe
1. Go to Stripe dashboard → **Developers → Webhooks**
2. Create endpoint: `https://your-domain.com/api/webhooks/stripe`
3. Select events: `payment_intent.succeeded`, `payment_intent.payment_failed`
4. Copy the **Signing Secret** → set as `STRIPE_WEBHOOK_SECRET` in your `.env`

---

## Admin password setup

```bash
# Generate a bcrypt hash for your admin password
curl -X POST http://localhost:3001/api/auth/hash-password \
  -H "Content-Type: application/json" \
  -d '{"password":"your-strong-password"}'

# Copy the returned hash into your .env as ADMIN_PASSWORD_HASH
# Then remove ADMIN_PASSWORD from .env
```

---

## Auto-print on payment

Set `OCTOPRINT_AUTO_SEND=true` in your `.env` to automatically send the print file
to OctoPrint the moment GoCardless or Stripe confirms payment.

The print file must already be uploaded and linked to the order. Use the admin
dashboard's "Upload print file" button on each order detail panel, or upload via
`POST /api/uploads/print-file` with the `orderId` in the request body.

---

## File storage (Supabase Storage)

Create two storage buckets in your Supabase dashboard:

| Bucket name | Access | Purpose |
|---|---|---|
| `custom-uploads` | Private | Customer reference images |
| `print-files` | Private | G-code files for printing |

Both are private — the backend accesses them using the service role key.
Customers never get direct access to these files.

---

## Go-live checklist

- [ ] `npm test` passes all 5 connection tests
- [ ] Database tables created in Supabase
- [ ] Both storage buckets created
- [ ] GoCardless webhook registered (live environment)
- [ ] Stripe webhook registered
- [ ] `GC_ENVIRONMENT=live` in production `.env`
- [ ] `NODE_ENV=production` in production `.env`
- [ ] `ADMIN_PASSWORD_HASH` set (not plain `ADMIN_PASSWORD`)
- [ ] Place a real £0.01 test order end-to-end
- [ ] Confirm payout appears in client's bank account
- [ ] Confirm confirmation email received by customer
- [ ] Confirm admin notification email received
- [ ] Admin dashboard login works with JWT token
