import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { migrate } from './migrate.js';
import { startOutboxPoller } from './services/outbox-service.js';
import { addClient, removeClient, startHeartbeat } from './sse.js';
import { requireAuth } from './auth.js';
import type { JwtPayload } from './auth.js';

import authRoutes from './routes/auth.js';
import internalRoutes from './routes/internal.js';
import { aliasRouter as internalAliasRoutes } from './routes/internal.js'; // [BOOTH-LINK-01] 根级别名 router (Shop XBUS 直调 /events/*)
import duRoutes from './routes/du/index.js';   // /api/booth/du 聚合入口 (TECH-DEBT-4)
import exRoutes from './routes/ex.js';
import exxRoutes from './routes/exx.js';
import exModulesRoutes from './routes/ex-modules.js';
import exxModulesRoutes from './routes/exx-modules.js';
import emRoutes from './routes/em.js';
import marketRoutes from './routes/market.js';
import jobRoutes from './routes/job.js';
import { supplyOrdersRouter, deliveriesRouter } from './routes/supply-order.js'; // BOOTH-PK-02 SupplyOrder 显式契约

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.DEPLOY_RUN_PORT || process.env.PORT) || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/api/booth/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

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

// Mount routes
app.use('/api/booth/auth', authRoutes);
app.use('/api/booth/internal', internalRoutes);
app.use('/events', internalAliasRoutes);         // [BOOTH-LINK-01] 根级别名: Shop XBUS 直调 /events/order-confirmed (与 /api/booth/internal/events 等价)
// /api/booth/du 聚合挂载: suppliers(前置)/核心看板/purchase-orders/dl+svc+profit+wh+fabqc/supply
// (TECH-DEBT-4: 原 5 个分散挂载点收敛进 routes/du/index.ts, 挂载顺序不变)
app.use('/api/booth/du', duRoutes);
app.use('/api/booth/ex', exRoutes);
// FIX3: modules 前置(带独立 requireAuth) — exx.ts 的 router.use(requireRole('exx'))
// 会全局拦截同前缀请求, du/dx/dex 的产线只读 GET 需先经 exx-modules 的 requireFabRead 放行
app.use('/api/booth/exx', requireAuth, exxModulesRoutes); // /api/booth/exx/fab/*, /wh/*, /dl/*, /svc/*
// New module routes
app.use('/api/booth/ex', exModulesRoutes);  // /api/booth/ex/dl/*, /svc/*, /wh/*, /fab/*, /inventory/alerts
app.use('/api/booth/exx', exxRoutes);
app.use('/api/booth/em', emRoutes);
app.use('/api/booth/market', marketRoutes);    // /api/booth/market/* (C3 Market 通货售卖)
app.use('/api/booth/job', jobRoutes);          // /api/booth/job/* (FAB-OPT-01 Job 模型)
// BOOTH-PK-02: SupplyOrder 显式契约 (shop 下单→报价→追踪→签收闭环, 契约载体=booth_fulfillments 方案A)
app.use('/api/booth/supply-orders', requireAuth, supplyOrdersRouter);
app.use('/api/booth/deliveries', requireAuth, deliveriesRouter);

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
async function start() {
  try {
    await migrate();
    startOutboxPoller();
    startHeartbeat();

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[booth-du-v4] Server running on http://0.0.0.0:${PORT}`);
    });
  } catch (err) {
    console.error('[booth-du-v4] Failed to start server:', err);
    process.exit(1);
  }
}

start();
