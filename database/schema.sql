-- ========================================================================
-- PRODUCT PRICE TRACKER - SUPABASE POSTGRESQL SCHEMA
-- Author: Rajat Dagar
-- Target storefront: https://demo.inelabteamdev.com/
-- ========================================================================

-- Enable UUID extension if needed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------
-- 1. Table: tracked_products
-- Stores products selected by the user to be monitored.
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tracked_products (
  product_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT,
  brand TEXT,
  category TEXT,
  sku TEXT,
  canonical_url TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracked_products_active ON tracked_products(is_active);
CREATE INDEX IF NOT EXISTS idx_tracked_products_name ON tracked_products(name);

-- ------------------------------------------------------------------------
-- 2. Table: price_stock_history
-- Records successful, verified observations of price and stock over time.
-- Only written when a scrape succeeds and passes data validation.
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_stock_history (
  id BIGSERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES tracked_products(product_id) ON DELETE CASCADE,
  price NUMERIC(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  stock INTEGER, -- NULL if stock value unavailable/unspecified, 0 if out of stock, positive integer if in stock
  is_in_stock BOOLEAN,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_product_observation UNIQUE (product_id, observed_at)
);

CREATE INDEX IF NOT EXISTS idx_history_product_time ON price_stock_history(product_id, observed_at DESC);

-- ------------------------------------------------------------------------
-- 3. Table: scrape_attempts
-- Immutable audit log of every scrape attempt and retry.
-- Differentiates 'success', 'retried', and 'failed' attempts.
-- ------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS scrape_attempts (
  id BIGSERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES tracked_products(product_id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL CHECK (status IN ('success', 'retried', 'failed')),
  http_status INTEGER,
  duration_ms INTEGER NOT NULL,
  extracted_price NUMERIC(12, 2),
  extracted_stock INTEGER,
  error_message TEXT,
  diagnostics JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scrape_attempts_product ON scrape_attempts(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scrape_attempts_status ON scrape_attempts(status);

-- ------------------------------------------------------------------------
-- 4. View: v_tracked_products_summary
-- High-performance denormalized view for dashboard listings.
-- Joins latest successful observation and latest scrape attempt.
-- ------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_tracked_products_summary AS
SELECT 
  p.product_id,
  p.name,
  p.brand,
  p.category,
  p.sku,
  p.canonical_url,
  p.is_active,
  p.created_at,
  p.updated_at,
  -- Latest valid price & stock observation
  h.price AS latest_price,
  h.currency AS latest_currency,
  h.stock AS latest_stock,
  h.is_in_stock AS latest_is_in_stock,
  h.observed_at AS latest_observed_at,
  -- Latest scrape attempt status & timing
  a.status AS latest_attempt_status,
  a.duration_ms AS latest_attempt_duration_ms,
  a.error_message AS latest_attempt_error,
  a.created_at AS latest_attempt_at
FROM tracked_products p
LEFT JOIN LATERAL (
  SELECT price, currency, stock, is_in_stock, observed_at
  FROM price_stock_history
  WHERE product_id = p.product_id
  ORDER BY observed_at DESC
  LIMIT 1
) h ON true
LEFT JOIN LATERAL (
  SELECT status, duration_ms, error_message, created_at
  FROM scrape_attempts
  WHERE product_id = p.product_id
  ORDER BY created_at DESC
  LIMIT 1
) a ON true;
