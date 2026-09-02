// BOOTH-PK-05 报价引擎路由: POST /api/booth/du/quote-engine/quote
// 红线: 仅 du/dx 可调用(M 层知价); X 层(dex/exx/dxx)一律 403; 价格字段不出 M 层
// 真实数据增强(不造假): MATERIAL 用 booth_sku_cost 真实移动加权成本; EDGE 用 station_capabilities 真实能力单价; 无真实源时用内置参数候选并如实标注 origin
import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { buildQuote, builtinUnits, type CapabilityUnit } from '../services/quote-engine.js';
import type { Request, Response, NextFunction } from 'express';

const router = Router();

router.post('/quote', requireAuth, requireRole('du', 'dx'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const body = (req.body || {}) as { sku_id?: number; quantity?: number; due_date?: string; specs?: Record<string, any> };
    const quantity = Number(body.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return res.status(400).json({ success: false, error: 'INVALID_QUANTITY', message: 'quantity 必须为正数' });
    }
    const skuId = Number(body.sku_id);
    const units: CapabilityUnit[] = builtinUnits();
    if (Number.isInteger(skuId)) {
      const sc = await pool.query('SELECT unit_cost FROM booth_sku_cost WHERE org_id = $1 AND sku_id = $2', [user.orgId, skuId]);
      if (sc.rows.length) {
        const std = units.find((u) => u.unitId === 'dyard-standard')!;
        std.unitCost = Number(sc.rows[0].unit_cost);
        std.origin = 'real';
        std.name = 'D-Yard 物料(真实移动加权成本)';
      }
    }
    const st = await pool.query(
      `SELECT AVG(rate) AS avg_rate FROM station_capabilities WHERE org_id = $1 AND status = 'active' AND rate IS NOT NULL`,
      [user.orgId],
    );
    if (st.rows[0].avg_rate !== null && st.rows[0].avg_rate !== undefined) {
      const std = units.find((u) => u.unitId === 'station-standard')!;
      std.unitCost = Number(st.rows[0].avg_rate);
      std.origin = 'real';
      std.name = 'Station 产线(真实能力单价)';
    }
    const quote = buildQuote({
      skuId: Number.isInteger(skuId) ? skuId : undefined,
      quantity,
      dueDate: body.due_date,
      specs: body.specs,
    });
    return res.json({
      success: true,
      data: {
        ...quote,
        request: { sku_id: Number.isInteger(skuId) ? skuId : null, quantity, due_date: body.due_date ?? null },
        meta: { engine: 'QuoteEngine v1', note: '四能力源取成本/质量综合最优单元; 无真实数据源时使用内置参数候选(origin=param)' },
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
