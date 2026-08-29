import React, { useState, useEffect, useCallback } from 'react';
import { Table, Card, Button, Tag, Space, Select, message, Tabs, Statistic, Row, Col } from 'antd';
import { ReloadOutlined, WarningOutlined, AlertOutlined, StopOutlined } from '@ant-design/icons';
import { api } from '../../api';
import { fmtQty } from '../../utils/format';

interface InventoryAlert {
  inventory_id: number;
  sku_id: number;
  qty_on_hand: number;
  warehouse_type: string;
  sku_name: string;
  safety_stock: number | null;
  alert_type: 'stockout' | 'stagnant';
}

const warehouseTypeLabels: Record<string, string> = {
  material: '原料仓',
  device: '设备仓',
  sundry: '杂品仓',
  plaza: '广场仓',
};

const InventoryAlerts: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'stockout' | 'stagnant'>('stockout');
  const [data, setData] = useState<InventoryAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [warehouseType, setWarehouseType] = useState<string>('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('type', activeTab);
      if (warehouseType) params.set('warehouse_type', warehouseType);
      if (activeTab === 'stagnant') params.set('stagnant_days', '30');
      const res = await api.get<any>(`/du/supply/inventory/alerts?${params.toString()}`);
      setData(res?.items || []);
    } catch {
      message.error('加载库存预警失败');
    } finally {
      setLoading(false);
    }
  }, [activeTab, warehouseType]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const stockoutCount = data.filter(i => i.alert_type === 'stockout').length;

  const columns = [
    {
      title: 'SKU',
      dataIndex: 'sku_name',
      key: 'sku_name',
      width: 200,
    },
    {
      title: '仓库类型',
      dataIndex: 'warehouse_type',
      key: 'warehouse_type',
      width: 100,
      render: (v: string) => <Tag>{warehouseTypeLabels[v] || v}</Tag>,
    },
    {
      title: '当前库存',
      dataIndex: 'qty_on_hand',
      key: 'qty_on_hand',
      width: 120,
      align: 'right' as const,
      render: (v: number) => (
        <span style={{ color: v === 0 ? '#ff4d4f' : v < 10 ? '#faad14' : undefined, fontWeight: 600 }}>
          {fmtQty(v)}
        </span>
      ),
    },
    {
      title: '安全库存',
      dataIndex: 'safety_stock',
      key: 'safety_stock',
      width: 120,
      align: 'right' as const,
      render: (v: number | null) => v != null ? fmtQty(v) : '-',
    },
    {
      title: '预警类型',
      dataIndex: 'alert_type',
      key: 'alert_type',
      width: 120,
      render: (v: string) => {
        if (v === 'stockout') return <Tag color="error">缺货</Tag>;
        return <Tag color="warning">呆滞</Tag>;
      },
    },
    {
      title: '建议',
      key: 'suggestion',
      width: 200,
      render: (_: unknown, record: InventoryAlert) => {
        if (record.alert_type === 'stockout') {
          return <span style={{ color: '#1677ff' }}>建议立即补货</span>;
        }
        return <span style={{ color: '#faad14' }}>建议促销消化</span>;
      },
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={12}>
          <Card>
            <Statistic
              title="缺货SKU数"
              value={stockoutCount}
              prefix={<AlertOutlined />}
              valueStyle={{ color: '#ff4d4f' }}
            />
          </Card>
        </Col>
        <Col span={12}>
          <Card>
            <Statistic
              title="呆滞SKU数"
              value={data.filter(i => i.alert_type === 'stagnant').length}
              prefix={<StopOutlined />}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
      </Row>

      <Card
        title={
          <Space>
            <WarningOutlined />
            <span>库存预警</span>
          </Space>
        }
        extra={
          <Space>
            <Select
              style={{ width: 140 }}
              placeholder="仓库类型"
              allowClear
              value={warehouseType || undefined}
              onChange={v => setWarehouseType(v || '')}
              options={[
                { value: 'material', label: '原料仓' },
                { value: 'device', label: '设备仓' },
                { value: 'sundry', label: '杂品仓' },
                { value: 'plaza', label: '广场仓' },
              ]}
            />
            <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
          </Space>
        }
      >
        <Tabs
          activeKey={activeTab}
          onChange={key => setActiveTab(key as 'stockout' | 'stagnant')}
          items={[
            {
              key: 'stockout',
              label: `缺货预警 (${data.filter(i => i.alert_type === 'stockout').length})`,
              children: (
                <Table
                  rowKey="inventory_id"
                  columns={columns}
                  dataSource={data.filter(i => i.alert_type === 'stockout')}
                  loading={loading}
                  pagination={{ pageSize: 20 }}
                  locale={{ emptyText: '暂无缺货预警' }}
                />
              ),
            },
            {
              key: 'stagnant',
              label: `呆滞预警 (${data.filter(i => i.alert_type === 'stagnant').length})`,
              children: (
                <Table
                  rowKey="inventory_id"
                  columns={columns}
                  dataSource={data.filter(i => i.alert_type === 'stagnant')}
                  loading={loading}
                  pagination={{ pageSize: 20 }}
                  locale={{ emptyText: '暂无呆滞预警' }}
                />
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
};

export default InventoryAlerts;
