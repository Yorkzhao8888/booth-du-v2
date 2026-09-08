#!/usr/bin/env node
/* eslint-disable */
/**
 * [BOOTH-PRD-002] 铺面管理+权限 — 老库增量迁移（可逆、幂等）
 * 正向: node scripts/dev-prd002-migrate.cjs
 * 回滚: node scripts/dev-prd002-rollback.cjs
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('/workspace/projects/node_modules/pg');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  }
}

const UP = `
-- ====== [BOOTH-PRD-002] PM-001 供应铺 / PM-002 订单类型 / 生产单类型列 ======
CREATE TABLE IF NOT EXISTS booth_supply_shops (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  shop_type TEXT NOT NULL,
  shop_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  capabilities JSONB DEFAULT '[]'::jsonb,
  contact TEXT,
  remark TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, shop_type, shop_name)
);
CREATE INDEX IF NOT EXISTS idx_supply_shops_org ON booth_supply_shops(org_id, status);

CREATE TABLE IF NOT EXISTS booth_order_types (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  type_code TEXT NOT NULL,
  type_name TEXT NOT NULL,
  default_target_shop_type TEXT,
  sort_order INTEGER DEFAULT 0,
  enabled BOOLEAN DEFAULT true,
  remark TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, type_code)
);

ALTER TABLE booth_production_orders ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'self_made';
CREATE INDEX IF NOT EXISTS idx_production_orders_order_type ON booth_production_orders(org_id, order_type);

-- 种子: PM-002 MVP 三类 (幂等)
INSERT INTO booth_order_types (org_id, type_code, type_name, default_target_shop_type, sort_order, remark)
SELECT 1, v.type_code, v.type_name, v.target, v.sort, v.remark FROM (VALUES
  ('outsource', '外发', 'supply', 1, '外发订单由供给铺承接'),
  ('self_made', '自制', 'manufacture', 2, '自制订单由制造铺承接'),
  ('rd_dev', '研发', 'rd', 3, '研发订单由研发铺承接')
) AS v(type_code, type_name, target, sort, remark)
WHERE NOT EXISTS (SELECT 1 FROM booth_order_types WHERE org_id = 1 AND type_code = v.type_code);

-- 种子: PM-001 四铺 (幂等)
INSERT INTO booth_supply_shops (org_id, shop_type, shop_name, capabilities)
SELECT 1, v.shop_type, v.shop_name, v.caps::jsonb FROM (VALUES
  ('rd', '研发铺', '["菜品研发","配方管理"]'),
  ('manufacture', '制造铺', '["FAB制作","BOM管理"]'),
  ('delivery', '配送铺', '["配送调度","点位交付"]'),
  ('supply', '供给铺', '["通货供给","外发承接"]')
) AS v(shop_type, shop_name, caps)
WHERE NOT EXISTS (SELECT 1 FROM booth_supply_shops WHERE org_id = 1 AND shop_type = v.shop_type);
`;

async function main() {
  loadEnv();
  const cs = process.env.DATABASE_URL;
  if (!cs) { console.error('DATABASE_URL missing'); process.exit(1); }
  const c = new Client({ connectionString: cs });
  await c.connect();
  try {
    await c.query(UP);
    const ot = await c.query('SELECT count(*)::int n FROM booth_order_types WHERE org_id = 1');
    const ss = await c.query('SELECT count(*)::int n FROM booth_supply_shops WHERE org_id = 1');
    console.log(`[dev-prd002-migrate] OK — order_types=${ot.rows[0].n} supply_shops=${ss.rows[0].n}`);
  } catch (e) {
    console.error('[dev-prd002-migrate] FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
}

main();
