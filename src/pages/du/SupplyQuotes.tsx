import { useEffect, useState } from 'react';
import { Card, Table, Tag, Space, Button, message, Modal, Descriptions, Input } from 'antd';
import { EyeOutlined, CheckOutlined } from '@ant-design/icons';
import { api } from '../../api';

interface SupplyQuote {
  id: number;
  quote_no: string;
  sku_name: string | null;
  sgu_booth_type: string | null;
  bom_material_cost: number;
  labor_cost: number;
  manufacturing_fee: number;
  supply_price: number;
  margin_rate: number;
  gross_profit: number;
  total_price: number;
  version: number;
  status: string;
  effective_from: string | null;
  effective_to: string | null;
  created_at: string;
}

const statusColors: Record<string, string> = {
  draft: 'default',
  pending: 'processing',
  approved: 'success',
  rejected: 'error',
  expired: 'warning',
};

const statusLabels: Record<string, string> = {
  draft: '草稿',
  pending: '待审批',
  approved: '已批准',
  rejected: '已拒绝',
  expired: '已过期',
};

export default function DuSupplyQuotes() {
  const [quotes, setQuotes] = useState<SupplyQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selectedQuote, setSelectedQuote] = useState<SupplyQuote | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const fetchQuotes = async () => {
    setLoading(true);
    try {
      const res = await api(`/du/supply-quotes?page=${page}&pageSize=20`);
      setQuotes(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch { message.error('获取报价单失败'); }
    setLoading(false);
  };

  useEffect(() => { fetchQuotes(); }, [page]);

  const handleApprove = async (id: number) => {
    Modal.confirm({
      title: '确认批准',
      content: '确定要批准此报价单吗？批准后将对供给订单生效。',
      onOk: async () => {
        try {
          await api(`/du/supply-quotes/${id}/approve`, { method: 'POST' });
          message.success('报价单已批准');
          fetchQuotes();
        } catch { message.error('批准失败'); }
      },
    });
  };

  const columns = [
    { title: '报价单号', dataIndex: 'quote_no', key: 'quote_no', width: 150 },
    { title: 'SKU', dataIndex: 'sku_name', key: 'sku_name', width: 120, render: (v: string) => v || '-' },
    { title: '铺类型', dataIndex: 'sgu_booth_type', key: 'sgu_booth_type', width: 80, render: (v: string) => v || '-' },
    { title: '供给价', dataIndex: 'supply_price', key: 'supply_price', width: 100, render: (v: number) => `¥${v?.toFixed(2)}` },
    { title: '毛利率', dataIndex: 'margin_rate', key: 'margin_rate', width: 80, render: (v: number) => `${v}%` },
    { title: '总价', dataIndex: 'total_price', key: 'total_price', width: 100, render: (v: number) => `¥${v?.toFixed(2)}` },
    { title: '版本', dataIndex: 'version', key: 'version', width: 60 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (s: string) => <Tag color={statusColors[s]}>{statusLabels[s]}</Tag> },
    {
      title: '操作', key: 'actions', width: 150,
      render: (_: any, r: SupplyQuote) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => { setSelectedQuote(r); setDetailOpen(true); }}>详情</Button>
          {r.status === 'draft' && <Button type="link" size="small" icon={<CheckOutlined />} onClick={() => handleApprove(r.id)}>批准</Button>}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card title="供给报价单 (决策层视图)">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={quotes}
          loading={loading}
          pagination={{ current: page, total, pageSize: 20, onChange: setPage }}
          size="small"
          scroll={{ x: 900 }}
        />
      </Card>

      <Modal
        title={`报价单详情 - ${selectedQuote?.quote_no || ''}`}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={600}
      >
        {selectedQuote && (
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="报价单号">{selectedQuote.quote_no}</Descriptions.Item>
            <Descriptions.Item label="状态"><Tag color={statusColors[selectedQuote.status]}>{statusLabels[selectedQuote.status]}</Tag></Descriptions.Item>
            <Descriptions.Item label="SKU">{selectedQuote.sku_name || '-'}</Descriptions.Item>
            <Descriptions.Item label="铺类型">{selectedQuote.sgu_booth_type || '-'}</Descriptions.Item>
            <Descriptions.Item label="版本">v{selectedQuote.version}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{new Date(selectedQuote.created_at).toLocaleString()}</Descriptions.Item>
            <Descriptions.Item label="BOM材料成本">¥{selectedQuote.bom_material_cost?.toFixed(2)}</Descriptions.Item>
            <Descriptions.Item label="人工费">¥{selectedQuote.labor_cost?.toFixed(2)}</Descriptions.Item>
            <Descriptions.Item label="制造/服务费">¥{selectedQuote.manufacturing_fee?.toFixed(2)}</Descriptions.Item>
            <Descriptions.Item label="供给价"><strong>¥{selectedQuote.supply_price?.toFixed(2)}</strong></Descriptions.Item>
            <Descriptions.Item label="毛利率">{selectedQuote.margin_rate}%</Descriptions.Item>
            <Descriptions.Item label="毛利额">¥{selectedQuote.gross_profit?.toFixed(2)}</Descriptions.Item>
            <Descriptions.Item label="总价" span={2}><strong style={{ fontSize: 16 }}>¥{selectedQuote.total_price?.toFixed(2)}</strong></Descriptions.Item>
            <Descriptions.Item label="生效日期">{selectedQuote.effective_from ? new Date(selectedQuote.effective_from).toLocaleDateString() : '-'}</Descriptions.Item>
            <Descriptions.Item label="失效日期">{selectedQuote.effective_to ? new Date(selectedQuote.effective_to).toLocaleDateString() : '-'}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}
