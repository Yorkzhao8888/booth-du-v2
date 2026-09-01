import type { Response } from 'express';

const clients = new Map<number, Set<Response>>();

// Track which work orders have already had SLA alerts sent (avoid duplicates)
const slaAlerted = new Set<string>(); // key: `${orgId}:${workOrderId}:${level}`

export function addClient(orgId: number, res: Response) {
  if (!clients.has(orgId)) {
    clients.set(orgId, new Set());
  }
  clients.get(orgId)!.add(res);
}

export function removeClient(orgId: number, res: Response) {
  const set = clients.get(orgId);
  if (set) {
    set.delete(res);
    if (set.size === 0) {
      clients.delete(orgId);
    }
  }
}

export function broadcast(orgId: number, event: string, data: any) {
  const set = clients.get(orgId);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
      // client may have disconnected
    }
  }
}

/**
 * Check SLA for a list of work orders / fulfillments and broadcast alerts for newly due_soon/overdue items.
 * Items must have: id, status, created_at, org_id (or orgId), and optionally fulfillment_id.
 */
export function checkAndBroadcastSlaAlerts(orgId: number, items: any[]) {
  const now = Date.now();
  for (const item of items) {
    if (['completed', 'cancelled'].includes(item.status)) continue;
    const deadline = new Date(item.created_at).getTime() + 24 * 60 * 60 * 1000;
    const minutesToDue = Math.round((deadline - now) / 60000);
    let level: string | null = null;
    if (minutesToDue <= 0) level = 'overdue';
    else if (minutesToDue <= 120) level = 'due_soon';
    if (!level) continue;

    const key = `${orgId}:${item.id}:${level}`;
    if (slaAlerted.has(key)) continue;
    slaAlerted.add(key);

    broadcast(orgId, 'sla_alert', {
      level,
      workOrderId: item.id,
      fulfillmentId: item.fulfillment_id || null,
      minutesToDue,
    });

    // FAB-MES-03 联动：SLA 超时自动落 overdue 安灯（防重逻辑在 handler 内）
    if (level === 'overdue' && autoAndonHandler) {
      try {
        autoAndonHandler(orgId, item);
      } catch {
        // 安灯联动失败不影响 SLA 广播主链路
      }
    }
  }
}

// 安灯服务注册的自动处理器（晚绑定避免循环依赖）
let autoAndonHandler: ((orgId: number, item: Record<string, unknown>) => void | Promise<void>) | null = null;
export function setAutoAndonHandler(fn: (orgId: number, item: Record<string, unknown>) => void | Promise<void>) {
  autoAndonHandler = fn;
}

export function startHeartbeat() {
  setInterval(() => {
    for (const [orgId, set] of clients) {
      for (const res of set) {
        try {
          res.write(': heartbeat\n\n');
        } catch {
          removeClient(orgId, res);
        }
      }
    }
  }, 30000);
}
