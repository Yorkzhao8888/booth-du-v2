// ===========================================================================
// /api/booth/du 路由聚合入口 (TECH-DEBT-4)
// 统一挂载 du 前缀下分散的 5 个路由文件，路径与挂载顺序与原 index.ts 完全一致：
//   1. /suppliers      → du-suppliers.ts   (C2 本店供应商层, must be before /du)
//   2. /               → du.ts             (核心经营看板/工单/库存/BOM)
//   3. /               → du-purchase.ts    (/purchase-orders/*)
//   4. /               → du-modules.ts     (/dl/*, /svc/*, /profit/*, /wh/*, /fab/qc)
//   5. /               → du-supply.ts      (/supply/*: replenish, suppliers, batches, inventory/alerts, orders/track)
// 红线: 仅文件级聚合，路由路径、接口签名、requireRole/价格边界零行为变化。
// ===========================================================================
import { Router } from 'express';
import duCoreRoutes from '../du.js';
import duPurchaseRoutes from '../du-purchase.js';
import duModulesRoutes from '../du-modules.js';
import duSupplyRoutes from '../du-supply.js';
import duSuppliersRoutes from '../du-suppliers.js';
import quoteEngineRoutes from '../quote-engine.js';
import financeRouter, { financeReadonlyRouter } from '../finance.js';

const router = Router();

// 挂载顺序与原 index.ts 逐条对应，保持匹配优先级不变
router.use('/suppliers', duSuppliersRoutes);  // C2 本店供应商层 (must be before /)
router.use('/quote-engine', quoteEngineRoutes); // [PK-05] 报价引擎 (M 层知价, dex/dexx/dxx 403)
router.use('/finance', financeRouter);        // [PK-05] 业财闭环 xcase/vcase/reconcile (M 层)
router.use('/', duCoreRoutes);                // 核心经营看板
router.use('/', duPurchaseRoutes);            // /purchase-orders/*
router.use('/', duModulesRoutes);             // /dl/*, /svc/*, /profit/*, /wh/*, /fab/qc
router.use('/', duSupplyRoutes);              // /supply/* (replenish, suppliers, batches, inventory/alerts, orders/track)

export default router;
