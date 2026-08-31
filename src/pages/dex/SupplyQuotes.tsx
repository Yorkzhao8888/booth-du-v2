import { useEffect, useState } from 'react';
import { Card, Table, Tag, Button, message, Modal, Descriptions } from 'antd';
import { EyeOutlined } from '@ant-design/icons';
import { api } from '../../api';

interface SupplyQuote {
  id: number;
  quote_no: string;
  sku_name: string | null;
  sgu_booth_type: string | null;
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

export default function DexSupplyQuotes() {
  const [quotes, setQuotes] = useState<SupplyQuote[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [selectedQuote, setSelectedQuote] = useState<SupplyQuote | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const fetchQuotes = async () => {
    setLoading(true);
    try {
      const res = await api(`/dex/supply-quotes?page=${page}&pageSize=20`);
      setQuotes(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch { message.error('获取报价单失败'); }
    setLoading(false);
  };

  useEffect(() => { fetchQuotes(); }, [page]);

  // DEX sees NO price fields - only quote metadata
  const columns = [
    { title: '报价单号', dataIndex: 'quote_no', key: 'quote_no', width: 150 },
    { title: 'SKU', dataIndex: 'sku_name', key: 'sku_name', width: 120, render: (v: string) => v || '-' },
    { title: '铺类型', dataIndex: 'sgu_booth_type', key: 'sgu_booth_type', width: 80, render: (v: string) => v || '-' },
    { title: '版本', dataIndex: 'version', key: 'version', width: 60 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 80, render: (s: string) => <Tag color={statusColors[s]}>{statusLabels[s]}</Tag> },
    { title: '生效日期', dataIndex: 'effective_from', key: 'effective_from', width: 100, render: (v: string) => v ? new Date(v).toLocaleDateString() : '-' },
    { title: '失效日期', dataIndex: 'effective_to', key: 'effective_to', width: 100, render: (v: string) => v ? new Date(v).toLocaleDateString() : '-' },
    {
      title: '操作', key: 'actions', width: 80,
      render: (_: any, r: SupplyQuote) => (
        <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => { setSelectedQuote(r); setDetailOpen(true); }}>详情</Button>
      ),
    },
  ];

  return (
    <div>
      <Card title="供给报价单 (执行管理视图 - 仅单号/状态)">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={quotes}
          loading={loading}
          pagination={{ current: page, total, pageSize: 20, onChange: setPage }}
          size="small"
          scroll={{ x: 800 }}
        />
      </Card>

      <Modal
        title={`报价单详情 - ${selectedQuote?.quote_no || ''}`}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={500}
      >
        {selectedQuote && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="报价单号">{selectedQuote.quote_no}</Descriptions.Item>
            <Descriptions.Item label="状态"><Tag color={statusColors[selectedQuote.status]}>{statusLabels[selectedQuote.status]}</Tag></Descriptions.Item>
            <Descriptions.Item label="SKU">{selectedQuote.sku_name || '-'}</Descriptions.Item>
            <Descriptions.Item label="铺类型">{selectedQuote.sgu_booth_type || '-'}</Descriptions.Item>
            <Descriptions.Item label="版本">v{selectedQuote.version}</Descriptions.Item>
            <Descriptions.Item label="生效日期">{selectedQuote.effective_from ? new Date(selectedQuote.effective_from).toLocaleDateString() : '-'}</Descriptions.Item>
            <Descriptions.Item label="失效日期">{selectedQuote.effective_to ? new Date(selectedQuote.effective_to).toLocaleDateString() : '-'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{new Date(selectedQuote.created_at).toLocaleString()}</Descriptions.Item>
            <Descriptions.Item label="价格信息" span={1}>
              <span style={{ color: '#999' }}>价格信息仅决策层可见</span>
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
}
