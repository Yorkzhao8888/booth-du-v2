import bcrypt from 'bcryptjs';
import { pool, query } from './db.js';

const DDL = `
CREATE TABLE IF NOT EXISTS booth_orgs (
  id SERIAL PRIMARY KEY, shop_id INTEGER NOT NULL, name VARCHAR(100) NOT NULL,
  mode VARCHAR(10) NOT NULL DEFAULT 'du', is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS booth_users (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  name VARCHAR(50) NOT NULL, phone VARCHAR(20) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL, role VARCHAR(10) NOT NULL,
  hats TEXT[] DEFAULT '{}', is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS booth_skus (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  sku_code VARCHAR(50) NOT NULL, name VARCHAR(100) NOT NULL, unit VARCHAR(20) NOT NULL,
  safety_stock INTEGER NOT NULL DEFAULT 0, cost_price INTEGER DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, sku_code)
);
CREATE TABLE IF NOT EXISTS booth_fulfillments (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  shop_order_id VARCHAR(50) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'pending',
  items JSONB NOT NULL DEFAULT '[]', required_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(org_id, shop_order_id)
);
CREATE TABLE IF NOT EXISTS booth_work_orders (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  fulfillment_id INTEGER REFERENCES booth_fulfillments(id),
  product_name VARCHAR(100) NOT NULL, qty INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', boms JSONB DEFAULT '[]',
  progress INTEGER NOT NULL DEFAULT 0, accepted_by INTEGER REFERENCES booth_users(id),
  operator_id INTEGER REFERENCES booth_users(id), accepted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS booth_boms (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  product_name VARCHAR(100) NOT NULL, product_code VARCHAR(50),
  sale_price INTEGER DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS booth_bom_items (
  id SERIAL PRIMARY KEY, bom_id INTEGER NOT NULL REFERENCES booth_boms(id) ON DELETE CASCADE,
  sku_id INTEGER NOT NULL REFERENCES booth_skus(id), qty INTEGER NOT NULL, unit VARCHAR(20) NOT NULL
);
CREATE TABLE IF NOT EXISTS booth_inventory (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  sku_id INTEGER NOT NULL REFERENCES booth_skus(id), qty_on_hand INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(org_id, sku_id)
);
CREATE TABLE IF NOT EXISTS booth_inventory_txn (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  sku_id INTEGER NOT NULL REFERENCES booth_skus(id), qty_change INTEGER NOT NULL,
  type VARCHAR(20) NOT NULL, ref_type VARCHAR(30), ref_id INTEGER,
  operator_id INTEGER REFERENCES booth_users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS booth_inbound_orders (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  items JSONB NOT NULL DEFAULT '[]', status VARCHAR(20) NOT NULL DEFAULT 'posted',
  operator_id INTEGER REFERENCES booth_users(id), posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS booth_outbound_orders (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  items JSONB NOT NULL DEFAULT '[]', status VARCHAR(20) NOT NULL DEFAULT 'posted',
  operator_id INTEGER REFERENCES booth_users(id), posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS booth_event_log (
  id SERIAL PRIMARY KEY, event_id VARCHAR(100) NOT NULL UNIQUE,
  event_type VARCHAR(50) NOT NULL, payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS booth_outbox (
  id SERIAL PRIMARY KEY, event_type VARCHAR(50) NOT NULL, payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending', retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), sent_at TIMESTAMPTZ
);

-- ====== V2 MODULE TABLES ======

-- DU: SKU moving-weighted-average cost
CREATE TABLE IF NOT EXISTS booth_sku_cost (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  sku_id INTEGER NOT NULL REFERENCES booth_skus(id),
  unit_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, sku_id)
);

-- DU: Purchase orders
CREATE TABLE IF NOT EXISTS booth_purchase_orders (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  po_no TEXT NOT NULL UNIQUE, supplier TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  total_amount NUMERIC(12,2) DEFAULT 0,
  created_by INTEGER REFERENCES booth_users(id),
  approved_by INTEGER REFERENCES booth_users(id),
  submitted_at TIMESTAMPTZ, approved_at TIMESTAMPTZ, received_at TIMESTAMPTZ,
  remark TEXT, items JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- DU: Profit snapshots
CREATE TABLE IF NOT EXISTS booth_profit_snapshots (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  fulfillment_id INTEGER REFERENCES booth_fulfillments(id),
  work_order_id INTEGER, revenue NUMERIC(12,2) DEFAULT 0,
  material_cost NUMERIC(12,2) DEFAULT 0, gross_profit NUMERIC(12,2) DEFAULT 0,
  margin NUMERIC(6,2) DEFAULT 0,
  cost_detail JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(org_id, fulfillment_id)
);

-- CORE: Stock batches
CREATE TABLE IF NOT EXISTS booth_stock_batches (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  sku_id INTEGER NOT NULL REFERENCES booth_skus(id),
  batch_no TEXT, qty NUMERIC(12,3) NOT NULL DEFAULT 0,
  expiry_date DATE, received_at TIMESTAMPTZ DEFAULT NOW(),
  source_type TEXT, source_id BIGINT, location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CORE: Stocktake orders
CREATE TABLE IF NOT EXISTS booth_stocktake_orders (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  st_no TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER REFERENCES booth_users(id),
  approved_by INTEGER REFERENCES booth_users(id),
  submitted_at TIMESTAMPTZ, approved_at TIMESTAMPTZ,
  remark TEXT, lines JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CORE: FAB operations (工序)
CREATE TABLE IF NOT EXISTS booth_fab_operations (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  work_order_id BIGINT NOT NULL, seq INT NOT NULL, name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  operator_id INTEGER REFERENCES booth_users(id),
  planned_qty NUMERIC(12,3) DEFAULT 0,
  reported_qty NUMERIC(12,3) DEFAULT 0,
  started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CORE: Quality checks
CREATE TABLE IF NOT EXISTS booth_quality_checks (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  work_order_id BIGINT NOT NULL,
  result TEXT NOT NULL DEFAULT 'pass',
  qty_pass NUMERIC(12,3) DEFAULT 0, qty_reject NUMERIC(12,3) DEFAULT 0,
  reject_reason TEXT, inspector_id INTEGER REFERENCES booth_users(id),
  checked_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CORE: Delivery tasks
CREATE TABLE IF NOT EXISTS booth_dl_tasks (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  task_no TEXT NOT NULL UNIQUE, fulfillment_id BIGINT,
  status TEXT NOT NULL DEFAULT 'pending',
  assignee_id INTEGER REFERENCES booth_users(id),
  pickup_addr TEXT, delivery_addr TEXT,
  customer_name TEXT, customer_phone TEXT,
  assigned_at TIMESTAMPTZ, accepted_at TIMESTAMPTZ,
  picked_at TIMESTAMPTZ, delivering_at TIMESTAMPTZ, signed_at TIMESTAMPTZ,
  signer TEXT, exception_reason TEXT, remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CORE: Service tasks
CREATE TABLE IF NOT EXISTS booth_svc_tasks (
  id SERIAL PRIMARY KEY, org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  task_no TEXT NOT NULL UNIQUE, fulfillment_id BIGINT,
  status TEXT NOT NULL DEFAULT 'pending',
  assignee_id INTEGER REFERENCES booth_users(id),
  service_content TEXT, customer_name TEXT, customer_phone TEXT,
  required_at TIMESTAMPTZ,
  assigned_at TIMESTAMPTZ, accepted_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  exception_reason TEXT, remark TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_wo_org_status ON booth_work_orders(org_id, status);
CREATE INDEX IF NOT EXISTS idx_wo_fulfillment ON booth_work_orders(fulfillment_id);
CREATE INDEX IF NOT EXISTS idx_fulfill_org_status ON booth_fulfillments(org_id, status);
CREATE INDEX IF NOT EXISTS idx_inv_txn_org_sku ON booth_inventory_txn(org_id, sku_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bom_items_bom ON booth_bom_items(bom_id);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON booth_outbox(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_batches_org_sku_exp ON booth_stock_batches(org_id, sku_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_fab_ops_wo ON booth_fab_operations(work_order_id);
CREATE INDEX IF NOT EXISTS idx_qc_wo ON booth_quality_checks(work_order_id);
CREATE INDEX IF NOT EXISTS idx_dl_org_status ON booth_dl_tasks(org_id, status);
CREATE INDEX IF NOT EXISTS idx_svc_org_status ON booth_svc_tasks(org_id, status);
CREATE INDEX IF NOT EXISTS idx_po_org_status ON booth_purchase_orders(org_id, status);
CREATE INDEX IF NOT EXISTS idx_st_org_status ON booth_stocktake_orders(org_id, status);
`;

const ALTERS = `
ALTER TABLE booth_skus ADD COLUMN IF NOT EXISTS safety_stock_num NUMERIC(12,3) DEFAULT 0;
ALTER TABLE booth_work_orders ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal';
ALTER TABLE booth_work_orders ADD COLUMN IF NOT EXISTS paused BOOLEAN DEFAULT false;
ALTER TABLE booth_dl_tasks ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE booth_dl_tasks ADD COLUMN IF NOT EXISTS picked_at TIMESTAMPTZ;
ALTER TABLE booth_dl_tasks ADD COLUMN IF NOT EXISTS signer TEXT;
ALTER TABLE booth_svc_tasks ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
`;

// In-memory store for org modes
export const orgModes = new Map<number, string>();

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Execute DDL
    await client.query(DDL);
    await client.query(INDEXES);
    await client.query(ALTERS);

    // Check if seed data already exists
    const orgCheck = await client.query('SELECT COUNT(*) as cnt FROM booth_orgs');
    if (parseInt(orgCheck.rows[0].cnt) > 0) {
      // Load org modes into memory even if seed is skipped
      const orgs = await client.query('SELECT id, mode FROM booth_orgs');
      for (const row of orgs.rows) {
        orgModes.set(row.id, row.mode);
      }

      // Cleanup: mark stale outbox events (retry_count >= MAX_RETRIES) as dead
      const staleResult = await client.query(
        `UPDATE booth_outbox SET status = 'dead' WHERE status = 'pending' AND retry_count >= 10`
      );
      if (staleResult.rowCount && staleResult.rowCount > 0) {
        console.log(`[migrate] Marked ${staleResult.rowCount} stale outbox events as dead.`);
      }

      // Role migration: eu→du, ex→dex, exx→dexx (idempotent)
      const roleUpdates = [
        { from: 'eu', to: 'du' },
        { from: 'ex', to: 'dex' },
        { from: 'exx', to: 'dexx' },
      ];
      for (const { from, to } of roleUpdates) {
        const r = await client.query(`UPDATE booth_users SET role = $1 WHERE role = $2`, [to, from]);
        if (r.rowCount && r.rowCount > 0) {
          console.log(`[migrate] Renamed role '${from}' → '${to}' (${r.rowCount} users).`);
        }
      }

      // Add dx (店长) user if not exists
      const dxCheck = await client.query(`SELECT id FROM booth_users WHERE phone = '13800000004'`);
      if (dxCheck.rows.length === 0) {
        const hash = bcrypt.hashSync('123456', 10);
        await client.query(
          `INSERT INTO booth_users (org_id, name, phone, password_hash, role, hats)
           VALUES (1, '店长', '13800000004', $1, 'dx', '{}')`,
          [hash]
        );
        console.log('[migrate] Added dx user: 店长 / 13800000004.');
      }

      // Update dexx hats to include all modules
      await client.query(
        `UPDATE booth_users SET hats = '{FAB,WH,DL,SVC}' WHERE role = 'dexx' AND org_id = 1`
      );

      // Add DM (运营) user if not exists
      const dmCheck = await client.query(`SELECT id FROM booth_users WHERE phone = '13800000000'`);
      if (dmCheck.rowCount === 0) {
        const dmHash = bcrypt.hashSync('123456', 10);
        await client.query(
          `INSERT INTO booth_users (org_id, name, phone, password_hash, role, hats)
           VALUES (1, '运营', '13800000000', $1, 'dm', '{}')`,
          [dmHash]
        );
        console.log('[migrate] Added dm user: 运营 / 13800000000.');
      }

      // Add DXX (店员) user if not exists
      const dxxCheck = await client.query(`SELECT id FROM booth_users WHERE phone = '13800000005'`);
      if (dxxCheck.rowCount === 0) {
        const dxxHash = bcrypt.hashSync('123456', 10);
        await client.query(
          `INSERT INTO booth_users (org_id, name, phone, password_hash, role, hats)
           VALUES (1, '店员', '13800000005', $1, 'dxx', '{}')`,
          [dxxHash]
        );
        console.log('[migrate] Added dxx user: 店员 / 13800000005.');
      }

      // Seed sku_cost for all existing SKUs if not exists
      const skuCostCheck = await client.query('SELECT COUNT(*) as cnt FROM booth_sku_cost WHERE org_id = 1');
      if (parseInt(skuCostCheck.rows[0].cnt) === 0) {
        const skus = await client.query('SELECT id FROM booth_skus WHERE org_id = 1');
        for (const sku of skus.rows) {
          await client.query(
            `INSERT INTO booth_sku_cost (org_id, sku_id, unit_cost, total_qty) VALUES (1, $1, 0, 0)`,
            [sku.id]
          );
        }
        console.log(`[migrate] Seeded sku_cost for ${skus.rows.length} SKUs.`);
      }

      await client.query('COMMIT');
      console.log('[migrate] Tables verified, seed data already exists.');
      return;
    }

    const passwordHash = bcrypt.hashSync('123456', 10);

    // Seed org
    await client.query(
      `INSERT INTO booth_orgs (id, shop_id, name, mode) VALUES (1, 1, '知味直营铺', 'du')`
    );

    // Seed users
    await client.query(
      `INSERT INTO booth_users (id, org_id, name, phone, password_hash, role, hats)
       VALUES (1, 1, '店主', '13800000001', $1, 'du', '{}')`,
      [passwordHash]
    );
    await client.query(
      `INSERT INTO booth_users (id, org_id, name, phone, password_hash, role, hats)
       VALUES (2, 1, '店长', '13800000004', $1, 'dx', '{}')`,
      [passwordHash]
    );
    await client.query(
      `INSERT INTO booth_users (id, org_id, name, phone, password_hash, role, hats)
       VALUES (3, 1, '交付长', '13800000002', $1, 'dex', '{}')`,
      [passwordHash]
    );
    await client.query(
      `INSERT INTO booth_users (id, org_id, name, phone, password_hash, role, hats)
       VALUES (4, 1, '铺员', '13800000003', $1, 'dexx', '{FAB,WH,DL,SVC}')`,
      [passwordHash]
    );

    // Fix sequence for users
    await client.query(`SELECT setval('booth_users_id_seq', 4, true)`);

    // Seed SKUs
    const skus = [
      { code: 'FLOUR', name: '面粉', unit: 'g', safety: 500, cost: 50 },
      { code: 'BEEF', name: '牛肉', unit: 'g', safety: 1000, cost: 800 },
      { code: 'LETTUCE', name: '生菜', unit: 'g', safety: 500, cost: 30 },
      { code: 'TOMATO', name: '番茄', unit: 'g', safety: 500, cost: 40 },
      { code: 'BOX', name: '包装盒', unit: '个', safety: 50, cost: 30 },
    ];

    for (const sku of skus) {
      await client.query(
        `INSERT INTO booth_skus (id, org_id, sku_code, name, unit, safety_stock, cost_price)
         VALUES (DEFAULT, 1, $1, $2, $3, $4, $5)`,
        [sku.code, sku.name, sku.unit, sku.safety, sku.cost]
      );
    }

    // Fix sequence for skus
    await client.query(`SELECT setval('booth_skus_id_seq', 5, true)`);

    // Seed BOMs
    await client.query(
      `INSERT INTO booth_boms (id, org_id, product_name, product_code, sale_price)
       VALUES (1, 1, '牛肉汉堡', 'BEEF-BURGER', 3800)`
    );
    await client.query(
      `INSERT INTO booth_boms (id, org_id, product_name, product_code, sale_price)
       VALUES (2, 1, '牛肉沙拉', 'BEEF-SALAD', 3200)`
    );
    await client.query(`SELECT setval('booth_boms_id_seq', 2, true)`);

    // Seed BOM items for 汉堡 (bom_id=1): 面粉150g, 牛肉100g, 生菜30g, 番茄50g, 包装盒1个
    const burgerItems = [
      { skuId: 1, qty: 150, unit: 'g' },   // 面粉
      { skuId: 2, qty: 100, unit: 'g' },   // 牛肉
      { skuId: 3, qty: 30, unit: 'g' },    // 生菜
      { skuId: 4, qty: 50, unit: 'g' },    // 番茄
      { skuId: 5, qty: 1, unit: '个' },    // 包装盒
    ];
    for (const item of burgerItems) {
      await client.query(
        `INSERT INTO booth_bom_items (bom_id, sku_id, qty, unit) VALUES (1, $1, $2, $3)`,
        [item.skuId, item.qty, item.unit]
      );
    }

    // Seed BOM items for 沙拉 (bom_id=2): 牛肉150g, 生菜80g, 番茄60g, 包装盒1个
    const saladItems = [
      { skuId: 2, qty: 150, unit: 'g' },   // 牛肉
      { skuId: 3, qty: 80, unit: 'g' },    // 生菜
      { skuId: 4, qty: 60, unit: 'g' },    // 番茄
      { skuId: 5, qty: 1, unit: '个' },    // 包装盒
    ];
    for (const item of saladItems) {
      await client.query(
        `INSERT INTO booth_bom_items (bom_id, sku_id, qty, unit) VALUES (2, $1, $2, $3)`,
        [item.skuId, item.qty, item.unit]
      );
    }

    // Seed inventory: each SKU 10000
    for (let skuId = 1; skuId <= 5; skuId++) {
      await client.query(
        `INSERT INTO booth_inventory (org_id, sku_id, qty_on_hand) VALUES (1, $1, 10000)`,
        [skuId]
      );
    }

    orgModes.set(1, 'du');

    await client.query('COMMIT');
    console.log('[migrate] All tables created and seed data inserted.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[migrate] Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}
