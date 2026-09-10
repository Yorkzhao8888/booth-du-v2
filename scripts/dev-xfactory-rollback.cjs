#!/usr/bin/env node
/**
 * [XFACTORY-P1] 回滚脚本（与 dev-xfactory-migrate.cjs 对应，可逆）
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

const ROLLBACK = `
DROP INDEX IF EXISTS idx_production_orders_source;
ALTER TABLE booth_production_orders DROP COLUMN IF EXISTS order_family;
ALTER TABLE booth_production_orders DROP COLUMN IF EXISTS source;
DROP INDEX IF EXISTS idx_delivery_receipts_status;
DROP INDEX IF EXISTS idx_delivery_receipts_po;
DROP INDEX IF EXISTS idx_delivery_receipts_org_no;
DROP TABLE IF EXISTS booth_delivery_receipts;
DROP INDEX IF EXISTS idx_supply_purchases_status;
DROP INDEX IF EXISTS idx_supply_purchases_org_no;
DROP TABLE IF EXISTS booth_supply_purchases;
`;

(async () => {
  loadEnv();
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(ROLLBACK);
    await client.query('COMMIT');
    console.log('[xfactory-p1-rollback] OK: xfactory P1 objects removed');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[xfactory-p1-rollback] FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
})();
