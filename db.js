const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: { persistSession: false },
  }
);

module.exports = supabase;

// ── DATABASE SCHEMA ────────────────────────────────────────────
// Run this SQL in Supabase SQL Editor to create all required tables.
//
// -- ORDERS TABLE
// create table orders (
//   id               text primary key,          -- e.g. LC-0025
//   customer_name    text not null,
//   customer_email   text not null,
//   customer_phone   text,
//   address_line1    text,
//   address_line2    text,
//   city             text,
//   postcode         text,
//   country          text default 'United Kingdom',
//   items            jsonb not null,             -- array of cart items
//   subtotal         numeric(10,2) not null,
//   discount         numeric(10,2) default 0,
//   promo_code       text,
//   delivery_method  text not null,
//   delivery_cost    numeric(10,2) not null,
//   total            numeric(10,2) not null,
//   payment_method   text not null,             -- 'bank' or 'card'
//   payment_status   text default 'pending',    -- pending | paid | failed | refunded
//   gc_billing_req_id text,                     -- GoCardless billing request ID
//   gc_payment_id    text,                      -- GoCardless payment ID (set by webhook)
//   stripe_pi_id     text,                      -- Stripe payment intent ID
//   order_status     text default 'new',        -- new | printing | ready | complete
//   print_file       text,                      -- filename of G-code file
//   print_status     text default 'pending',    -- pending | ready | uploading | printing | done | error
//   notes            text,
//   created_at       timestamptz default now(),
//   updated_at       timestamptz default now()
// );
//
// -- CUSTOM REQUESTS TABLE
// create table custom_requests (
//   id               text primary key,          -- e.g. CR-0013
//   customer_name    text not null,
//   customer_email   text not null,
//   description      text not null,
//   material         text,
//   size             text,
//   estimate         numeric(10,2),
//   image_urls       jsonb default '[]',        -- array of Supabase Storage URLs
//   status           text default 'new',        -- new | quoting | printing | complete
//   internal_note    text,
//   created_at       timestamptz default now(),
//   updated_at       timestamptz default now()
// );
//
// -- CATALOGUE TABLE
// create table catalogue (
//   id               serial primary key,
//   name             text not null,
//   category         text not null,
//   description      text,
//   base_price       numeric(10,2) not null,
//   materials        jsonb default '[]',        -- array of material strings
//   colours          jsonb default '[]',        -- array of hex strings
//   shape            text,                      -- for 3D preview
//   tag              text,                      -- 'popular' | 'new' | null
//   print_file_path  text,                      -- Supabase Storage path to G-code
//   active           boolean default true,
//   created_at       timestamptz default now()
// );
//
// -- PROMO CODES TABLE
// create table promo_codes (
//   code             text primary key,
//   discount_pct     numeric(5,2) not null,     -- e.g. 10.00 = 10%
//   max_uses         integer,
//   uses_count       integer default 0,
//   expires_at       timestamptz,
//   active           boolean default true,
//   created_at       timestamptz default now()
// );
//
// -- Seed initial promo code
// insert into promo_codes (code, discount_pct, max_uses, active)
// values ('LAYER10', 10.00, 100, true);
//
// -- Enable Row Level Security on all tables
// alter table orders          enable row level security;
// alter table custom_requests enable row level security;
// alter table catalogue       enable row level security;
// alter table promo_codes     enable row level security;
//
// -- Public can read catalogue
// create policy "catalogue_public_read" on catalogue
//   for select using (active = true);
//
// -- All other tables: service role only (backend uses service key)
// -- No public policies needed for orders, custom_requests, promo_codes
