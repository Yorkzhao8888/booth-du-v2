import React, { useEffect, useMemo, useState } from 'react';
import { Card, Table, Tag, Select, Space, Tabs, Typography } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api';
import PageState from '../../components/PageState';
import { TABLE_PROPS } from '../../constants/table';
import WarehouseDashboard from './WarehouseDashboard';
import ExpiryControl from './ExpiryControl';
import InventoryAlerts from './InventoryAlerts';

const PAGE_DESC: Record<string, string> = {
  batches: '批次是库存账实的最小颗粒：按 SKU 批次记录数量与有效期，是先进先出、效期管控与盘点对账的数据源',
  whBoard: '四仓视角聚合原材料/半成品/成品/耗材的库存水位，用于产能评估与补货决策',
  expiry: '临期与过期批次清单：按效期倒序排列，先到期先出库，避免物料报废损失',
  alerts: '低于安全库存的物料清单：触达预警线即需采购或调拨，保障产线不断料',
};

/**
 * [W1-A/B2] WH 收敛视图：批次库存为主体 tab，四仓看板/效期管控/库存预警收敛为 tab（原三入口隐藏，
 * 直连 URL /du/expiry-control 等优雅重定向至本页对应 tab，toggle 开回原子恢复）
 */
const Batches: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'batches';
  const [batches, setBatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [skuFilter, setSkuFilter] = useState<string>('');
  const [skuOptions, setSkuOptions] = useState<any[]>([]);

  const fetchBatches = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const params = skuFilter ? `?skuId=${skuFilter}` : '';
      const res = await api.get(`/du/wh/batches${params}`);
      setBatches(res.items || []);
    } catch (e) {
      setLoadError(true);
    }
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

  const batchPane = useMemo(
    () => (
      <PageState
        loading={loading}
        error={loadError}
        onRetry={fetchBatches}
        empty={!loading && !loadError && batches.length === 0}
        emptyTitle="还没有批次库存记录"
        emptyDesc={PAGE_DESC.batches}
      >
        <Table
          dataSource={batches}
          columns={columns}
          rowKey="id"
          {...TABLE_PROPS}
          scroll={{ x: 1000 }}
        />
      </PageState>
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [batches, loading, loadError],
  );

  const items = [
    { key: 'batches', label: '批次库存', children: batchPane },
    { key: 'whBoard', label: '四仓看板', children: <WarehouseDashboard /> },
    { key: 'expiry', label: '效期管控', children: <ExpiryControl /> },
    { key: 'alerts', label: '库存预警', children: <InventoryAlerts /> },
  ];

  return (
    <Card
      title="库存台账 · 批次与看板"
      extra={
        tab === 'batches' ? (
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
        ) : null
      }
    >
      <Tabs
        activeKey={tab}
        onChange={(k) => setSearchParams(k === 'batches' ? {} : { tab: k }, { replace: true })}
        items={items.map((it) => ({ ...it, children: (
          <>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>{PAGE_DESC[it.key]}</Typography.Paragraph>
            {it.children}
          </>
        ) }))}
      />
    </Card>
  );
};

export default Batches;
