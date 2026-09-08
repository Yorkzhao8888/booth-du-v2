/**
 * [BOOTH-PRD-003] 四铺拆单闭环 dev 增量迁移（老库一次性补齐, 幂等可重复执行）
 * - booth_work_orders 反挂列: production_task_id / split_source / step_name / dimension
 * - booth_crafts 工艺表 (RD-001/004/005)
 * - booth_work_order_evidences 凭证表 (G-005)
 * - booth_stock_docs 供给单据骨架 (SP-002, P2 仅登记)
 * 回滚: node scripts/dev-prd003-rollback.cjs
 */
const path = require('path');
const fs = require('fs');
let Client;
try {
  ({ Client } = require('/workspace/projects/node_modules/pg'));
} catch (e) {
  ({ Client } = require('pg'));
}

function loadEnv() {
  const envPath = path.resolve(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const DDL = `
ALTER TABLE booth_work_orders ADD COLUMN IF NOT EXISTS production_task_id BIGINT REFERENCES booth_production_tasks(id);
ALTER TABLE booth_work_orders ADD COLUMN IF NOT EXISTS split_source TEXT;
ALTER TABLE booth_work_orders ADD COLUMN IF NOT EXISTS step_name TEXT;
ALTER TABLE booth_work_orders ADD COLUMN IF NOT EXISTS dimension TEXT;
CREATE INDEX IF NOT EXISTS idx_work_orders_production_task ON booth_work_orders (production_task_id) WHERE production_task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS booth_crafts (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  craft_code TEXT NOT NULL,
  craft_name TEXT NOT NULL,
  product_name TEXT NOT NULL,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (org_id, craft_code)
);
CREATE INDEX IF NOT EXISTS idx_crafts_org_product ON booth_crafts (org_id, product_name);

CREATE TABLE IF NOT EXISTS booth_work_order_evidences (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  work_order_id BIGINT NOT NULL REFERENCES booth_work_orders(id) ON DELETE CASCADE,
  evidence_type TEXT NOT NULL DEFAULT 'photo',
  url TEXT NOT NULL,
  note TEXT,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_evidences_wo ON booth_work_order_evidences (work_order_id);

CREATE TABLE IF NOT EXISTS booth_stock_docs (
  id SERIAL PRIMARY KEY,
  org_id INTEGER NOT NULL REFERENCES booth_orgs(id),
  work_order_id BIGINT REFERENCES booth_work_orders(id) ON DELETE SET NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('inbound','outbound','transfer','stocktake')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_docs_org ON booth_stock_docs (org_id, doc_type);
`;

async function main() {
  loadEnv();
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(DDL);
    await client.query('COMMIT');
    const verify = await client.query(`
      SELECT
        (SELECT count(*) FROM information_schema.columns WHERE table_name='booth_work_orders' AND column_name IN ('production_task_id','split_source','step_name','dimension')) AS wo_cols,
        (SELECT count(*) FROM information_schema.tables WHERE table_name IN ('booth_crafts','booth_work_order_evidences','booth_stock_docs')) AS tables
    `);
    const v = verify.rows[0];
    if (Number(v.wo_cols) !== 4 || Number(v.tables) !== 3) {
      throw new Error(`verify failed: wo_cols=${v.wo_cols} (expect 4), tables=${v.tables} (expect 3)`);
    }
    console.log(`[PRD-003 migrate] OK — wo_cols=${v.wo_cols}/4, tables=${v.tables}/3 (crafts/evidences/stock_docs)`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PRD-003 migrate] FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
