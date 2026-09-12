import React, { useEffect, useState, useCallback } from 'react';
import { Table, Typography, Tag } from 'antd';
import { apiGet } from '../../api';
import PageState from '../../components/PageState';
import { TABLE_PROPS } from '../../constants/table';
import PriceText from '../../components/PriceText';
import type { ColumnsType } from 'antd/es/table';

const { Title } = Typography;

interface InventoryItem {
  id: number;
  sku_code: string;
  name: string;
  unit: string;
  qty_on_hand: number;
  safety_stock: number;
  cost_price: number;
}

const EuInventory: React.FC = () => {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiGet<{ items: InventoryItem[]; total: number }>('/du/inventory');
      setItems(res?.items || []);
      setLoadError(false);
    } catch {
      setLoadError(true);
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

  const columns: ColumnsType<InventoryItem> = [
    { title: 'SKU编码', dataIndex: 'sku_code', key: 'sku_code', width: 140 },
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '单位', dataIndex: 'unit', key: 'unit', width: 80 },
    {
      title: '库存数量',
      dataIndex: 'qty_on_hand',
      key: 'qty_on_hand',
      width: 120,
      render: (qty: number, record) => (
        <span style={{ color: qty <= record.safety_stock ? '#ff4d4f' : '#333', fontWeight: qty <= record.safety_stock ? 600 : 400 }}>
          {qty}
          {qty <= record.safety_stock && <Tag color="red" style={{ marginLeft: 8 }}>低库存</Tag>}
        </span>
      ),
    },
    { title: '安全库存', dataIndex: 'safety_stock', key: 'safety_stock', width: 100 },
    {
      title: '采购价',
      dataIndex: 'cost_price',
      key: 'cost_price',
      width: 120,
      render: (v: number) => <PriceText value={v} />,
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>库存管理</Title>
      <PageState
        loading={loading}
        error={loadError}
        empty={!loading && !loadError && items.length === 0}
        onRetry={fetchData}
        emptyTitle="还没有库存记录"
        emptyDesc="库存数据来自完工入库与出库单据的自动登记, 是成本核算与补货提醒的数据基础。完成首批作业入库后, 这里会显示各 SKU 的可用量。"
      >
      <Table
        columns={columns}
        dataSource={items}
        rowKey="id"
        loading={loading}
        scroll={{ x: 800 }}
        {...TABLE_PROPS}
        pagination={{ ...TABLE_PROPS.pagination, pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
      />
      </PageState>
    </div>
  );
};

export default EuInventory;
