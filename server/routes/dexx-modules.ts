/**
 * dexx 模块路由聚合 (TECH-DEBT-1)
 * 原 dexx-modules.ts (1940 行) 按模块拆分为 5 个子文件，本文件仅做聚合挂载。
 * 挂载顺序与拆分前的路由注册顺序保持一致（FAB 基础 → WH → DL → SVC → FAB-MES），
 * 各模块路径前缀互不相交（/fab /wh /dl /svc），路由匹配行为与拆分前完全一致。
 *
 * 子文件:
 *   dexx-fab.ts      - FAB 基础执行: 报工/完成/产线阶段/看板/良品率/QC
 *   dexx-wh.ts       - WH: 盘点/批次/供给单/设备管理/场地资源
 *   dexx-dl.ts       - DL: 配送队列/任务流转/签收/异常
 *   dexx-svc.ts      - SVC: 服务队列/任务流转/异常
 *   dexx-fab-mes.ts  - FAB-MES: Station-OS/产线视角/设备OEE/保养/安灯
 *
 * 红线: 路由挂载路径 / 接口签名 / requireHat 角色隔离 / 价格边界 100% 保持原样。
 */
import { Router } from 'express';
import dexxFabRoutes from './dexx-fab.js';
import dexxWhRoutes from './dexx-wh.js';
import dexxDlRoutes from './dexx-dl.js';
import dexxSvcRoutes from './dexx-svc.js';
import dexxFabTraceRoutes from './dexx-fab-trace.js';
import dexxFabMesRoutes from './dexx-fab-mes.js';

const router = Router();

router.use(dexxFabRoutes);
router.use(dexxFabTraceRoutes);
router.use(dexxWhRoutes);
router.use(dexxDlRoutes);
router.use(dexxSvcRoutes);
router.use(dexxFabMesRoutes);

export default router;
