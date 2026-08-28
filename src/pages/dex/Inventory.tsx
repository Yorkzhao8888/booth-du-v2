import React, { useEffect, useState, useCallback } from 'react';
import { Table, Typography, Tag, Button, Drawer, List, Select, Space } from 'antd';
import { apiGet } from '../../api';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

interface InventoryItem {
  id: number;
  skuCode: string;
  name: string;
  unit: string;
  quantity: number;
  safetyStock: number;
  isActive: boolean;
}

interface Txn {
  id: number;
  skuName: string;
  changeQty: number;
  type: string;
  createdAt: string;
  note?: string;
}

const ExInventory: React.FC = () => {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [txnLoading, setTxnLoading] = useState(false);
  const [currentSku, setCurrentSku] = useState<InventoryItem | null>(null);
  const [txnTypeFilter, setTxnTypeFilter] = useState<string>('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<InventoryItem[]>('/dex/inventory');
      setItems(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const handler = () => fetchData();
    window.addEventListener('booth:refresh', handler);
    return () => window.removeEventListener('booth:refresh', handler);
  }, [fetchData]);

  const viewTxns = async (record: InventoryItem) => {
    setCurrentSku(record);
    setDrawerOpen(true);
    setTxnLoading(true);
    try {
      const query = txnTypeFilter ? `?skuId=${record.id}&type=${txnTypeFilter}` : `?skuId=${record.id}`;
      const res = await apiGet<Txn[]>(`/dex/inventory/txns${query}`);
      setTxns(res);
    } catch {
      setTxns([]);
    } finally {
      setTxnLoading(false);
    }
  };

  useEffect(() => {
    if (currentSku && drawerOpen) {
      viewTxns(currentSku);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txnTypeFilter]);

  const txnTypeLabels: Record<string, string> = {
    inbound: '入库',
    outbound: '出库',
    consume: '领料',
    adjust: '调整',
  };

  const columns: ColumnsType<InventoryItem> = [
    { title: 'SKU', dataIndex: 'skuCode', key: 'skuCode', width: 140 },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '单位', dataIndex: 'unit', key: 'unit', width: 80 },
    {
      title: '库存数量',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 120,
      render: (qty: number, record) => (
        <span style={{ color: qty <= record.safetyStock ? '#ff4d4f' : undefined, fontWeight: qty <= record.safetyStock ? 600 : 400 }}>
          {qty}
        </span>
      ),
    },
    { title: '安全库存', dataIndex: 'safetyStock', key: 'safetyStock', width: 100 },
    {
      title: '状态',
      key: 'status',
      width: 100,
      render: (_, record) =>
        record.quantity <= record.safetyStock ? (
          <Tag color="red">低库存</Tag>
        ) : (
          <Tag color="green">正常</Tag>
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_, record) => (
        <Button type="link" size="small" onClick={() => viewTxns(record)}>
          查看流水
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>库存管理</Title>
      <Table
        columns={columns}
        dataSource={items}
        rowKey="id"
        loading={loading}
        scroll={{ x: 800 }}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
      />

      <Drawer
        title={`库存流水 - ${currentSku?.name || ''}`}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        width={480}
      >
        <Space style={{ marginBottom: 16 }}>
          <span>类型:</span>
          <Select
            allowClear
            placeholder="全部类型"
            style={{ width: 140 }}
            value={txnTypeFilter || undefined}
            onChange={(v) => setTxnTypeFilter(v || '')}
            options={[
              { label: '入库', value: 'inbound' },
              { label: '出库', value: 'outbound' },
              { label: '领料', value: 'consume' },
              { label: '调整', value: 'adjust' },
            ]}
          />
        </Space>
        <List
          loading={txnLoading}
          dataSource={txns}
          locale={{ emptyText: '暂无流水记录' }}
          renderItem={(txn) => (
            <List.Item>
              <List.Item.Meta
                title={
                  <span>
                    <Text type={txn.changeQty > 0 ? 'success' : 'danger'} strong>
                      {txn.changeQty > 0 ? '+' : ''}{txn.changeQty}
                    </Text>
                    <Tag style={{ marginLeft: 8 }}>{txnTypeLabels[txn.type] || txn.type}</Tag>
                  </span>
                }
                description={dayjs(txn.createdAt).format('YYYY-MM-DD HH:mm:ss')}
              />
            </List.Item>
          )}
        />
      </Drawer>
    </div>
  );
};

export default ExInventory;
