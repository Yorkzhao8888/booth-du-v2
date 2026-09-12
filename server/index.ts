import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { migrate } from './migrate.js';
import { startOutboxPoller } from './services/outbox-service.js';
import { addClient, removeClient, startHeartbeat } from './sse.js';
import { requireAuth, stripXExecutorPrices } from './auth.js';
import type { JwtPayload } from './auth.js';

import authRoutes from './routes/auth.js';
import fulfillmentRoutes from './routes/fulfillment.js';
import onboardingRoutes from './routes/onboarding.js';
import ecoRoutes from './routes/eco.js';
import internalRoutes from './routes/internal.js';
import { aliasRouter as internalAliasRoutes } from './routes/internal.js'; // [BOOTH-LINK-01] 根级别名 router (Shop XBUS 直调 /events/*)
import duRoutes from './routes/du/index.js';   // /api/booth/du 聚合入口 (TECH-DEBT-4)
import exRoutes from './routes/ex.js';
import exxRoutes from './routes/edxx.js';
import emxRoutes from './routes/emx.js';   // [XFACTORY-P1] EMX 采购桩接
import edxRoutes from './routes/edx.js';   // [XFACTORY-P1] EDX 交付回执
import exModulesRoutes from './routes/ex-modules.js';
import exxModulesRoutes from './routes/edxx-modules.js';
import emRoutes from './routes/em.js';
import marketRoutes from './routes/market.js';
import jobRoutes from './routes/job.js';
import { supplyOrdersRouter, deliveriesRouter } from './routes/supply-order.js'; // BOOTH-PK-02 SupplyOrder 显式契约
import productionRoutes from './routes/production.js'; // [BOOTH-PRD-001] 契约地基: 生产单聚合实体 + G-007 状态机
import pmMgmtRoutes from './routes/pm.js'; // [BOOTH-PRD-002] 铺面管理+权限
import craftsRoutes from './routes/crafts.js'; // [BOOTH-PRD-003] 研发铺工艺管理

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// [BOOTH-R7-01/DEF + AUTH-02] 启动期认证初始化: 显式 PEM 优先, 缺省时 JWKS 自动发现; 全程失败则 fail-closed (503 AUTH_NOT_READY)
import { initOASAuth, isOASEnabled } from './services/oas-client.js';
void initOASAuth(); // 异步就绪: 就绪前认证请求按 fail-closed 503 处理, 就绪后自动恢复

const PORT = Number(process.env.DEPLOY_RUN_PORT || process.env.PORT) || 5000;

// Middleware
app.use(cors());
// [BOOTH-R7-DEF-3] 捕获原始 body 供事件签名验签 (HMAC 对原文计算)
app.use(express.json({ limit: '10mb', verify: (req: any, _res, buf) => { (req as any).rawBody = buf.toString('utf8'); } }));

// Health check
const healthHandler = (_req: any, res: any) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
};
app.get('/api/booth/health', healthHandler);
// [BOOTH-DEPLOY-01] 平台健康探测常用路径别名（同 handler，零 DB 依赖，任何探测路径均可命中）
app.get(['/healthz', '/health', '/readyz', '/readiness', '/livez'], healthHandler);

// SSE stream endpoint
app.get('/api/booth/stream', requireAuth, (req, res) => {
  // @ts-ignore
  const user = req.user as JwtPayload;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('event: connected\ndata: {"status":"connected"}\n\n');

  addClient(user.orgId, res);

  req.on('close', () => {
    removeClient(user.orgId, res);
  });
});

// [Xfactory-B6] 旧路径 /exx → /edxx 301 重定向 (bundle 历史残留/书签场景)
app.use('/exx', (req: import('express').Request, res: import('express').Response) => {
  const rest = req.originalUrl.replace(/^\/exx/, '');
  res.redirect(301, `/edxx${rest.startsWith('/') || rest === '' ? rest : `/${rest}`}`);
});

// Mount routes
app.use('/api/booth/auth', authRoutes);
app.use('/api/booth/onboarding', requireAuth, onboardingRoutes); // [ONBOARDING-P0] 快速上手包 (EDU 向导+演示数据)
app.use('/api/booth/eco', requireAuth, ecoRoutes); // [XDP-ECO] 生态四主体 (VEM 控制台+入驻流+经营户铺位)
// [BOOTH-CONN-01] Market 观察窗配套: SSE 履约推送 + 全链路时间线
app.use('/api/booth/fulfillment', fulfillmentRoutes);
app.use('/api/booth/internal', internalRoutes);
app.use('/events', internalAliasRoutes);         // [BOOTH-LINK-01] 根级别名: Shop XBUS 直调 /events/order-confirmed (与 /api/booth/internal/events 等价)
// /api/booth/du 聚合挂载: suppliers(前置)/核心看板/purchase-orders/dl+svc+profit+wh+fabqc/supply
// (TECH-DEBT-4: 原 5 个分散挂载点收敛进 routes/du/index.ts, 挂载顺序不变)
app.use('/api/booth/du', duRoutes);
app.use('/api/booth/ex', requireAuth, exRoutes); // [Xfactory-B7] 补鉴权 (09-10 遗留裸挂)
// FIX3: modules 前置(带独立 requireAuth) — edxx.ts 的 router.use(requireRole('edxx'))
// 会全局拦截同前缀请求, du/dx/edx 的产线只读 GET 需先经 edxx-modules 的 requireFabRead 放行
app.use('/api/booth/edxx', requireAuth, stripXExecutorPrices, exxModulesRoutes); // [BOOTH-PRD-002] X 层执行剥售价 // /api/booth/edxx/fab/*, /wh/*, /dl/*, /svc/*
// New module routes
app.use('/api/booth/ex', requireAuth, stripXExecutorPrices, exModulesRoutes); // [BOOTH-PRD-002] X 层执行剥售价 // [Xfactory-B7] 补鉴权
// DEU 分身入口: DU 以分身身份进入履约铺后台 (仅挂分身标记, 不重复挂 EDX 路由 — 数据权限随用户身份)  // /api/booth/ex/dl/*, /svc/*, /wh/*, /fab/*, /inventory/alerts
app.use('/api/booth/edxx', requireAuth, stripXExecutorPrices, exxRoutes); // [BOOTH-PRD-002] X 层执行剥售价
app.use('/api/booth/em', requireAuth, emRoutes); // [Xfactory-B7] 补鉴权
app.use('/api/booth/market', marketRoutes);    // /api/booth/market/* (C3 Market 通货售卖)
app.use('/api/booth/job', requireAuth, jobRoutes);          // /api/booth/job/* (FAB-OPT-01 Job 模型) // [Xfactory-B7] 补鉴权
// BOOTH-PK-02: SupplyOrder 显式契约 (shop 下单→报价→追踪→签收闭环, 契约载体=booth_fulfillments 方案A)
app.use('/api/booth/supply-orders', requireAuth, supplyOrdersRouter);
app.use('/api/booth/deliveries', requireAuth, deliveriesRouter);
// [BOOTH-PRD-001] 契约地基: 生产单(幂等创建/四铺拆单挂接/G-007 三级状态联动/超期自动判定)
app.use('/api/booth/production-orders', requireAuth, productionRoutes);
app.use('/api/booth/crafts', requireAuth, craftsRoutes); // [BOOTH-PRD-003 / RD-004/005] 研发铺工艺管理
// [XFACTORY-P1] 组合 1/2: EMX 采购桩接 + EDX 交付回执 (执行线全量剥价, BDD-17/X-executor 红线)
app.use('/api/booth/emx', requireAuth, stripXExecutorPrices, emxRoutes);
app.use('/api/booth/edx', requireAuth, stripXExecutorPrices, edxRoutes);
app.use('/api/booth', requireAuth, pmMgmtRoutes); // [BOOTH-PRD-002] 供应铺/订单类型/RBAC

// Production: serve static files and SPA fallback
if (process.env.NODE_ENV === 'production') {
  let distPath = path.resolve(__dirname, '..', 'dist');
  if (!existsSync(distPath)) distPath = path.resolve(__dirname, '..');
  app.use(express.static(distPath));

  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// Global error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error: err.error || err.message || 'Internal server error',
    code: err.code || 'INTERNAL_ERROR',
    ...(err.shortages ? { shortages: err.shortages } : {}),
  });
});

// Start server
// [BOOTH-DEPLOY-01] 冷启动优化：listen 先行（健康探测首字节不再等迁移完成，规避平台阈值超时误判 Failed），
// 迁移/后台组件异步就绪；migrate 失败仍 fail-closed：FATAL + exit(1)（veFaaS 自动重启），业务语义不变。
async function start() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[booth-du-v4] Server running on http://0.0.0.0:${PORT}`);
  });
  try {
    await migrate();
    startOutboxPoller();
    startHeartbeat();
    console.log('[booth-du-v4] Background bootstrap ready (migrate + outbox poller + heartbeat)');
  } catch (err) {
    console.error('[booth-du-v4] Failed to start server (FATAL, fail-closed):', err);
    process.exit(1);
  }
}

start();
