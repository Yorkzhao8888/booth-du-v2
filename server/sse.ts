import type { Response } from 'express';

const clients = new Map<number, Set<Response>>();

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
