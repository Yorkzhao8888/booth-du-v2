import React, { useEffect, useState, useCallback } from 'react';
import { Select, Typography, Empty, Tag, Input } from 'antd';
import { apiGet } from '../../api';
import dayjs from 'dayjs';

const { Title } = Typography;

interface Txn {
  id: number;
  skuName: string;
  skuCode?: string;
  changeQty: number;
  type: string;
  createdAt: string;
  note?: string;
}

const txnTypeLabels: Record<string, { text: string; color: string }> = {
  inbound: { text: '入库', color: 'green' },
  outbound: { text: '出库', color: 'red' },
  consume: { text: '领料', color: 'orange' },
  adjust: { text: '调整', color: 'blue' },
};

const WhTxns: React.FC = () => {
  const [txns, setTxns] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [search, setSearch] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const query = typeFilter ? `?type=${typeFilter}` : '';
      const res = await apiGet<Txn[]>(`/dexx/wh/txns${query}`);
      setTxns(res);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => {
    fetchData();
    const handler = () => fetchData();
    window.addEventListener('booth:refresh', handler);
    return () => window.removeEventListener('booth:refresh', handler);
  }, [fetchData]);

  const filtered = search
    ? txns.filter(
        (t) =>
          t.skuName.toLowerCase().includes(search.toLowerCase()) ||
          (t.skuCode && t.skuCode.toLowerCase().includes(search.toLowerCase()))
      )
    : txns;

  return (
    <div style={{ padding: 12 }}>
      <Title level={5} style={{ marginBottom: 12 }}>库存流水</Title>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Select
          placeholder="类型"
          allowClear
          size="large"
          style={{ width: 120 }}
          value={typeFilter || undefined}
          onChange={(v) => setTypeFilter(v || '')}
          options={[
            { label: '入库', value: 'inbound' },
            { label: '出库', value: 'outbound' },
            { label: '领料', value: 'consume' },
            { label: '调整', value: 'adjust' },
          ]}
        />
        <Input.Search
          placeholder="搜索SKU"
          allowClear
          size="large"
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      {!loading && filtered.length === 0 ? (
        <Empty description="暂无流水记录" style={{ marginTop: 60 }} />
      ) : (
        filtered.map((txn) => {
          const typeCfg = txnTypeLabels[txn.type] || { text: txn.type, color: 'default' };
          const isPositive = txn.changeQty > 0;
          return (
            <div
              key={txn.id}
              style={{
                background: '#fff',
                borderRadius: 8,
                padding: '12px 16px',
                marginBottom: 8,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 500 }}>
                  {txn.skuName}
                  <Tag color={typeCfg.color} style={{ marginLeft: 8 }}>
                    {typeCfg.text}
                  </Tag>
                </div>
                <div style={{ color: '#999', fontSize: 12, marginTop: 4 }}>
                  {dayjs(txn.createdAt).format('MM-DD HH:mm')}
                  {txn.note && ` · ${txn.note}`}
                </div>
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: isPositive ? '#52c41a' : '#ff4d4f',
                }}
              >
                {isPositive ? '+' : ''}
                {txn.changeQty}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};

export default WhTxns;
