import React, { useEffect, useState, useCallback } from 'react';
import { Empty, Input } from 'antd';
import { apiGet } from '../../api';

interface InventoryItem {
  id: number;
  skuCode: string;
  name: string;
  unit: string;
  quantity: number;
  safetyStock: number;
}

const WhInventory: React.FC = () => {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [filtered, setFiltered] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const res = await apiGet<InventoryItem[]>('/dexx/wh/inventory');
      setItems(res);
      setFiltered(res);
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

  const handleSearch = (val: string) => {
    const v = val.toLowerCase().trim();
    if (!v) {
      setFiltered(items);
    } else {
      setFiltered(items.filter((i) => i.name.toLowerCase().includes(v) || i.skuCode.toLowerCase().includes(v)));
    }
  };

  return (
    <div style={{ padding: 12 }}>
      <Input.Search
        placeholder="搜索SKU名称或编码"
        allowClear
        size="large"
        style={{ marginBottom: 12 }}
        onChange={(e) => handleSearch(e.target.value)}
      />
      {!loading && filtered.length === 0 ? (
        <Empty description="暂无库存数据" style={{ marginTop: 60 }} />
      ) : (
        filtered.map((item) => {
          const low = item.quantity <= item.safetyStock;
          return (
            <div
              key={item.id}
              style={{
                background: '#fff',
                borderRadius: 8,
                padding: '14px 16px',
                marginBottom: 10,
                borderLeft: low ? '4px solid #ff4d4f' : '4px solid #52c41a',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{item.name}</div>
                  <div style={{ color: '#999', fontSize: 12, marginTop: 2 }}>{item.skuCode}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: low ? '#ff4d4f' : '#333' }}>
                    {item.quantity}
                    <span style={{ fontSize: 13, fontWeight: 400, color: '#999', marginLeft: 4 }}>
                      {item.unit}
                    </span>
                  </div>
                  {low && (
                    <div style={{ color: '#ff4d4f', fontSize: 12 }}>
                      安全库存: {item.safetyStock}{item.unit}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};

export default WhInventory;
