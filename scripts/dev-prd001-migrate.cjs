#!/usr/bin/env node
/**
 * [BOOTH-PRD-001] 契约地基增量迁移（可逆、幂等）
 * - 生产单聚合实体 booth_production_orders + 四铺任务 booth_production_tasks
 * - migrate 主流程 DDL 已同步本块; 本脚本用于老库部署前置/独立增量执行
 * 回滚: node scripts/dev-prd001-rollback.cjs
 */
const fs = require('fs');
const path = require('path');

let DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m);
    if (m) DATABASE_URL = m[1].trim();
  }
}
if (!DATABASE_URL) {
  console.error('FATAL: DATABASE_URL not configured');
  process.exit(1);
}

const DDL = `
-- ====== [BOOTH-PRD-001] 契约地基（阶段零） ======
CREATE TABLE IF NOT EXISTS booth_production_orders (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  production_no TEXT NOT NULL,
  shop_order_id TEXT NOT NULL,
  dx_case_no TEXT,
  wave_no TEXT,
  order_no TEXT,
  status TEXT NOT NULL DEFAULT 'pending_dispatch',
  exception_reason TEXT,
  expected_delivery_at TIMESTAMPTZ,
  plaz_point TEXT,
  items JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(org_id, shop_order_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_production_orders_no ON booth_production_orders(production_no);
CREATE INDEX IF NOT EXISTS idx_production_orders_status ON booth_production_orders(org_id, status);

CREATE TABLE IF NOT EXISTS booth_production_tasks (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  production_order_id INTEGER NOT NULL REFERENCES booth_production_orders(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL DEFAULT 'manufacture',
  status TEXT NOT NULL DEFAULT 'pending_split',
  exception_reason TEXT,
  work_order_id BIGINT REFERENCES booth_work_orders(id),
  work_order_no TEXT,
  expected_delivery_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_production_tasks_order ON booth_production_tasks(production_order_id);
CREATE INDEX IF NOT EXISTS idx_production_tasks_status ON booth_production_tasks(org_id, status);
`;

async function main() {
  const { Client } = require('pg');
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(DDL);
    const chk = await client.query(
      `SELECT (SELECT count(*) FROM information_schema.tables WHERE table_name IN ('booth_production_orders','booth_production_tasks')) AS tables,
              (SELECT count(*) FROM information_schema.columns WHERE table_name='booth_production_orders' AND column_name='production_no') AS prod_no_col`
    );
    if (chk.rows[0].tables < 2 || chk.rows[0].prod_no_col < 1) {
      throw new Error('verification failed: tables=' + chk.rows[0].tables + ' prod_no_col=' + chk.rows[0].prod_no_col);
    }
    console.log('[BOOTH-PRD-001] migrate OK: booth_production_orders + booth_production_tasks ready');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('[BOOTH-PRD-001] migrate failed:', e.message);
  process.exit(1);
});
