import React, { useEffect, useState } from 'react';
import { Card, Table, Tag, Select, Space } from 'antd';
import { api } from '../../api';

const Batches: React.FC = () => {
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [skuFilter, setSkuFilter] = useState<string>('');
  const [skuOptions, setSkuOptions] = useState<any[]>([]);

  const fetchBatches = async () => {
    setLoading(true);
    try {
      const params = skuFilter ? `?skuId=${skuFilter}` : '';
      const res = await api.get(`/du/wh/batches${params}`);
      setBatches(res.items || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  const fetchSkus = async () => {
    try {
      const res = await api.get('/du/skus?pageSize=200');
      setSkuOptions(res.items || []);
    } catch (e) { /* ignore */ }
  };

  useEffect(() => { fetchSkus(); }, []);
  useEffect(() => { fetchBatches(); }, [skuFilter]);

  const isExpired = (expiryDate: string) => {
    if (!expiryDate) return false;
    return new Date(expiryDate) < new Date();
  };

  const isNearExpiry = (expiryDate: string) => {
    if (!expiryDate) return false;
    const diff = new Date(expiryDate).getTime() - Date.now();
    return diff > 0 && diff < 30 * 24 * 60 * 60 * 1000; // 30 days
  };

  const columns = [
    { title: '批次号', dataIndex: 'batch_no', width: 140 },
    { title: 'SKU编码', dataIndex: 'sku_code', width: 120 },
    { title: '物料名称', dataIndex: 'sku_name', width: 150 },
    { title: '数量', dataIndex: 'qty', width: 80 },
    { title: '单位成本', dataIndex: 'unit_cost', width: 100, render: (v: number) => v != null ? `¥${v.toFixed(2)}` : '-' },
    {
      title: '有效期', dataIndex: 'expiry_date', width: 120,
      render: (v: string) => {
        if (!v) return '-';
        if (isExpired(v)) return <Tag color="error">{new Date(v).toLocaleDateString()} (已过期)</Tag>;
        if (isNearExpiry(v)) return <Tag color="warning">{new Date(v).toLocaleDateString()} (临期)</Tag>;
        return new Date(v).toLocaleDateString();
      },
    },
    { title: '来源', dataIndex: 'source_type', width: 100, render: (v: string) => v === 'purchase' ? '采购入库' : v },
    { title: '创建时间', dataIndex: 'created_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
  ];

  return (
    <Card title="批次库存" extra={
      <Space>
        <span>筛选SKU：</span>
        <Select
          style={{ width: 200 }}
          placeholder="全部"
          allowClear
          showSearch
          optionFilterProp="label"
          onChange={(v) => setSkuFilter(v || '')}
          options={skuOptions.map((s: any) => ({ value: s.id, label: `${s.sku_code} - ${s.name}` }))}
        />
      </Space>
    }>
      <Table dataSource={batches} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 20 }} scroll={{ x: 1000 }} />
    </Card>
  );
};

export default Batches;
