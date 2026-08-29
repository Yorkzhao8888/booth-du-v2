import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Tabs, Spin, Alert } from 'antd';
import {
  HomeOutlined,
  ToolOutlined,
  ShoppingOutlined,
  EnvironmentOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
} from '@ant-design/icons';
import { api } from '../../api';

interface WarehouseStats {
  warehouse_type: string;
  sku_count: number;
  total_qty: number;
  location_count: number;
}

interface TrendData {
  date: string;
  inbound: number;
  outbound: number;
}

const warehouseLabels: Record<string, string> = {
  material: '物料仓',
  device: '设备仓',
  sundry: '杂货仓',
  plaza: '场地仓',
};

const warehouseIcons: Record<string, React.ReactNode> = {
  material: <ShoppingOutlined style={{ fontSize: 32, color: '#1890ff' }} />,
  device: <ToolOutlined style={{ fontSize: 32, color: '#52c41a' }} />,
  sundry: <ShoppingOutlined style={{ fontSize: 32, color: '#faad14' }} />,
  plaza: <EnvironmentOutlined style={{ fontSize: 32, color: '#722ed1' }} />,
};

// Mock trend data for demonstration
const generateMockTrend = (): TrendData[] => {
  const data: TrendData[] = [];
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    data.push({
      date: date.toISOString().split('T')[0],
      inbound: Math.floor(Math.random() * 100) + 20,
      outbound: Math.floor(Math.random() * 80) + 10,
    });
  }
  return data;
};

const WarehouseDashboard: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<WarehouseStats[]>([]);
  const [trendData, setTrendData] = useState<Record<string, TrendData[]>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch inventory stats grouped by warehouse_type
      const [inventoryRes] = await Promise.all([
        api.get<any>('/du/inventory'),
      ]);

      const items = inventoryRes?.items || [];
      const warehouseMap: Record<string, WarehouseStats> = {
        material: { warehouse_type: 'material', sku_count: 0, total_qty: 0, location_count: 0 },
        device: { warehouse_type: 'device', sku_count: 0, total_qty: 0, location_count: 0 },
        sundry: { warehouse_type: 'sundry', sku_count: 0, total_qty: 0, location_count: 0 },
        plaza: { warehouse_type: 'plaza', sku_count: 0, total_qty: 0, location_count: 0 },
      };

      for (const item of items) {
        const wt = item.warehouse_type || 'material';
        if (warehouseMap[wt]) {
          warehouseMap[wt].sku_count++;
          warehouseMap[wt].total_qty += Number(item.qty_on_hand) || 0;
          if (item.location) warehouseMap[wt].location_count++;
        }
      }

      setStats(Object.values(warehouseMap));

      // Generate mock trend data for each warehouse
      const trends: Record<string, TrendData[]> = {};
      for (const wt of ['material', 'device', 'sundry', 'plaza']) {
        trends[wt] = generateMockTrend();
      }
      setTrendData(trends);
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  if (error) {
    return <Alert type="error" message="加载失败" description={error} />;
  }

  const tabItems = stats.map((stat) => ({
    key: stat.warehouse_type,
    label: (
      <span>
        {warehouseIcons[stat.warehouse_type]}
        <span style={{ marginLeft: 8 }}>{warehouseLabels[stat.warehouse_type]}</span>
      </span>
    ),
    children: (
      <div>
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={6}>
            <Card>
              <Statistic
                title="SKU 数量"
                value={stat.sku_count}
                prefix={<ShoppingOutlined />}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="库存总量"
                value={stat.total_qty}
                precision={2}
                prefix={<HomeOutlined />}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="库位数量"
                value={stat.location_count}
                prefix={<EnvironmentOutlined />}
              />
            </Card>
          </Col>
          <Col span={6}>
            <Card>
              <Statistic
                title="库位占用率"
                value={stat.location_count > 0 ? Math.min(100, (stat.sku_count / stat.location_count) * 100) : 0}
                precision={1}
                suffix="%"
              />
            </Card>
          </Col>
        </Row>

        <Card title="近 7 日出入库流转趋势" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'flex-end', height: 200 }}>
            {(trendData[stat.warehouse_type] || []).map((d, i) => (
              <div key={i} style={{ textAlign: 'center', flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 4, marginBottom: 8 }}>
                  <div
                    style={{
                      width: 20,
                      height: Math.max(10, d.inbound * 1.5),
                      background: '#52c41a',
                      borderRadius: 4,
                    }}
                    title={`入库: ${d.inbound}`}
                  />
                  <div
                    style={{
                      width: 20,
                      height: Math.max(10, d.outbound * 1.5),
                      background: '#faad14',
                      borderRadius: 4,
                    }}
                    title={`出库: ${d.outbound}`}
                  />
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>{d.date.slice(5)}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <span style={{ marginRight: 16 }}>
              <span style={{ display: 'inline-block', width: 12, height: 12, background: '#52c41a', borderRadius: 2, marginRight: 4 }} />
              入库
            </span>
            <span>
              <span style={{ display: 'inline-block', width: 12, height: 12, background: '#faad14', borderRadius: 2, marginRight: 4 }} />
              出库
            </span>
          </div>
        </Card>
      </div>
    ),
  }));

  return (
    <div>
      <h2>四仓看板</h2>
      <Tabs items={tabItems} defaultActiveKey="material" />
    </div>
  );
};

export default WarehouseDashboard;
