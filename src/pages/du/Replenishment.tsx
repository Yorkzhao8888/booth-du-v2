import React, { useState, useEffect, useCallback } from 'react';
import { Table, Card, Button, Tag, Space, Select, message, Modal, InputNumber, Popconfirm } from 'antd';
import { ReloadOutlined, ShoppingCartOutlined, AlertOutlined } from '@ant-design/icons';
import { api } from '../../api';
import { fmtMoney, fmtQty } from '../../utils/format';

interface ReplenishItem {
  inventory_id: number;
  sku_id: number;
  qty_on_hand: number;
  warehouse_type: string;
  sku_name: string;
  safety_stock: number | null;
  safety_stock_value: number;
  suggested_qty: number;
}

const warehouseTypeLabels: Record<string, string> = {
  material: '原料仓',
  device: '设备仓',
  sundry: '杂品仓',
  plaza: '广场仓',
};

const Replenishment: React.FC = () => {
  const [data, setData] = useState<ReplenishItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [warehouseType, setWarehouseType] = useState<string>('');
  const [selectedRows, setSelectedRows] = useState<ReplenishItem[]>([]);
  const [poModalVisible, setPoModalVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (warehouseType) params.set('warehouse_type', warehouseType);
      const res = await api.get<any>(`/du/supply/replenish/suggestions?${params.toString()}`);
      setData(res?.items || []);
    } catch {
      message.error('加载补货建议失败');
    } finally {
      setLoading(false);
    }
  }, [warehouseType]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleGeneratePO = async () => {
    if (selectedRows.length === 0) {
      message.warning('请先选择需要补货的SKU');
      return;
    }
    setPoModalVisible(true);
  };

  const handleSubmitPO = async () => {
    setSubmitting(true);
    try {
      const items = selectedRows.map(row => ({
        skuId: row.sku_id,
        skuName: row.sku_name,
        qty: row.suggested_qty,
        unitCost: 0,
      }));
      await api.post('/du/supply/replenish/to-po', { items });
      message.success('采购单已生成');
      setPoModalVisible(false);
      setSelectedRows([]);
      fetchData();
    } catch {
      message.error('生成采购单失败');
    } finally {
      setSubmitting(false);
    }
  };

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
      render: (v: number) => <span style={{ color: v === 0 ? '#ff4d4f' : '#faad14' }}>{fmtQty(v)}</span>,
    },
    {
      title: '安全库存',
      dataIndex: 'safety_stock_value',
      key: 'safety_stock_value',
      width: 120,
      align: 'right' as const,
      render: (v: number) => fmtQty(v),
    },
    {
      title: '建议补货量',
      dataIndex: 'suggested_qty',
      key: 'suggested_qty',
      width: 120,
      align: 'right' as const,
      render: (v: number) => <span style={{ color: '#1677ff', fontWeight: 600 }}>{fmtQty(v)}</span>,
    },
    {
      title: '缺货程度',
      key: 'severity',
      width: 100,
      render: (_: unknown, record: ReplenishItem) => {
        const ratio = record.qty_on_hand / Math.max(record.safety_stock_value, 1);
        if (ratio === 0) return <Tag color="error">断货</Tag>;
        if (ratio < 0.3) return <Tag color="warning">严重</Tag>;
        return <Tag color="processing">偏低</Tag>;
      },
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card
        title={
          <Space>
            <AlertOutlined />
            <span>智能补货建议</span>
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
            <Popconfirm
              title={`确认将 ${selectedRows.length} 个SKU转为采购单？`}
              onConfirm={handleSubmitPO}
              okText="确认"
              cancelText="取消"
              open={poModalVisible}
              onOpenChange={setPoModalVisible}
            >
              <Button
                type="primary"
                icon={<ShoppingCartOutlined />}
                disabled={selectedRows.length === 0}
                loading={submitting}
                onClick={handleGeneratePO}
              >
                一键生成采购单 ({selectedRows.length})
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        <Table
          rowKey="inventory_id"
          columns={columns}
          dataSource={data}
          loading={loading}
          pagination={{ pageSize: 20 }}
          rowSelection={{
            selectedRowKeys: selectedRows.map(r => r.inventory_id),
            onChange: (_, rows) => setSelectedRows(rows),
          }}
          locale={{ emptyText: '暂无补货建议，库存水位正常' }}
        />
      </Card>
    </div>
  );
};

export default Replenishment;
