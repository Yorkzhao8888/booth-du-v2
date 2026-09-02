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
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

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
      const productionRes = await api.get<any>('/exx/fab/dashboard');
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

  // WebSocket connection for real-time updates
  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/booth/stream`;

    const connect = () => {
      const token = localStorage.getItem('token') || '';
      const ws = new WebSocket(`${wsUrl}?token=${token}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsConnected(true);
        console.log('WebSocket connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Refresh data on relevant events
          if (['order.created', 'order.status_changed', 'inventory.changed', 'work_order.updated'].includes(data.type)) {
            fetchData();
          }
        } catch (err) {
          console.error('WebSocket message parse error:', err);
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        console.log('WebSocket disconnected, reconnecting in 5s...');
        setTimeout(connect, 5000);
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        ws.close();
      };
    };

    connect();

    return () => {
      wsRef.current?.close();
    };
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
      padding: 24,
      color: '#fff',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <h1 style={{ margin: 0, fontSize: 32, fontWeight: 700, color: '#fff' }}>
          Booth-DU 实时运营大屏
        </h1>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 24, fontWeight: 600, color: '#1890ff' }}>
            {time.toLocaleTimeString('zh-CN')}
          </div>
          <div style={{ fontSize: 14, color: '#999' }}>
            {time.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
          </div>
          <Tag color={wsConnected ? 'success' : 'error'} style={{ marginTop: 4 }}>
            {wsConnected ? '实时连接' : '连接断开'}
          </Tag>
        </div>
      </div>

      {/* Main Stats */}
      <Row gutter={[24, 24]}>
        {/* Orders */}
        <Col span={6}>
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
              valueStyle={{ color: '#fff', fontSize: 36 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <div>
                <div style={{ color: '#999', fontSize: 12 }}>待处理</div>
                <div style={{ color: '#faad14', fontSize: 20, fontWeight: 600 }}>{data.orders.pending}</div>
              </div>
              <div>
                <div style={{ color: '#999', fontSize: 12 }}>已完成</div>
                <div style={{ color: '#52c41a', fontSize: 20, fontWeight: 600 }}>{data.orders.completed}</div>
              </div>
            </div>
          </Card>
        </Col>

        {/* Inventory */}
        <Col span={6}>
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
              valueStyle={{ color: '#fff', fontSize: 36 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <div>
                <div style={{ color: '#999', fontSize: 12 }}>缺货预警</div>
                <div style={{ color: '#ff4d4f', fontSize: 20, fontWeight: 600 }}>{data.inventory.low}</div>
              </div>
              <div>
                <div style={{ color: '#999', fontSize: 12 }}>临期预警</div>
                <div style={{ color: '#faad14', fontSize: 20, fontWeight: 600 }}>{data.inventory.expiring}</div>
              </div>
            </div>
          </Card>
        </Col>

        {/* Production */}
        <Col span={6}>
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
              valueStyle={{ color: '#fff', fontSize: 36 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <div>
                <div style={{ color: '#999', fontSize: 12 }}>已完成</div>
                <div style={{ color: '#52c41a', fontSize: 20, fontWeight: 600 }}>{data.production.completed}</div>
              </div>
              <div>
                <div style={{ color: '#999', fontSize: 12 }}>良品率</div>
                <div style={{ color: '#1890ff', fontSize: 20, fontWeight: 600 }}>{data.production.yieldRate}%</div>
              </div>
            </div>
          </Card>
        </Col>

        {/* Delivery */}
        <Col span={6}>
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
              valueStyle={{ color: '#fff', fontSize: 36 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
              <div>
                <div style={{ color: '#999', fontSize: 12 }}>待配送</div>
                <div style={{ color: '#faad14', fontSize: 20, fontWeight: 600 }}>{data.delivery.pending}</div>
              </div>
              <div>
                <div style={{ color: '#999', fontSize: 12 }}>配送中</div>
                <div style={{ color: '#1890ff', fontSize: 20, fontWeight: 600 }}>{data.delivery.inTransit}</div>
              </div>
            </div>
          </Card>
        </Col>
      </Row>

      {/* Second Row */}
      <Row gutter={[24, 24]} style={{ marginTop: 24 }}>
        {/* Warehouse Overview */}
        <Col span={12}>
          <Card
            title={<span style={{ color: '#fff', fontSize: 18 }}>四仓概览</span>}
            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 16 }}
            styles={{ header: { borderBottom: '1px solid rgba(255,255,255,0.1)' }, body: { padding: 24 } }}
          >
            <Row gutter={16}>
              {Object.entries(WAREHOUSE_LABELS).map(([key, label]) => (
                <Col span={6} key={key}>
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
        <Col span={12}>
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
