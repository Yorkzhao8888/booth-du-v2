import { useEffect, useState, useRef } from 'react';
import { Card, Row, Col, Statistic, Progress, Tag } from 'antd';
import {
  ShoppingCartOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  ClockCircleOutlined,
  RiseOutlined,
} from '@ant-design/icons';
import { api } from '../../api';

interface DashboardData {
  orders: { today: number; pending: number; completed: number };
  inventory: { total: number; low: number; expiring: number };
  production: { inProgress: number; completed: number; yieldRate: number };
  delivery: { pending: number; inTransit: number; completed: number };
}

const WAREHOUSE_LABELS: Record<string, string> = {
  material: '原材料仓',
  device: '设备仓',
  sundry: '杂项仓',
  plaza: '门店仓',
};

export default function RealtimeDashboard() {
  const [data, setData] = useState<DashboardData>({
    orders: { today: 0, pending: 0, completed: 0 },
    inventory: { total: 0, low: 0, expiring: 0 },
    production: { inProgress: 0, completed: 0, yieldRate: 0 },
    delivery: { pending: 0, inTransit: 0, completed: 0 },
  });
  const [time, setTime] = useState(new Date());
  const [linkState, setLinkState] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const esRef = useRef<EventSource | null>(null);

  // Fetch initial data
  const fetchData = async () => {
    try {
      // Fetch orders stats
      const ordersRes = await api.get<any>('/du/dashboard');
      if (ordersRes) {
        setData((prev) => ({
          ...prev,
          orders: {
            today: ordersRes?.todayOrderCount || 0,
            pending: ordersRes?.pendingOrderCount || 0,
            completed: ordersRes?.todayFulfilledCount || 0,
          },
        }));
      }

      // Fetch inventory stats
      const inventoryRes = await api.get<any>('/du/inventory/alerts');
      if (inventoryRes) {
        const items = inventoryRes?.items || [];
        const lowCount = items.filter((i: any) => i.alert_type === 'low').length;
        const expiringCount = items.filter((i: any) => i.alert_type === 'expiring').length;
        setData((prev) => ({
          ...prev,
          inventory: {
            total: items.length,
            low: lowCount,
            expiring: expiringCount,
          },
        }));
      }

      // Fetch production stats
      const productionRes = await api.get<any>('/edxx/fab/dashboard');
      if (productionRes) {
        const orders = productionRes.orders || [];
        const inProgress = orders.filter((o: any) => o.status === 'in_progress').length;
        const completed = orders.filter((o: any) => o.status === 'completed').length;
        setData((prev) => ({
          ...prev,
          production: {
            ...prev.production,
            inProgress,
            completed,
          },
        }));
      }

      // Fetch delivery stats
      const deliveryRes = await api.get<any>('/du/dl/tasks?pageSize=100');
      if (deliveryRes) {
        const tasks = deliveryRes?.items || [];
        const pending = tasks.filter((t: any) => t.status === 'assigned' || t.status === 'accepted').length;
        const inTransit = tasks.filter((t: any) => t.status === 'delivering').length;
        const completed = tasks.filter((t: any) => t.status === 'delivered').length;
        setData((prev) => ({
          ...prev,
          delivery: { pending, inTransit, completed },
        }));
      }
    } catch (err) {
      console.error('Failed to fetch dashboard data:', err);
    }
  };

  // [UX-BOOST P1-c] 服务端为 SSE(/api/booth/stream)，原 WebSocket 连接必失败导致「连接断开」红标常驻。
  // 改用 EventSource + ?token=（sseTokenBridge 统一验签），token key 修正为 booth_token（原 'token' 恒空）。
  // 连接三态：connecting(蓝) / connected(绿) / reconnecting(红，仅在重连中显示)，红标不再常驻。
  useEffect(() => {
    setLinkState('connecting');
    const token = localStorage.getItem('booth_token') || '';
    const es = new EventSource(`/api/booth/stream?token=${encodeURIComponent(token)}`);
    esRef.current = es;
    es.onopen = () => setLinkState('connected');
    es.onmessage = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as { type?: string };
        if (['order.created', 'order.status_changed', 'inventory.changed', 'work_order.updated'].includes(data.type || '')) {
          fetchData();
        }
      } catch {
        // 忽略非 JSON 心跳帧
      }
    };
    es.onerror = () => {
      // EventSource 内建自动重连
      setLinkState((s) => (s === 'connected' ? 'reconnecting' : s));
    };
    return () => {
      es.close();
      esRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Periodic refresh (fallback)
  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 30000); // Refresh every 30s
    return () => clearInterval(timer);
  }, []);

  // Update time
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
      padding: 'clamp(12px, 3vw, 24px)',
      color: '#fff',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 'clamp(20px, 3.4vw, 32px)', fontWeight: 700, color: '#fff' }}>
          Xfactory-DU 实时运营大屏
        </h1>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 'clamp(16px, 2.4vw, 24px)', fontWeight: 600, color: '#1890ff', fontVariantNumeric: 'tabular-nums' }}>
            {time.toLocaleTimeString('zh-CN')}
          </div>
          <div style={{ fontSize: 14, color: '#999' }}>
            {time.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
          </div>
          <Tag color={linkState === 'connected' ? 'success' : linkState === 'connecting' ? 'processing' : 'error'} style={{ marginTop: 4 }}>
            {linkState === 'connected' ? '实时连接' : linkState === 'connecting' ? '连接中…' : '重连中…'}
          </Tag>
        </div>
      </div>

      {/* Main Stats */}
      <Row gutter={[16, 16]}>
        {/* Orders */}
        <Col xs={12} lg={6}>
          <Card
            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 16 }}
            styles={{ body: { padding: 24 } }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
              <ShoppingCartOutlined style={{ fontSize: 32, color: '#1890ff' }} />
              <span style={{ marginLeft: 12, fontSize: 18, fontWeight: 600 }}>订单</span>
            </div>
            <Statistic
              title={<span style={{ color: '#999' }}>今日订单</span>}
              value={data.orders.today}
              valueStyle={{ color: '#fff', fontSize: 'clamp(24px, 4.2vw, 36px)', fontVariantNumeric: 'tabular-nums' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <div>
                <div style={{ color: '#999', fontSize: 12 }}>待处理</div>
                <div style={{ color: '#faad14', fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{data.orders.pending}</div>
              </div>
              <div>
                <div style={{ color: '#999', fontSize: 12 }}>已完成</div>
                <div style={{ color: '#52c41a', fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{data.orders.completed}</div>
              </div>
            </div>
          </Card>
        </Col>

        {/* Inventory */}
        <Col xs={12} lg={6}>
          <Card
            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 16 }}
            styles={{ body: { padding: 24 } }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
              <ThunderboltOutlined style={{ fontSize: 32, color: '#722ed1' }} />
              <span style={{ marginLeft: 12, fontSize: 18, fontWeight: 600 }}>库存</span>
            </div>
            <Statistic
              title={<span style={{ color: '#999' }}>SKU 总数</span>}
              value={data.inventory.total}
              valueStyle={{ color: '#fff', fontSize: 'clamp(24px, 4.2vw, 36px)', fontVariantNumeric: 'tabular-nums' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <div>
                <div style={{ color: '#999', fontSize: 12 }}>缺货预警</div>
                <div style={{ color: '#ff4d4f', fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{data.inventory.low}</div>
              </div>
              <div>
                <div style={{ color: '#999', fontSize: 12 }}>临期预警</div>
                <div style={{ color: '#faad14', fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{data.inventory.expiring}</div>
              </div>
            </div>
          </Card>
        </Col>

        {/* Production */}
        <Col xs={12} lg={6}>
          <Card
            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 16 }}
            styles={{ body: { padding: 24 } }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
              <RiseOutlined style={{ fontSize: 32, color: '#52c41a' }} />
              <span style={{ marginLeft: 12, fontSize: 18, fontWeight: 600 }}>生产</span>
            </div>
            <Statistic
              title={<span style={{ color: '#999' }}>进行中工单</span>}
              value={data.production.inProgress}
              valueStyle={{ color: '#fff', fontSize: 'clamp(24px, 4.2vw, 36px)', fontVariantNumeric: 'tabular-nums' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <div>
                <div style={{ color: '#999', fontSize: 12 }}>已完成</div>
                <div style={{ color: '#52c41a', fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{data.production.completed}</div>
              </div>
              <div>
                <div style={{ color: '#999', fontSize: 12 }}>良品率</div>
                <div style={{ color: '#1890ff', fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{data.production.yieldRate}%</div>
              </div>
            </div>
          </Card>
        </Col>

        {/* Delivery */}
        <Col xs={12} lg={6}>
          <Card
            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 16 }}
            styles={{ body: { padding: 24 } }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
              <CheckCircleOutlined style={{ fontSize: 32, color: '#fa8c16' }} />
              <span style={{ marginLeft: 12, fontSize: 18, fontWeight: 600 }}>配送</span>
            </div>
            <Statistic
              title={<span style={{ color: '#999' }}>配送任务</span>}
              value={data.delivery.pending + data.delivery.inTransit}
              valueStyle={{ color: '#fff', fontSize: 'clamp(24px, 4.2vw, 36px)', fontVariantNumeric: 'tabular-nums' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <div>
                <div style={{ color: '#999', fontSize: 12 }}>待配送</div>
                <div style={{ color: '#faad14', fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{data.delivery.pending}</div>
              </div>
              <div>
                <div style={{ color: '#999', fontSize: 12 }}>配送中</div>
                <div style={{ color: '#1890ff', fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{data.delivery.inTransit}</div>
              </div>
            </div>
          </Card>
        </Col>
      </Row>

      {/* Second Row */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        {/* Warehouse Overview */}
        <Col xs={24} lg={12}>
          <Card
            title={<span style={{ color: '#fff', fontSize: 18 }}>四仓概览</span>}
            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 16 }}
            styles={{ header: { borderBottom: '1px solid rgba(255,255,255,0.1)' }, body: { padding: 24 } }}
          >
            <Row gutter={16}>
              {Object.entries(WAREHOUSE_LABELS).map(([key, label]) => (
                <Col xs={12} lg={6} key={key}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 14, color: '#999', marginBottom: 8 }}>{label}</div>
                    <Progress
                      type="circle"
                      percent={Math.floor(Math.random() * 40 + 60)} // Placeholder
                      size={80}
                      strokeColor="#1890ff"
                      format={(percent) => <span style={{ color: '#fff', fontSize: 16 }}>{percent}%</span>}
                    />
                  </div>
                </Col>
              ))}
            </Row>
          </Card>
        </Col>

        {/* Alerts */}
        <Col xs={24} lg={12}>
          <Card
            title={<span style={{ color: '#fff', fontSize: 18 }}><WarningOutlined /> 预警信息</span>}
            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 16 }}
            styles={{ header: { borderBottom: '1px solid rgba(255,255,255,0.1)' }, body: { padding: 24 } }}
          >
            <div style={{ maxHeight: 200, overflowY: 'auto' }}>
              {data.inventory.low > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <WarningOutlined style={{ color: '#ff4d4f', marginRight: 12 }} />
                  <span style={{ color: '#fff' }}>{data.inventory.low} 个 SKU 库存不足，请及时补货</span>
                </div>
              )}
              {data.inventory.expiring > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <ClockCircleOutlined style={{ color: '#faad14', marginRight: 12 }} />
                  <span style={{ color: '#fff' }}>{data.inventory.expiring} 个批次即将过期</span>
                </div>
              )}
              {data.orders.pending > 5 && (
                <div style={{ display: 'flex', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                  <ShoppingCartOutlined style={{ color: '#1890ff', marginRight: 12 }} />
                  <span style={{ color: '#fff' }}>{data.orders.pending} 个订单待处理</span>
                </div>
              )}
              {data.inventory.low === 0 && data.inventory.expiring === 0 && data.orders.pending <= 5 && (
                <div style={{ textAlign: 'center', color: '#52c41a', padding: 24 }}>
                  <CheckCircleOutlined style={{ fontSize: 32, marginBottom: 8 }} />
                  <div>一切正常，无预警信息</div>
                </div>
              )}
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  );
}
