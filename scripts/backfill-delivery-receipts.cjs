#!/usr/bin/env node
/**
 * [XFACTORY-P1] 存量交付回执批量补发（先验 1 条，再批量）
 * 用法:
 *   node scripts/backfill-delivery-receipts.cjs --dry-run          # 只统计
 *   node scripts/backfill-delivery-receipts.cjs --limit 1          # 先验 1 条
 *   node scripts/backfill-delivery-receipts.cjs --limit 9999       # 全量批量
 * 对象: booth_fulfillments 中 status='completed' 且尚无交付回执的历史供给单
 * 口径: source=MARKET / receiver=XU（组合 2 渠道）; productionNo=首张工单号（PROD- 同序列）
 * 幂等: 按 org+production_no+shop_order_id 查重跳过
 */
const fs = require('fs');
const path = require('path');

const root = '/workspace/projects';
// 读取 .env DATABASE_URL
let dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  const envFile = fs.readFileSync(path.join(root, '.env'), 'utf8');
  const m = envFile.match(/^DATABASE_URL=(.+)$/m);
  if (m) dbUrl = m[1].trim();
}
const { Pool } = require(path.join(root, 'node_modules', 'pg'));
const pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const hasFlag = (name) => args.includes(name);
const LIMIT = parseInt(getArg('--limit') || '0', 10) || 0;
const DRY = hasFlag('--dry-run');

function receiptNo(tx) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return tx.query(`SELECT COUNT(*)::int AS c FROM booth_delivery_receipts WHERE receipt_no LIKE $1`, [`DLV-${ymd}-%`]).then((r) => `DLV-${ymd}-${String((r.rows[0].c || 0) + 1).padStart(4, '0')}`);
}

(async () => {
  const cands = await pool.query(
    `SELECT f.id, f.org_id, f.shop_order_id, f.wave_no, (SELECT COALESCE(SUM((it->>'qty')::int), 0) FROM jsonb_array_elements(f.items) it) AS qty, f.completed_at, (SELECT it->>'name' FROM jsonb_array_elements(f.items) it LIMIT 1) AS product_name,
            COALESCE((SELECT wo.work_order_no FROM booth_work_orders wo WHERE wo.fulfillment_id = f.id AND wo.work_order_no IS NOT NULL ORDER BY wo.id LIMIT 1), f.shop_order_id) AS production_no
       FROM booth_fulfillments f
      WHERE f.status = 'completed'
        AND NOT EXISTS (
          SELECT 1 FROM booth_delivery_receipts dr
           WHERE dr.org_id = f.org_id
             AND dr.production_no = COALESCE((SELECT wo.work_order_no FROM booth_work_orders wo WHERE wo.fulfillment_id = f.id AND wo.work_order_no IS NOT NULL ORDER BY wo.id LIMIT 1), f.shop_order_id)
             AND dr.source = 'MARKET'
        )
      ORDER BY f.id ASC`,
  );
  const rows = LIMIT > 0 ? cands.rows.slice(0, LIMIT) : cands.rows;
  console.log(`[backfill] 存量待补发: ${cands.rows.length} 条 | 本次执行: ${DRY ? 'DRY-RUN' : rows.length} 条 (limit=${LIMIT || 'ALL'})`);
  if (DRY) {
    for (const r of cands.rows.slice(0, 5)) console.log(`  样例: f.id=${r.id} shop=${r.shop_order_id} po=${r.production_no} wave=${r.wave_no}`);
    await pool.end();
    return;
  }

  let ok = 0, skip = 0, fail = 0;
  for (const f of rows) {
    if (!f.production_no) { skip++; continue; }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const rn = await receiptNo(client);
      const ins = await client.query(
        `INSERT INTO booth_delivery_receipts
           (org_id, receipt_no, production_order_id, production_no, wave_no, source, qty,
            evidence_nos, delivered_at, delivered_by, receiver_type, receiver_id, status)
         VALUES ($1,$2,NULL,$3,$4,'MARKET',$5,'[]'::jsonb,$6,'EDX','XU',$7,'delivered')
         ON CONFLICT DO NOTHING
         RETURNING id, receipt_no`,
        [f.org_id, rn, f.production_no, f.wave_no, f.qty || 0, f.completed_at || new Date(), f.shop_order_id],
      );
      if (ins.rowCount === 0) { await client.query('ROLLBACK'); skip++; continue; }
      const rec = ins.rows[0];
      await client.query(
        `INSERT INTO booth_outbox (org_id, event_type, payload)
         VALUES ($1, 'cmd.booth.delivery_receipt.issued.v1', $2::jsonb)`,
        [f.org_id, JSON.stringify({
          receiptNo: rec.receipt_no,
          productionNo: f.production_no,
          dxCaseNo: f.shop_order_id,
          waveNo: f.wave_no,
          source: 'MARKET',
          qty: f.qty || 0,
          evidenceNos: [],
          deliveredAt: f.completed_at || new Date().toISOString(),
          deliveredBy: 'EDX',
          receiver: { type: 'XU', id: f.shop_order_id },
          responsibilityTransferred: true,
          backfill: true,
        })],
      );
      await client.query('COMMIT');
      ok++;
      console.log(`  [OK] f.id=${f.id} → ${rec.receipt_no} productionNo=${f.production_no} qty=${f.qty}`);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      fail++;
      console.log(`  [FAIL] f.id=${f.id}: ${e.message}`);
    } finally {
      client.release();
    }
  }
  console.log(`[backfill] 完成: ok=${ok} skip=${skip} fail=${fail} | 剩余待补发: ${cands.rows.length - ok - skip}`);
  await pool.end();
})().catch((e) => { console.error('[backfill] FATAL:', e.message); process.exit(1); });
