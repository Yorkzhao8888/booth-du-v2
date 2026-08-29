import React, { useState, useEffect, useCallback } from 'react';
import { Table, Card, Button, Tag, Space, Select, message, Statistic, Row, Col } from 'antd';
import { ReloadOutlined, ClockCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { api } from '../../api';
import { fmtQty } from '../../utils/format';

interface ExpiringBatch {
  id: number;
  sku_id: number;
  batch_no: string;
  qty: number;
  expiry_date: string;
  warehouse_type: string;
  sku_name: string;
  expiry_status: 'expired' | 'critical' | 'warning' | 'normal';
  days_remaining: number;
}

const statusConfig: Record<string, { text: string; color: string }> = {
  expired: { text: '已过期', color: 'error' },
  critical: { text: '即将过期(≤7天)', color: 'error' },
  warning: { text: '临期(≤30天)', color: 'warning' },
  normal: { text: '正常', color: 'success' },
};

const warehouseTypeLabels: Record<string, string> = {
  material: '原料仓',
  device: '设备仓',
  sundry: '杂品仓',
  plaza: '广场仓',
};

const ExpiryControl: React.FC = () => {
  const [data, setData] = useState<ExpiringBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState<number>(30);
  const [warehouseType, setWarehouseType] = useState<string>('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('days', String(days));
      if (warehouseType) params.set('warehouse_type', warehouseType);
      const res = await api.get<any>(`/du/supply/batches/expiring?${params.toString()}`);
      setData(res?.items || []);
    } catch {
      message.error('加载临期批次失败');
    } finally {
      setLoading(false);
    }
  }, [days, warehouseType]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const expiredCount = data.filter(b => b.expiry_status === 'expired').length;
  const criticalCount = data.filter(b => b.expiry_status === 'critical').length;
  const warningCount = data.filter(b => b.expiry_status === 'warning').length;

  const columns = [
    {
      title: 'SKU',
      dataIndex: 'sku_name',
      key: 'sku_name',
      width: 180,
    },
    {
      title: '批次号',
      dataIndex: 'batch_no',
      key: 'batch_no',
      width: 140,
    },
    {
      title: '仓库类型',
      dataIndex: 'warehouse_type',
      key: 'warehouse_type',
      width: 100,
      render: (v: string) => <Tag>{warehouseTypeLabels[v] || v}</Tag>,
    },
    {
      title: '库存数量',
      dataIndex: 'qty',
      key: 'qty',
      width: 100,
      align: 'right' as const,
      render: (v: number) => fmtQty(v),
    },
    {
      title: '到期日期',
      dataIndex: 'expiry_date',
      key: 'expiry_date',
      width: 120,
      render: (v: string) => new Date(v).toLocaleDateString('zh-CN'),
    },
    {
      title: '剩余天数',
      dataIndex: 'days_remaining',
      key: 'days_remaining',
      width: 100,
      align: 'right' as const,
      render: (v: number) => (
        <span style={{ color: v <= 0 ? '#ff4d4f' : v <= 7 ? '#ff7a45' : '#faad14', fontWeight: 600 }}>
          {v <= 0 ? '已过期' : `${v}天`}
        </span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'expiry_status',
      key: 'expiry_status',
      width: 140,
      render: (v: string) => {
        const cfg = statusConfig[v] || { text: v, color: 'default' };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card>
            <Statistic
              title="已过期批次"
              value={expiredCount}
              prefix={<WarningOutlined />}
              valueStyle={{ color: '#ff4d4f' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="即将过期(≤7天)"
              value={criticalCount}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: '#ff7a45' }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card>
            <Statistic
              title="临期(≤30天)"
              value={warningCount}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
      </Row>

      <Card
        title={
          <Space>
            <ClockCircleOutlined />
            <span>效期管控 / 临期预警</span>
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
            <Select
              style={{ width: 140 }}
              value={days}
              onChange={setDays}
              options={[
                { value: 7, label: '近7天' },
                { value: 14, label: '近14天' },
                { value: 30, label: '近30天' },
                { value: 60, label: '近60天' },
                { value: 90, label: '近90天' },
              ]}
            />
            <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
          </Space>
        }
      >
        <Table
          rowKey="id"
          columns={columns}
          dataSource={data}
          loading={loading}
          pagination={{ pageSize: 20 }}
          locale={{ emptyText: '暂无临期批次' }}
        />
      </Card>
    </div>
  );
};

export default ExpiryControl;
