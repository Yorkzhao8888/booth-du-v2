#!/usr/bin/env node
/**
 * [XFACTORY-P1] dev 增量迁移（幂等，可重跑）
 * - booth_supply_purchases（组合 1 X-Supply 采购桩）
 * - booth_delivery_receipts（交付回执：DDU / XU）
 * - booth_production_orders 补 source / order_family 列
 * 回滚：dev-xfactory-rollback.cjs
 */
const path = require('path');
const fs = require('fs');
const { Client } = require(path.join('/workspace/projects', 'node_modules', 'pg'));

function loadEnv() {
  const envPath = '/workspace/projects/.env';
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }
}

const DDL = `
CREATE TABLE IF NOT EXISTS booth_supply_purchases (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  event_id TEXT UNIQUE,
  supply_purchase_no TEXT NOT NULL,
  wave_no TEXT,
  supplier_name TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'registered',
  source TEXT NOT NULL DEFAULT 'SUPPLY',
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  production_order_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_supply_purchases_org_no ON booth_supply_purchases(org_id, supply_purchase_no);
CREATE INDEX IF NOT EXISTS idx_supply_purchases_status ON booth_supply_purchases(org_id, status);

CREATE TABLE IF NOT EXISTS booth_delivery_receipts (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL,
  receipt_no TEXT NOT NULL,
  production_order_id BIGINT,
  production_no TEXT NOT NULL,
  wave_no TEXT,
  source TEXT NOT NULL DEFAULT 'MARKET',
  qty NUMERIC NOT NULL DEFAULT 0,
  evidence_nos JSONB NOT NULL DEFAULT '[]'::jsonb,
  delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_by TEXT NOT NULL DEFAULT 'EDX',
  receiver_type TEXT NOT NULL DEFAULT 'XU',
  receiver_id TEXT,
  receiver_name TEXT,
  status TEXT NOT NULL DEFAULT 'delivered',
  confirmed_at TIMESTAMPTZ,
  confirm_event_id TEXT UNIQUE,
  confirmed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_receipts_org_no ON booth_delivery_receipts(org_id, receipt_no);
CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_receipts_po ON booth_delivery_receipts(production_order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_receipts_status ON booth_delivery_receipts(org_id, status);

ALTER TABLE booth_production_orders ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'INTERNAL';
ALTER TABLE booth_production_orders ADD COLUMN IF NOT EXISTS order_family TEXT;
CREATE INDEX IF NOT EXISTS idx_production_orders_source ON booth_production_orders(org_id, source);
`;

(async () => {
  loadEnv();
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('FATAL: DATABASE_URL missing'); process.exit(1); }
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(DDL);
    await client.query('COMMIT');
    console.log('[xfactory-p1-migrate] OK: supply_purchases + delivery_receipts + po.source/order_family ready');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[xfactory-p1-migrate] FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
