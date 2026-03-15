# Layercraft 3D — Complete App

This folder contains everything needed to run the Layercraft 3D print studio app.

## Contents

```
layercraft.html        ← The complete frontend (shop + checkout + admin)
README.md              ← Full deployment guide
package.json           ← Node.js dependencies
.env.example           ← Copy to .env and fill in your values
src/
  server.js            ← Main Express server
  db.js                ← Supabase client + SQL schema
  test-connections.js  ← Run before going live
  routes/
    auth.js            ← Admin login (JWT)
    payments.js        ← GoCardless bank + Stripe card
    webhooks.js        ← GoCardless + Stripe webhook receivers
    orders.js          ← Order management, send-to-printer, refunds
    uploads.js         ← Custom request image uploads + print files
    printer.js         ← OctoPrint proxy (status, control)
    catalogue.js       ← Catalogue CRUD
  services/
    email.js           ← All 7 email templates (Resend/SMTP)
    printer.js         ← OctoPrint API wrapper
```

## 5-step setup

1. `npm install`
2. `cp .env.example .env`  — fill in every value (see README.md)
3. Paste the SQL from `src/db.js` into your Supabase SQL Editor
4. `npm test`  — all 5 connection checks should pass
5. `npm start`  — server runs on port 3001

## What is connected to what

- Customers pay via **GoCardless** (bank) or **Stripe** (card)
- Payment confirmation fires a **webhook** → order confirmed → email sent
- If auto-print is enabled, the webhook also sends the print file to **OctoPrint**
- Your client manages everything from the **Admin** section of the app
- All orders and uploads are stored in **Supabase**
- Emails sent via **Resend** (or any SMTP)

## Demo mode

If no backend is running, the app works fully as a prototype —
all interactions are functional using local demo data.
When the backend is running, it seamlessly upgrades to live data.

