import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Space, Tag, Tooltip, Typography } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExportOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';

/**
 * [BOOTH-CONN-01 工单 4] 全链路履约时间线
 * 数据源: GET /api/booth/fulfillment/timeline (契约单 v1.1 状态回写通道落库) + SSE /api/booth/fulfillment/stream 实时事件
 * 渲染: Market 下单 → 供给铺接单(Booth-E) → DU 履约 → 交付确认; 节点含时间/状态/操作方(容器号脱敏)
 */

export interface TimelineNode {
  eventId: string;
  orderNo: string;
  state: string;
  operator: string;
  containerMask: string;
  at: string;
  realtime?: boolean;
}

const STATE_META: Record<string, { label: string; color: string }> = {
  'order.placed': { label: 'Market 下单', color: 'orange' },
  'supply.accepted': { label: '供给铺接单', color: 'cyan' },
  'fulfillment.preparing': { label: '履约备货', color: 'geekblue' },
  'fulfillment.shipped': { label: '履约发货', color: 'purple' },
  'fulfillment.delivered': { label: '交付确认', color: 'green' },
  'order.cancelled': { label: '订单取消', color: 'red' },
};

const MAX_NODES = 12;

export const FulfillmentTimeline: React.FC<{
  title?: string;
  maxNodes?: number;
  /** enterprise=经营者视角 personal=客户视角 */
  variant?: 'enterprise' | 'personal';
}> = ({ title = '全链路履约时间线', maxNodes = MAX_NODES }) => {
  const [nodes, setNodes] = useState<TimelineNode[]>([]);
  const [connected, setConnected] = useState<'connecting' | 'live' | 'retry'>('connecting');
  const esRef = useRef<EventSource | null>(null);

  const token = useMemo(() => localStorage.getItem('booth_token') || 'dev-open', []);

  // 初始: 契约回写通道落库的历史节点
  useEffect(() => {
    let alive = true;
    fetch('/api/booth/fulfillment/timeline', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((d) => {
        const list = d?.data?.nodes;
        if (alive && Array.isArray(list)) setNodes(list as TimelineNode[]);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [token]);

  // SSE 实时推送 (EventSource 断线浏览器自动重连; token 走 query 以兼容 EventSource 无法自定义 header)
  useEffect(() => {
    const es = new EventSource(`/api/booth/fulfillment/stream?token=${encodeURIComponent(token)}`);
    esRef.current = es;
    es.onopen = () => setConnected('live');
    es.onerror = () => setConnected('retry');
    es.onmessage = (ev) => {
      if (ev.data === 'ping' || ev.data === ': ping') return;
      try {
        const node = JSON.parse(ev.data) as TimelineNode;
        if (!node?.eventId) return;
        setNodes((prev) => {
          if (prev.some((n) => n.eventId === node.eventId)) return prev;
          return [{ ...node, realtime: true }, ...prev].slice(0, maxNodes);
        });
      } catch {
        // 心跳/注释帧忽略
      }
    };
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [token, maxNodes]);

  const connTag =
    connected === 'live' ? (
      <Tag color="success" icon={<ThunderboltOutlined />} style={{ marginRight: 0 }}>
        实时已连接
      </Tag>
    ) : connected === 'retry' ? (
      <Tag color="warning" style={{ marginRight: 0 }}>
        重连中
      </Tag>
    ) : (
      <Tag color="default" icon={<ClockCircleOutlined />} style={{ marginRight: 0 }}>
        连接中
      </Tag>
    );

  return (
    <Card
      size="small"
      style={{ borderRadius: 14 }}
      title={
        <Space size={8}>
          <span style={{ fontWeight: 700 }}>{title}</span>
          {connTag}
        </Space>
      }
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
          Market 下单 → 供给铺接单 → DU 履约 → 交付确认
        </Typography.Text>
      }
    >
      {nodes.length === 0 ? (
        <div style={{ color: '#999', fontSize: 13, padding: '14px 2px', textAlign: 'center' }}>
          暂无履约事件 · 下单/履约状态变化将实时推送至此 (15s 心跳保活)
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {nodes.slice(0, maxNodes).map((n) => {
            const meta = STATE_META[n.state] || { label: n.state, color: 'default' };
            return (
              <div
                key={n.eventId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  background: n.realtime ? 'rgba(82,196,26,0.06)' : '#fafafa',
                  border: n.realtime ? '1px solid rgba(82,196,26,0.35)' : '1px solid transparent',
                  borderRadius: 10,
                  padding: '8px 12px',
                }}
              >
                <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 16 }} />
                <Tag color={meta.color} style={{ marginRight: 0 }}>
                  {meta.label}
                </Tag>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{n.orderNo}</span>
                <span style={{ flex: 1, minWidth: 0 }} />
                <Tooltip title={`操作方: ${n.operator}`}>
                  <Tag style={{ marginRight: 0, fontFamily: 'monospace', fontSize: 11 }}>
                    {n.containerMask}
                  </Tag>
                </Tooltip>
                <span style={{ color: '#999', fontSize: 12, whiteSpace: 'nowrap' }}>
                  {formatAt(n.at)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
};

function formatAt(at: string): string {
  try {
    return new Date(at).toLocaleTimeString('zh-CN', { hour12: false });
  } catch {
    return at;
  }
}

export const MarketNewWindowButton: React.FC<{ url: string }> = ({ url }) => (
  <Button
    size="small"
    icon={<ExportOutlined />}
    onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
  >
    新窗口打开
  </Button>
);
