#!/usr/bin/env node
/**
 * [BOOTH-PRD-001] 契约地基回滚脚本（可逆）
 * 回滚 dev-prd001-migrate.cjs: 删除任务表 → 生产单表
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

async function main() {
  const { Client } = require('pg');
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DROP TABLE IF EXISTS booth_production_tasks CASCADE`);
    await client.query(`DROP TABLE IF EXISTS booth_production_orders CASCADE`);
    console.log('[BOOTH-PRD-001] rollback OK: tables dropped');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error('[BOOTH-PRD-001] rollback failed:', e.message);
  process.exit(1);
});
