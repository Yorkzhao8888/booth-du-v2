import React, { useEffect, useState, useCallback } from 'react';
import { Table, Typography, Tag } from 'antd';
import { apiGet } from '../../api';
import PageState from '../../components/PageState'; // [W1-E] 三态兜底
import PriceText from '../../components/PriceText';
import type { ColumnsType } from 'antd/es/table';

const { Title } = Typography;

interface BomMaterial {
  skuId: number;
  skuCode: string;
  name: string;
  qty: number;
  unit: string;
}

interface Bom {
  id: number;
  productName: string;
  productCode: string;
  materials: BomMaterial[];
  salePrice: number;
  costPrice: number;
  isActive: boolean;
}

const EuBoms: React.FC = () => {
  const [boms, setBoms] = useState<Bom[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false); // [W1-E]

  const fetchData = useCallback(async () => {
    setLoadError(false); // [W1-E] 重试复位
    setLoading(true);
    try {
      const res = await apiGet<Bom[]>('/du/boms');
      setBoms(res);
    } catch { setLoadError(true);
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const columns: ColumnsType<Bom> = [
    { title: '商品名', dataIndex: 'productName', key: 'productName' },
    { title: '编码', dataIndex: 'productCode', key: 'productCode', width: 140 },
    {
      title: '原材料明细',
      dataIndex: 'materials',
      key: 'materials',
      render: (materials: BomMaterial[]) => (
        <div>
          {materials?.map((m, idx) => (
            <Tag key={idx} style={{ marginBottom: 4 }}>
              {m.name} {m.qty}{m.unit}
            </Tag>
          ))}
        </div>
      ),
    },
    {
      title: '售价',
      dataIndex: 'salePrice',
      key: 'salePrice',
      width: 120,
      render: (v: number) => <PriceText value={v} />,
    },
    {
      title: '毛利率',
      key: 'margin',
      width: 100,
      render: (_, r) => {
        if (!r.salePrice || !r.costPrice) return '-';
        const margin = ((r.salePrice - r.costPrice) / r.salePrice * 100).toFixed(1);
        return <span style={{ color: Number(margin) >= 30 ? '#52c41a' : '#fa8c16' }}>{margin}%</span>;
      },
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 80,
      render: (a: boolean) => (a ? <Tag color="green">启用</Tag> : <Tag color="default">停用</Tag>),
    },
  ];

  // [W1-E] 错误兜底: 断网/服务异常 → PageState error + 重试（避免静默白页）
  if (loadError) return <PageState error onRetry={() => void fetchData()} skeletonRows={6} />;

  return (
    <div>
      <Title level={4} style={{ marginBottom: 24 }}>BOM 管理</Title>
      <Table
        columns={columns}
        dataSource={boms}
        rowKey="id"
        loading={loading}
        scroll={{ x: 900 }}
        expandable={{
          expandedRowRender: (record) => (
            <div style={{ padding: '8px 0' }}>
              <Typography.Text strong>原材料清单:</Typography.Text>
              <Table
                columns={[
                  { title: 'SKU编码', dataIndex: 'skuCode', key: 'skuCode' },
                  { title: '名称', dataIndex: 'name', key: 'name' },
                  { title: '数量', dataIndex: 'qty', key: 'qty' },
                  { title: '单位', dataIndex: 'unit', key: 'unit' },
                ]}
                dataSource={record.materials}
                rowKey="skuId"
                pagination={false}
                size="small"
              />
            </div>
          ),
        }}
        pagination={{ pageSize: 20, showTotal: (t) => `共 ${t} 条` }}
      />
    </div>
  );
};

export default EuBoms;
