/**
 * [BOOTH-PRD-003] dev 回滚脚本（仅回滚 PRD-003 增量, 保留历史数据列置空）
 * 用法: node scripts/dev-prd003-rollback.cjs
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

async function main() {
  loadEnv();
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('BEGIN');
    // 清 PRD-003 冒烟关联数据（防 FK 阻塞）后回滚结构
    await client.query(`DELETE FROM booth_work_order_evidences WHERE work_order_id IN (SELECT id FROM booth_work_orders WHERE production_task_id IS NOT NULL AND split_source IS NOT NULL AND step_name IS NOT NULL)`);
    await client.query(`DELETE FROM booth_stock_docs WHERE created_by = 'split-engine'`);
    await client.query(`UPDATE booth_work_orders SET production_task_id = NULL, split_source = NULL, step_name = NULL, dimension = NULL WHERE production_task_id IS NOT NULL`);
    await client.query(`DROP TABLE IF EXISTS booth_work_order_evidences CASCADE`);
    await client.query(`DROP TABLE IF EXISTS booth_stock_docs CASCADE`);
    await client.query(`DROP TABLE IF EXISTS booth_crafts CASCADE`);
    await client.query(`DROP INDEX IF EXISTS idx_work_orders_production_task`);
    await client.query(`ALTER TABLE booth_work_orders DROP COLUMN IF EXISTS production_task_id`);
    await client.query(`ALTER TABLE booth_work_orders DROP COLUMN IF EXISTS split_source`);
    await client.query(`ALTER TABLE booth_work_orders DROP COLUMN IF EXISTS step_name`);
    await client.query(`ALTER TABLE booth_work_orders DROP COLUMN IF EXISTS dimension`);
    await client.query('COMMIT');
    console.log('[PRD-003 rollback] OK — PRD-003 increments reverted');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[PRD-003 rollback] FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
