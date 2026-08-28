-- Booth DU v4.0 Schema
-- 13 tables + indexes

CREATE TABLE IF NOT EXISTS booth_orgs (
  id SERIAL PRIMARY KEY,
  shop_id INTEGER NOT NULL,
  name VARCHAR(100) NOT NULL,
  mode VARCHAR(10) NOT NULL DEFAULT 'du',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booth_users (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  name VARCHAR(50) NOT NULL,
  phone VARCHAR(20) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(10) NOT NULL,
  hats TEXT[] DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booth_skus (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  sku_code VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  unit VARCHAR(20) NOT NULL,
  safety_stock INTEGER NOT NULL DEFAULT 0,
  cost_price INTEGER DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, sku_code)
);

CREATE TABLE IF NOT EXISTS booth_fulfillments (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  shop_order_id VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  items JSONB NOT NULL DEFAULT '[]',
  required_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, shop_order_id)
);

CREATE TABLE IF NOT EXISTS booth_work_orders (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  fulfillment_id INTEGER REFERENCES booth_fulfillments(id),
  product_name VARCHAR(100) NOT NULL,
  qty INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  boms JSONB DEFAULT '[]',
  progress INTEGER NOT NULL DEFAULT 0,
  accepted_by INTEGER REFERENCES booth_users(id),
  operator_id INTEGER REFERENCES booth_users(id),
  accepted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booth_boms (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  product_name VARCHAR(100) NOT NULL,
  product_code VARCHAR(50),
  sale_price INTEGER DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booth_bom_items (
  id SERIAL PRIMARY KEY,
  bom_id INTEGER NOT NULL REFERENCES booth_boms(id) ON DELETE CASCADE,
  sku_id INTEGER NOT NULL REFERENCES booth_skus(id),
  qty INTEGER NOT NULL,
  unit VARCHAR(20) NOT NULL
);

CREATE TABLE IF NOT EXISTS booth_inventory (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  sku_id INTEGER NOT NULL REFERENCES booth_skus(id),
  qty_on_hand INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, sku_id)
);

CREATE TABLE IF NOT EXISTS booth_inventory_txn (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  sku_id INTEGER NOT NULL REFERENCES booth_skus(id),
  qty_change INTEGER NOT NULL,
  type VARCHAR(20) NOT NULL,
  ref_type VARCHAR(30),
  ref_id INTEGER,
  operator_id INTEGER REFERENCES booth_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booth_inbound_orders (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  items JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(20) NOT NULL DEFAULT 'posted',
  operator_id INTEGER REFERENCES booth_users(id),
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booth_outbound_orders (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  items JSONB NOT NULL DEFAULT '[]',
  status VARCHAR(20) NOT NULL DEFAULT 'posted',
  operator_id INTEGER REFERENCES booth_users(id),
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booth_event_log (
  id SERIAL PRIMARY KEY,
  event_id VARCHAR(100) NOT NULL UNIQUE,
  event_type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS booth_outbox (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_wo_org_status ON booth_work_orders(org_id, status);
CREATE INDEX IF NOT EXISTS idx_wo_fulfillment ON booth_work_orders(fulfillment_id);
CREATE INDEX IF NOT EXISTS idx_fulfill_org_status ON booth_fulfillments(org_id, status);
CREATE INDEX IF NOT EXISTS idx_inv_txn_org_sku ON booth_inventory_txn(org_id, sku_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bom_items_bom ON booth_bom_items(bom_id);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON booth_outbox(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_skus_org_active ON booth_skus(org_id, is_active);
