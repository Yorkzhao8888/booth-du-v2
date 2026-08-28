import React, { useEffect, useState, useCallback } from 'react';
import { Button, Select, InputNumber, message, Typography, Space } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { apiGet, apiPost } from '../../api';

const { Title } = Typography;

interface SkuOption {
  id: number;
  skuCode: string;
  name: string;
  unit: string;
  quantity: number;
}

interface OutboundLine {
  key: string;
  skuId?: number;
  qty?: number;
}

const WhOutbound: React.FC = () => {
  const [skus, setSkus] = useState<SkuOption[]>([]);
  const [lines, setLines] = useState<OutboundLine[]>([{ key: '1' }]);
  const [submitting, setSubmitting] = useState(false);

  const fetchSkus = useCallback(async () => {
    try {
      const res = await apiGet<SkuOption[]>('/dexx/wh/inventory');
      setSkus(res);
    } catch {
      setSkus([]);
    }
  }, []);

  useEffect(() => {
    fetchSkus();
  }, [fetchSkus]);

  const addLine = () => {
    setLines((prev) => [...prev, { key: String(Date.now()) }]);
  };

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  };

  const updateLine = (key: string, field: keyof OutboundLine, value: number | undefined) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  };

  const handleSubmit = async () => {
    const validLines = lines.filter((l) => l.skuId && l.qty && l.qty > 0);
    if (validLines.length === 0) {
      message.warning('请至少填写一条有效的出库记录');
      return;
    }

    // Validate stock
    for (const line of validLines) {
      const sku = skus.find((s) => s.id === line.skuId);
      if (sku && line.qty! > sku.quantity) {
        message.error(`${sku.name} 库存不足，当前库存: ${sku.quantity}${sku.unit}`);
        return;
      }
    }

    setSubmitting(true);
    try {
      await apiPost('/dexx/wh/outbound', {
        items: validLines.map((l) => ({ skuId: l.skuId, qty: l.qty })),
      });
      message.success('出库成功');
      setLines([{ key: String(Date.now()) }]);
      fetchSkus();
    } catch (err: unknown) {
      const e = err as { code?: number; error?: string };
      if (e.code === 409) {
        message.error(e.error || '库存不足，无法出库');
      } else {
        message.error(e.error || '出库失败');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ padding: 12 }}>
      <Title level={5} style={{ marginBottom: 16 }}>出库</Title>
      {lines.map((line) => {
        const selectedSku = skus.find((s) => s.id === line.skuId);
        return (
          <div
            key={line.key}
            style={{
              background: '#fff',
              borderRadius: 8,
              padding: 12,
              marginBottom: 10,
            }}
          >
            <Select
              placeholder="选择SKU"
              size="large"
              showSearch
              style={{ width: '100%', marginBottom: 8 }}
              optionFilterProp="label"
              value={line.skuId}
              onChange={(v) => updateLine(line.key, 'skuId', v)}
              options={skus.map((s) => ({
                label: `${s.name} (库存:${s.quantity}${s.unit})`,
                value: s.id,
              }))}
            />
            <Space.Compact style={{ width: '100%' }}>
              <InputNumber
                size="large"
                min={1}
                max={selectedSku?.quantity}
                placeholder="数量"
                style={{ width: 'calc(100% - 48px)' }}
                value={line.qty}
                onChange={(v) => updateLine(line.key, 'qty', v ?? undefined)}
              />
              <Button
                size="large"
                danger
                icon={<DeleteOutlined />}
                onClick={() => removeLine(line.key)}
                disabled={lines.length <= 1}
              />
            </Space.Compact>
          </div>
        );
      })}
      <Button
        type="dashed"
        size="large"
        icon={<PlusOutlined />}
        onClick={addLine}
        block
        style={{ marginBottom: 16 }}
      >
        添加一行
      </Button>
      <Button
        type="primary"
        size="large"
        block
        danger
        loading={submitting}
        onClick={handleSubmit}
      >
        确认出库
      </Button>
    </div>
  );
};

export default WhOutbound;
