import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Tag, Space, Modal, message, Descriptions, List, Popconfirm } from 'antd';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { api } from '../../api';

const statusMap: Record<string, { color: string; label: string }> = {
  draft: { color: 'default', label: '草稿' },
  counting: { color: 'processing', label: '盘点中' },
  submitted: { color: 'cyan', label: '待审批' },
  approved: { color: 'success', label: '已审批' },
  rejected: { color: 'error', label: '已驳回' },
};

const StocktakeApproval: React.FC = () => {
  const [stocktakes, setStocktakes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentSo, setCurrentSo] = useState<any>(null);

  const fetchStocktakes = async () => {
    setLoading(true);
    try {
      const res = await api.get('/dex/wh/stocktakes');
      setStocktakes(res.items || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchStocktakes(); }, []);

  const handleApprove = async (id: number) => {
    try {
      await api.post(`/dex/wh/stocktakes/${id}/approve`);
      message.success('审批通过，库存已调整');
      fetchStocktakes();
    } catch (e: any) { message.error(e.message || '审批失败'); }
  };

  const handleReject = async (id: number) => {
    try {
      await api.post(`/dex/wh/stocktakes/${id}/reject`);
      message.success('已驳回');
      fetchStocktakes();
    } catch (e: any) { message.error(e.message || '驳回失败'); }
  };

  const columns = [
    { title: '盘点单号', dataIndex: 'so_no', width: 140 },
    { title: '状态', dataIndex: 'status', width: 100, render: (s: string) => <Tag color={statusMap[s]?.color}>{statusMap[s]?.label || s}</Tag> },
    { title: '备注', dataIndex: 'remark', width: 150, ellipsis: true, render: (v: string) => v || '-' },
    { title: '创建时间', dataIndex: 'created_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    { title: '提交时间', dataIndex: 'submitted_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    {
      title: '操作', key: 'action', width: 200,
      render: (_: any, r: any) => (
        <Space>
          <Button size="small" onClick={() => { setCurrentSo(r); setDetailVisible(true); }}>查看</Button>
          {r.status === 'submitted' && (
            <>
              <Popconfirm title="确定审批通过？库存将按实际数量调整。" onConfirm={() => handleApprove(r.id)}>
                <Button size="small" type="primary" icon={<CheckOutlined />}>通过</Button>
              </Popconfirm>
              <Popconfirm title="确定驳回？" onConfirm={() => handleReject(r.id)}>
                <Button size="small" danger icon={<CloseOutlined />}>驳回</Button>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Card title="盘点审批">
      <Table dataSource={stocktakes} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 20 }} scroll={{ x: 900 }} />

      <Modal title={`盘点详情 - ${currentSo?.so_no || ''}`} open={detailVisible} onCancel={() => setDetailVisible(false)} footer={null} width={700}>
        {currentSo && (
          <>
            <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label="单号">{currentSo.so_no}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color={statusMap[currentSo.status]?.color}>{statusMap[currentSo.status]?.label}</Tag></Descriptions.Item>
              <Descriptions.Item label="备注" span={2}>{currentSo.remark || '-'}</Descriptions.Item>
            </Descriptions>
            <List
              size="small"
              header={<div style={{ fontWeight: 600 }}>盘点明细</div>}
              dataSource={currentSo.items || []}
              renderItem={(item: any) => {
                const diff = (item.actualQty || item.systemQty) - item.systemQty;
                return (
                  <List.Item>
                    <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                      <span>{item.skuName || `SKU#${item.skuId || item.sku_id}`}</span>
                      <span>系统: {item.systemQty}</span>
                      <span>实际: {item.actualQty || '-'}</span>
                      <span style={{ color: diff > 0 ? '#52c41a' : diff < 0 ? '#ff4d4f' : '#999' }}>
                        差异: {diff > 0 ? '+' : ''}{diff.toFixed(2)}
                      </span>
                    </Space>
                  </List.Item>
                );
              }}
            />
          </>
        )}
      </Modal>
    </Card>
  );
};

export default StocktakeApproval;
