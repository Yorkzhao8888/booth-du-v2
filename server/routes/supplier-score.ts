// BOOTH-PK-04 供给数据资产化 + 履约评分
// 评分只基于真实业务数据聚合(booth_fulfillments/booth_quality_checks/booth_andon_events/output_batches+trace_links),
// 不做假分/人为拔高; 样本不足如实不给分; 绝不暴露采购价/售价/毛利(价格字段不进入评分与对外响应)。
// 口径(weights/min_samples/window_days)由 EM/EU 配置, 每日评分落 supplier_scores 并带 weights_snapshot 保证透明可复算。
// 鉴权: 查询 requireFabRead 只读; 口径配置/手动重算 requireRole('em','du'/'dx'); org 限定。
import { Router } from 'express';
import { pool } from '../db.js';
import { requireFabRead } from './exx-fab-mes.js';
import { requireRole, type JwtPayload } from '../auth.js';

const router = Router();

type WeightKey = 'fulfillment' | 'on_time' | 'quality' | 'response' | 'trace';
const METRIC_KEYS: WeightKey[] = ['fulfillment', 'on_time', 'quality', 'response', 'trace'];

const DEFAULT_CONFIG = {
  weights: { fulfillment: 0.25, on_time: 0.25, quality: 0.25, response: 0.1, trace: 0.15 } as Record<WeightKey, number>,
  min_samples: 3,
  window_days: 90,
};

// 响应时效归一分档(口径透明): 均值分钟 → 0-100 分
function responseScore(avgMinutes: number): number {
  if (avgMinutes <= 30) return 100;
  if (avgMinutes <= 60) return 80;
  if (avgMinutes <= 120) return 60;
  if (avgMinutes <= 240) return 40;
  return 20;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

async function getConfig(orgId: number) {
  const q = await pool.query('SELECT weights, min_samples, window_days FROM supplier_score_configs WHERE org_id = $1', [orgId]);
  if (q.rows.length) {
    return { weights: q.rows[0].weights as Record<WeightKey, number>, min_samples: Number(q.rows[0].min_samples), window_days: Number(q.rows[0].window_days) };
  }
  return DEFAULT_CONFIG;
}

interface MetricAgg {
  score: number | null;
  sample: number;
  detail: Record<string, number>;
  avg_minutes?: number | null;
}

// 真实业务数据聚合(近 window_days), 返回各指标得分/样本量/明细计数
async function aggregateMetrics(orgId: number, windowDays: number): Promise<Record<WeightKey, MetricAgg>> {
  // 履约: 分母=确认履约责任后的单(排除 Created/Quoted), 分子=Delivered/Settled; Cancelled 计未履约
  const f = await pool.query(
    `SELECT contract_status, COUNT(*)::int AS n FROM booth_fulfillments
     WHERE org_id = $1 AND created_at >= NOW() - make_interval(days => $2)
     GROUP BY contract_status`, [orgId, windowDays]);
  const fMap = new Map<string, number>(f.rows.map((r: any) => [r.contract_status, Number(r.n)]));
  const fDone = (fMap.get('Delivered') || 0) + (fMap.get('Settled') || 0);
  const fDen = Math.max(0, [...fMap.values()].reduce((a: number, b: number) => a + b, 0) - (fMap.get('Created') || 0) - (fMap.get('Quoted') || 0));

  // 准时: Delivered/Settled 且有承诺交付时间(required_at), 按 milestones delivered/settled 时间判定
  const o = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE COALESCE((milestones->>'settled_at')::timestamptz, (milestones->>'delivered_at')::timestamptz) <= required_at)::int AS on_time
     FROM booth_fulfillments
     WHERE org_id = $1 AND contract_status IN ('Delivered','Settled')
       AND required_at IS NOT NULL
       AND COALESCE((milestones->>'settled_at')::timestamptz, (milestones->>'delivered_at')::timestamptz) IS NOT NULL
       AND created_at >= NOW() - make_interval(days => $2)`, [orgId, windowDays]);
  const oTotal = Number(o.rows[0]?.total || 0);
  const oOnTime = Number(o.rows[0]?.on_time || 0);

  // 良品: 完检(pass/reject)中 pass 占比
  const q = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE result = 'pass')::int AS pass_n,
            COUNT(*) FILTER (WHERE result IN ('pass','reject'))::int AS done_n
     FROM booth_quality_checks
     WHERE org_id = $1 AND created_at >= NOW() - make_interval(days => $2)`, [orgId, windowDays]);
  const qPass = Number(q.rows[0]?.pass_n || 0);
  const qDone = Number(q.rows[0]?.done_n || 0);

  // 响应时效: andon 事件 已响应均值分钟
  const a = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(responded_at)::int AS responded_n,
            AVG(EXTRACT(EPOCH FROM (responded_at - created_at)) / 60) AS avg_minutes
     FROM booth_andon_events
     WHERE org_id = $1 AND responded_at IS NOT NULL
       AND created_at >= NOW() - make_interval(days => $2)`, [orgId, windowDays]);
  const aN = Number(a.rows[0]?.responded_n || 0);
  const avgMin = a.rows[0]?.avg_minutes !== null && a.rows[0]?.avg_minutes !== undefined ? Number(Number(a.rows[0].avg_minutes).toFixed(2)) : null;

  // 追溯完整度: 近 window_days 完成工单中, 同时有产出批次与领料追溯链的比例
  const t = await pool.query(
    `SELECT COUNT(*)::int AS done_wo,
            COUNT(*) FILTER (WHERE ob_n > 0 AND tl_n > 0)::int AS traced
     FROM (
       SELECT w.id,
              (SELECT COUNT(*) FROM booth_output_batches b WHERE b.work_order_id = w.id AND b.org_id = w.org_id) AS ob_n,
              (SELECT COUNT(*) FROM booth_trace_links l WHERE l.work_order_id = w.id AND l.org_id = w.org_id) AS tl_n
       FROM booth_work_orders w
       WHERE w.org_id = $1 AND w.status = 'completed' AND w.completed_at >= NOW() - make_interval(days => $2)
     ) x`, [orgId, windowDays]);
  const tDone = Number(t.rows[0]?.done_wo || 0);
  const tTraced = Number(t.rows[0]?.traced || 0);

  return {
    fulfillment: {
      score: fDen > 0 ? round2((fDone / fDen) * 100) : null,
      sample: fDen,
      detail: { delivered: fMap.get('Delivered') || 0, settled: fMap.get('Settled') || 0, cancelled: fMap.get('Cancelled') || 0, in_progress: fDen - fDone - (fMap.get('Cancelled') || 0) },
    },
    on_time: {
      score: oTotal > 0 ? round2((oOnTime / oTotal) * 100) : null,
      sample: oTotal,
      detail: { on_time: oOnTime, late: oTotal - oOnTime },
    },
    quality: {
      score: qDone > 0 ? round2((qPass / qDone) * 100) : null,
      sample: qDone,
      detail: { pass: qPass, reject: qDone - qPass },
    },
    response: {
      score: avgMin !== null ? responseScore(avgMin) : null,
      sample: aN,
      avg_minutes: avgMin,
      detail: { responded: aN },
    },
    trace: {
      score: tDone > 0 ? round2((tTraced / tDone) * 100) : null,
      sample: tDone,
      detail: { traced: tTraced, untraced: tDone - tTraced },
    },
  };
}

// 当日评分聚合 + UPSERT(评分随数据每日更新: 每日首访固化, 当日重算覆盖)
async function computeAndUpsert(orgId: number, boothId: number, cfg: Awaited<ReturnType<typeof getConfig>>) {
  const agg = await aggregateMetrics(orgId, cfg.window_days);
  const insufficient: string[] = [];
  let overall: number | null = null;
  const allEnough = METRIC_KEYS.every((k) => agg[k].sample >= cfg.min_samples);
  if (allEnough) {
    overall = round2(METRIC_KEYS.reduce((sum, k) => sum + (cfg.weights[k] || 0) * (agg[k].score as number), 0));
  } else {
    for (const k of METRIC_KEYS) {
      if (agg[k].sample < cfg.min_samples) insufficient.push(k);
    }
  }
  const up = await pool.query(
    `INSERT INTO supplier_scores
       (org_id, booth_id, fulfillment_rate, fulfillment_sample, on_time_rate, on_time_sample,
        quality_rate, quality_sample, response_time, response_sample, trace_rate, trace_sample,
        overall_score, weights_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (org_id, booth_id, score_date) DO UPDATE SET
       fulfillment_rate = EXCLUDED.fulfillment_rate, fulfillment_sample = EXCLUDED.fulfillment_sample,
       on_time_rate = EXCLUDED.on_time_rate, on_time_sample = EXCLUDED.on_time_sample,
       quality_rate = EXCLUDED.quality_rate, quality_sample = EXCLUDED.quality_sample,
       response_time = EXCLUDED.response_time, response_sample = EXCLUDED.response_sample,
       trace_rate = EXCLUDED.trace_rate, trace_sample = EXCLUDED.trace_sample,
       overall_score = EXCLUDED.overall_score, weights_snapshot = EXCLUDED.weights_snapshot,
       updated_at = NOW()
     RETURNING *`,
    [orgId, boothId, agg.fulfillment.score, agg.fulfillment.sample, agg.on_time.score, agg.on_time.sample,
      agg.quality.score, agg.quality.sample, agg.response.avg_minutes ?? null, agg.response.sample,
      agg.trace.score, agg.trace.sample, overall, JSON.stringify(cfg.weights)]);
  return { row: up.rows[0], agg, overall, insufficient, status: insufficient.length ? 'insufficient' : 'scored' };
}

function metricView(agg: MetricAgg, cfg: Awaited<ReturnType<typeof getConfig>>, key: WeightKey) {
  return {
    score: agg.score,
    sample: agg.sample,
    status: agg.sample >= cfg.min_samples ? 'ok' : 'insufficient',
    detail: agg.detail,
    ...(key === 'response' ? { avg_minutes: agg.avg_minutes ?? null } : {}),
  };
}

// GET /exx/fab/score/dashboard —— 本 Booth 信用看板(指标 + 趋势 + 样本量 + 口径)
router.get('/fab/score/dashboard', requireFabRead, async (req: any, res, next) => {
  try {
    const orgId = req.user.orgId as number;
    const cfg = await getConfig(orgId);
    const { row, agg, overall, insufficient, status } = await computeAndUpsert(orgId, orgId, cfg);
    const trend = await pool.query(
      `SELECT score_date, overall_score, fulfillment_rate, on_time_rate, quality_rate, response_time, trace_rate
       FROM supplier_scores WHERE org_id = $1 AND booth_id = $2 ORDER BY score_date DESC LIMIT 30`,
      [orgId, orgId]);
    res.json({
      success: true,
      data: {
        booth_id: orgId,
        score_date: row.score_date,
        status,
        overall_score: overall,
        insufficient_metrics: insufficient,
        metrics: {
          fulfillment: { rate: row.fulfillment_rate, sample: row.fulfillment_sample, status: agg.fulfillment.sample >= cfg.min_samples ? 'ok' : 'insufficient', detail: agg.fulfillment.detail },
          on_time: { rate: row.on_time_rate, sample: row.on_time_sample, status: agg.on_time.sample >= cfg.min_samples ? 'ok' : 'insufficient', detail: agg.on_time.detail },
          quality: { rate: row.quality_rate, sample: row.quality_sample, status: agg.quality.sample >= cfg.min_samples ? 'ok' : 'insufficient', detail: agg.quality.detail },
          response: { avg_minutes: row.response_time, score: agg.response.score, sample: row.response_sample, status: agg.response.sample >= cfg.min_samples ? 'ok' : 'insufficient', detail: agg.response.detail },
          trace: { rate: row.trace_rate, sample: row.trace_sample, status: agg.trace.sample >= cfg.min_samples ? 'ok' : 'insufficient', detail: agg.trace.detail },
        },
        trend: trend.rows,
        config: { weights: cfg.weights, min_samples: cfg.min_samples, window_days: cfg.window_days },
        meta: {
          note: '评分基于真实业务数据自动聚合(履约/准时/良品/安灯响应/追溯完整度), 口径透明可下钻; 不含任何价格字段',
          response_rule: '响应时效分档: ≤30min=100, ≤60min=80, ≤120min=60, ≤240min=40, >240min=20',
          sample_rule: `任一指标样本量 < ${cfg.min_samples} 时不出总分, 如实标注「样本不足」`,
        },
      },
    });
  } catch (err) { next(err); }
});

// GET /exx/fab/score/:boothId —— 对外可检索(Market 只读, 口径透明, 不含价格)
router.get('/fab/score/:boothId', requireFabRead, async (req: any, res, next) => {
  try {
    const orgId = req.user.orgId as number;
    const boothId = Number(req.params.boothId);
    if (!Number.isInteger(boothId) || boothId <= 0) {
      return res.status(400).json({ success: false, error: 'INVALID_BOOTH_ID' });
    }
    // org 限定: 本环境 Booth 档案即本 org; 其他 Booth 暂无可披露档案(如实 404, 不造分)
    if (boothId !== orgId) {
      return res.status(404).json({ success: false, error: 'SCORE_NOT_AVAILABLE', message: '该 Booth 暂无可披露的供给信用档案' });
    }
    const cfg = await getConfig(orgId);
    const { row, agg, overall, insufficient, status } = await computeAndUpsert(orgId, boothId, cfg);
    res.json({
      success: true,
      data: {
        booth_id: boothId,
        score_date: row.score_date,
        status,
        overall_score: overall,
        insufficient_metrics: insufficient,
        metrics: {
          fulfillment: metricView(agg.fulfillment, cfg, 'fulfillment'),
          on_time: metricView(agg.on_time, cfg, 'on_time'),
          quality: metricView(agg.quality, cfg, 'quality'),
          response: metricView(agg.response, cfg, 'response'),
          trace: metricView(agg.trace, cfg, 'trace'),
        },
        config: { weights: cfg.weights, min_samples: cfg.min_samples, window_days: cfg.window_days },
        meta: { note: 'Market 对外检索视图: 评分基于真实业务数据聚合, 口径透明可复算, 不含任何价格信息' },
      },
    });
  } catch (err) { next(err); }
});

// POST /exx/fab/score/config —— 评分口径配置(EM/EU; du 兜底)
router.post('/fab/score/config', requireRole('em', 'du'), async (req: any, res, next) => {
  try {
    const user = req.user as JwtPayload;
    const orgId = user.orgId as number;
    const body = req.body || {};
    const weights = body.weights;
    if (!weights || typeof weights !== 'object' || Array.isArray(weights)) {
      return res.status(400).json({ success: false, error: 'INVALID_WEIGHTS', message: 'weights 必填(5 项指标权重对象)' });
    }
    for (const k of METRIC_KEYS) {
      const v = Number((weights as any)[k]);
      if (!Number.isFinite(v) || v < 0 || v > 1) {
        return res.status(400).json({ success: false, error: 'INVALID_WEIGHTS', message: `weights.${k} 必须为 0-1 数值` });
      }
    }
    const weightSum = METRIC_KEYS.reduce((s, k) => s + Number(weights[k]), 0);
    if (Math.abs(weightSum - 1) > 0.01) {
      return res.status(400).json({ success: false, error: 'WEIGHTS_SUM_INVALID', message: `权重之和必须为 1(当前 ${weightSum.toFixed(3)})` });
    }
    const minSamples = Number(body.min_samples ?? DEFAULT_CONFIG.min_samples);
    const windowDays = Number(body.window_days ?? DEFAULT_CONFIG.window_days);
    if (!Number.isInteger(minSamples) || minSamples < 1) {
      return res.status(400).json({ success: false, error: 'INVALID_MIN_SAMPLES', message: 'min_samples 必须 ≥ 1' });
    }
    if (!Number.isInteger(windowDays) || windowDays < 7 || windowDays > 365) {
      return res.status(400).json({ success: false, error: 'INVALID_WINDOW_DAYS', message: 'window_days 取值 7-365' });
    }
    const normWeights: Record<WeightKey, number> = {
      fulfillment: round2(Number(weights.fulfillment)),
      on_time: round2(Number(weights.on_time)),
      quality: round2(Number(weights.quality)),
      response: round2(Number(weights.response)),
      trace: round2(Number(weights.trace)),
    };
    const up = await pool.query(
      `INSERT INTO supplier_score_configs (org_id, weights, min_samples, window_days, updated_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (org_id) DO UPDATE SET weights = EXCLUDED.weights, min_samples = EXCLUDED.min_samples,
         window_days = EXCLUDED.window_days, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING *`,
      [orgId, JSON.stringify(normWeights), minSamples, windowDays, user.userId]);
    res.json({ success: true, data: { config: { weights: up.rows[0].weights, min_samples: up.rows[0].min_samples, window_days: up.rows[0].window_days } } });
  } catch (err) { next(err); }
});

// POST /exx/fab/score/refresh —— 手动触发重算(M 层 du/dx/em)
router.post('/fab/score/refresh', requireRole('em', 'du', 'dx'), async (req: any, res, next) => {
  try {
    const orgId = req.user.orgId as number;
    const cfg = await getConfig(orgId);
    const { row, overall, insufficient, status } = await computeAndUpsert(orgId, orgId, cfg);
    res.json({
      success: true,
      data: { booth_id: orgId, score_date: row.score_date, status, overall_score: overall, insufficient_metrics: insufficient },
    });
  } catch (err) { next(err); }
});

export default router;
