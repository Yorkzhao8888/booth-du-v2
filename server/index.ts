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
import duRoutes from './routes/du.js';
import dexRoutes from './routes/dex.js';
import dexxRoutes from './routes/dexx.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 5001;

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
app.use('/api/booth/du', duRoutes);
app.use('/api/booth/dex', dexRoutes);
app.use('/api/booth/dexx', dexxRoutes);

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
