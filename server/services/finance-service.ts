// BOOTH-PK-05 业财闭环服务: 履约(Settled) -> XCase 专案(幂等) -> 凭证 -> 结案 -> VCase 总账(幂等) -> 对账
// 红线:
//  - 只基于真实履约业务数据(quote_snapshot.total_amount 收入锚; 成本凭证由 M 层以真实单据补录, 不做假数据填充)
//  - 幂等: xcase 凭 org+fulfillment_id 唯一; 凭证凭 org+source_voucher 唯一; vcase 入账凭 org+source_voucher 唯一
//  - 事件: 业务落库 + booth_outbox 发件箱(至少一次投递); vcase 幂等去重防重复入账
//  - 价格边界: 本服务只在 M 层路由(du/em)挂载, X 层不可达
import { pool } from '../db.js';

export interface VoucherInput {
  direction: 'income' | 'expense';
  category: string; // income / material / labor / intel / edge
  amount: number;
  summary?: string;
  sourceVoucher: string;
  createdBy?: number;
}

function voucherNo(): string {
  return `V-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 履约 Settled 自动立专案(幂等): 同一履约只立一案; 收入凭证取真实报价快照 total_amount
 * 返回 null 表示已存在(幂等命中)
 */
export async function openXCaseForFulfillment(
  orgId: number,
  fulfillment: { id: number; shop_order_id?: string | null; quote_snapshot?: unknown },
): Promise<{ xcaseNo: string; xcaseId: number; income: number; voucherNos: string[] } | null> {
  const xcaseNo = `XC-${orgId}-FUL${fulfillment.id}`;
  // SIM-/SIM-B- 前缀订单 = 仿真单, 打标隔离(不混真实口径)
  const isSim = typeof fulfillment.shop_order_id === 'string' && fulfillment.shop_order_id.startsWith('SIM-');
  const businessType = isSim ? 'booth_fulfillment_sim' : 'booth_fulfillment';
  const snapshot = (fulfillment.quote_snapshot ?? null) as { total_amount?: number } | null;
  const income = snapshot && Number.isFinite(Number(snapshot.total_amount)) ? round2(Number(snapshot.total_amount)) : 0;

  const ins = await pool.query(
    `INSERT INTO booth_xcases (org_id, xcase_no, business_type, title, parties, fulfillment_id)
     VALUES ($1, $2, $6, $3, $4::jsonb, $5)
     ON CONFLICT (org_id, fulfillment_id) WHERE fulfillment_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      orgId,
      xcaseNo,
      `${isSim ? '(SIM) ' : ''}履约专案 ${fulfillment.shop_order_id ?? '#' + fulfillment.id}`,
      JSON.stringify([
        { role: 'shop', id: fulfillment.shop_order_id ?? null },
        { role: 'booth', id: String(orgId) },
      ]),
      fulfillment.id,
      businessType,
    ],
  );
  if (!ins.rows.length) return null; // 幂等命中
  const xcaseId = ins.rows[0].id as number;

  const voucherNos: string[] = [];
  if (income > 0 && !isSim) { // SIM 仿真单不建真实收入凭证
    const v = await pool.query(
      `INSERT INTO booth_vouchers (org_id, xcase_id, voucher_no, direction, category, amount, summary, source_voucher, created_by)
       VALUES ($1, $2, $3, 'income', 'income', $4, $5, $6, NULL)
       ON CONFLICT (org_id, source_voucher) DO NOTHING
       RETURNING voucher_no`,
      [orgId, xcaseId, voucherNo(), income, `履约收入(真实报价快照) ${fulfillment.shop_order_id ?? ''}`.trim(), `income:FUL${fulfillment.id}`],
    );
    if (v.rows.length) voucherNos.push(v.rows[0].voucher_no as string);
  }
  return { xcaseNo, xcaseId, income: isSim ? 0 : income, voucherNos };
}

/** M 层补录成本/收入凭证(真实单据, source_voucher 幂等) */
export async function addVoucher(orgId: number, xcaseId: number, input: VoucherInput): Promise<{ voucherNo: string; duplicated: boolean }> {
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw Object.assign(new Error('凭证金额必须为正数'), { statusCode: 400 });
  if (!['income', 'expense'].includes(input.direction)) throw Object.assign(new Error('direction 必须为 income/expense'), { statusCode: 400 });
  if (!['income', 'material', 'labor', 'intel', 'edge'].includes(input.category)) throw Object.assign(new Error('category 必须为 income/material/labor/intel/edge'), { statusCode: 400 });
  const x = await pool.query('SELECT id FROM booth_xcases WHERE id = $1 AND org_id = $2', [xcaseId, orgId]);
  if (!x.rows.length) throw Object.assign(new Error('专案不存在'), { statusCode: 404 });
  if (!input.sourceVoucher || String(input.sourceVoucher).length > 80) throw Object.assign(new Error('source_voucher 必填(<=80 字符, 真实单据号)'), { statusCode: 400 });

  const ins = await pool.query(
    `INSERT INTO booth_vouchers (org_id, xcase_id, voucher_no, direction, category, amount, summary, source_voucher, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (org_id, source_voucher) DO NOTHING
     RETURNING voucher_no`,
    [orgId, xcaseId, voucherNo(), input.direction, input.category, amount, input.summary ?? null, String(input.sourceVoucher), input.createdBy ?? null],
  );
  if (!ins.rows.length) {
    const dup = await pool.query('SELECT voucher_no FROM booth_vouchers WHERE org_id = $1 AND source_voucher = $2', [orgId, String(input.sourceVoucher)]);
    return { voucherNo: dup.rows[0]?.voucher_no ?? '', duplicated: true };
  }
  return { voucherNo: ins.rows[0].voucher_no as string, duplicated: false };
}

/** 专案结案: 凭证汇总进 VCase 总账(幂等 source_voucher); 重复结案不重复入账 */
export async function closeXCase(orgId: number, xcaseId: number): Promise<{ xcaseNo: string; entered: number; skipped: number; income: number; expense: number }> {
  const x = await pool.query('SELECT id, xcase_no, status, business_type FROM booth_xcases WHERE id = $1 AND org_id = $2 FOR UPDATE', [xcaseId, orgId]);
  if (!x.rows.length) throw Object.assign(new Error('专案不存在'), { statusCode: 404 });
  if (x.rows[0].business_type === 'booth_fulfillment_sim') {
    // SIM 专案永不进入 vcase 总账
    throw Object.assign(new Error('SIM 专案不进入 vcase 总账'), { statusCode: 409 });
  }
  if (x.rows[0].status === 'closed') {
    // 幂等: 已结案返回既定结果
    const sums = await pool.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE direction='income'),0) AS income, COALESCE(SUM(amount) FILTER (WHERE direction='expense'),0) AS expense FROM booth_vcase_entries WHERE org_id=$1 AND xcase_id=$2`,
      [orgId, xcaseId],
    );
    return { xcaseNo: x.rows[0].xcase_no, entered: 0, skipped: 0, income: Number(sums.rows[0].income), expense: Number(sums.rows[0].expense) };
  }
  const vouchers = await pool.query('SELECT id, direction, category, amount, source_voucher FROM booth_vouchers WHERE xcase_id = $1 AND org_id = $2', [xcaseId, orgId]);
  const vcaseNo = `VC-BOOTH-${orgId}`;
  let entered = 0;
  let skipped = 0;
  for (const v of vouchers.rows) {
    const ins = await pool.query(
      `INSERT INTO booth_vcase_entries (org_id, vcase_no, xcase_id, xcase_no, direction, category, amount, source_voucher)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (org_id, source_voucher) DO NOTHING`,
      [orgId, vcaseNo, xcaseId, x.rows[0].xcase_no, v.direction, v.category, v.amount, v.source_voucher],
    );
    ins.rowCount ? (entered += 1) : (skipped += 1);
  }
  const sums = await pool.query(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE direction='income'),0) AS income, COALESCE(SUM(amount) FILTER (WHERE direction='expense'),0) AS expense FROM booth_vcase_entries WHERE org_id=$1 AND xcase_id=$2`,
    [orgId, xcaseId],
  );
  await pool.query(`UPDATE booth_xcases SET status='closed', closed_at=NOW(), updated_at=NOW() WHERE id=$1 AND org_id=$2`, [xcaseId, orgId]);
  return { xcaseNo: x.rows[0].xcase_no, entered, skipped, income: Number(sums.rows[0].income), expense: Number(sums.rows[0].expense) };
}

/** 对账: sum(xcase 凭证金额) vs vcase 总账口径, 收入/支出分别校验 */
export async function reconcile(orgId: number): Promise<{
  xcase_total: { income: number; expense: number };
  vcase_total: { income: number; expense: number };
  income_match: boolean;
  expense_match: boolean;
  all_pass: boolean;
  per_case: { xcase_no: string; status: string; business_type: string; income: number; expense: number; vouchers: number; in_vcase: boolean }[];
  open_cases: number;
}> {
  const xSums = await pool.query(
    `SELECT COALESCE(SUM(v.amount) FILTER (WHERE v.direction='income'),0) AS income,
            COALESCE(SUM(v.amount) FILTER (WHERE v.direction='expense'),0) AS expense
     FROM booth_vouchers v JOIN booth_xcases x ON x.id = v.xcase_id
     WHERE x.org_id = $1 AND x.status = 'closed' AND x.business_type <> 'booth_fulfillment_sim'`,
    [orgId],
  );
  const vSums = await pool.query(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE direction='income'),0) AS income,
            COALESCE(SUM(amount) FILTER (WHERE direction='expense'),0) AS expense
     FROM booth_vcase_entries WHERE org_id = $1`,
    [orgId],
  );
  const per = await pool.query(
    `SELECT x.xcase_no, x.status, x.business_type,
            COALESCE(SUM(v.amount) FILTER (WHERE v.direction='income'),0) AS income,
            COALESCE(SUM(v.amount) FILTER (WHERE v.direction='expense'),0) AS expense,
            COUNT(v.id)::int AS vouchers,
            COUNT(e.id)::int AS entered
     FROM booth_xcases x
     LEFT JOIN booth_vouchers v ON v.xcase_id = x.id
     LEFT JOIN booth_vcase_entries e ON e.source_voucher = v.source_voucher AND e.org_id = x.org_id
     WHERE x.org_id = $1
     GROUP BY x.id, x.xcase_no, x.status, x.business_type
     ORDER BY x.id DESC LIMIT 50`,
    [orgId],
  );
  const near = (a: number, b: number) => Math.abs(round2(a) - round2(b)) < 0.01;
  const incomeMatch = near(Number(xSums.rows[0].income), Number(vSums.rows[0].income));
  const expenseMatch = near(Number(xSums.rows[0].expense), Number(vSums.rows[0].expense));
  const openCases = await pool.query(`SELECT COUNT(*)::int AS n FROM booth_xcases WHERE org_id=$1 AND status='open'`, [orgId]);
  return {
    xcase_total: { income: round2(Number(xSums.rows[0].income)), expense: round2(Number(xSums.rows[0].expense)) },
    vcase_total: { income: round2(Number(vSums.rows[0].income)), expense: round2(Number(vSums.rows[0].expense)) },
    income_match: incomeMatch,
    expense_match: expenseMatch,
    all_pass: incomeMatch && expenseMatch,
    per_case: per.rows.map((r) => ({
      xcase_no: r.xcase_no,
      status: r.status,
      business_type: r.business_type,
      income: round2(Number(r.income)),
      expense: round2(Number(r.expense)),
      vouchers: r.vouchers,
      in_vcase: r.vouchers > 0 && r.entered === r.vouchers,
    })),
    open_cases: openCases.rows[0].n,
  };
}
