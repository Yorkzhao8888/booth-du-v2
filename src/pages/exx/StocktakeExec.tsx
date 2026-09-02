import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Tag, Space, Modal, Form, Input, InputNumber, message, List, Descriptions } from 'antd';
import { PlusOutlined, SendOutlined } from '@ant-design/icons';
import { api } from '../../api';

const statusMap: Record<string, { color: string; label: string }> = {
  draft: { color: 'default', label: '草稿' },
  counting: { color: 'processing', label: '盘点中' },
  submitted: { color: 'cyan', label: '待审批' },
  approved: { color: 'success', label: '已审批' },
  rejected: { color: 'error', label: '已驳回' },
};

const StocktakeExec: React.FC = () => {
  const [stocktakes, setStocktakes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [submitVisible, setSubmitVisible] = useState(false);
  const [currentSo, setCurrentSo] = useState<any>(null);
  const [inventory, setInventory] = useState<any[]>([]);
  const [createForm] = Form.useForm();
  const [submitForm] = Form.useForm();

  const fetchStocktakes = async () => {
    setLoading(true);
    try {
      const res = await api.get('/exx/wh/stocktakes');
      setStocktakes(res.items || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  };

  const fetchInventory = async () => {
    try {
      const res = await api.get('/exx/wh/inventory');
      setInventory(res.items || []);
    } catch (e) { /* ignore */ }
  };

  useEffect(() => { fetchStocktakes(); }, []);

  const handleCreate = async (values: any) => {
    try {
      const items = inventory.map((inv: any) => ({
        skuId: inv.sku_id,
        skuName: inv.name,
        systemQty: inv.qty_on_hand,
        actualQty: inv.qty_on_hand, // default to system qty
      }));
      await api.post('/exx/wh/stocktakes', { items, remark: values.remark });
      message.success('盘点单创建成功');
      setCreateVisible(false);
      createForm.resetFields();
      fetchStocktakes();
    } catch (e: any) { message.error(e.message || '创建失败'); }
  };

  const handleSubmit = async (values: any) => {
    if (!currentSo) return;
    try {
      // Update items with actual quantities from form
      const items = (currentSo.items || []).map((item: any, idx: number) => ({
        ...item,
        actualQty: values[`actualQty_${idx}`] ?? item.actualQty ?? item.systemQty,
      }));
      await api.post(`/exx/wh/stocktakes/${currentSo.id}/submit`, { items });
      message.success('盘点单已提交审批');
      setSubmitVisible(false);
      fetchStocktakes();
    } catch (e: any) { message.error(e.message || '提交失败'); }
  };

  const columns = [
    { title: '盘点单号', dataIndex: 'so_no', width: 140 },
    { title: '状态', dataIndex: 'status', width: 100, render: (s: string) => <Tag color={statusMap[s]?.color}>{statusMap[s]?.label || s}</Tag> },
    { title: '备注', dataIndex: 'remark', width: 150, ellipsis: true, render: (v: string) => v || '-' },
    { title: '创建时间', dataIndex: 'created_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    {
      title: '操作', key: 'action', width: 120,
      render: (_: any, r: any) => {
        if (['draft', 'counting'].includes(r.status)) {
          return <Button size="small" type="primary" icon={<SendOutlined />} onClick={() => { setCurrentSo(r); setSubmitVisible(true); }}>提交</Button>;
        }
        return null;
      },
    },
  ];

  return (
    <Card title="盘点执行" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => { setCreateVisible(true); fetchInventory(); }}>新建盘点</Button>}>
      <Table dataSource={stocktakes} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} scroll={{ x: 700 }} />

      <Modal title="新建盘点单" open={createVisible} onCancel={() => setCreateVisible(false)} onOk={() => createForm.submit()}>
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
          <p style={{ color: '#999' }}>将自动包含所有库存SKU，盘点时再逐一录入实际数量。</p>
        </Form>
      </Modal>

      <Modal title={`提交盘点 - ${currentSo?.so_no || ''}`} open={submitVisible} onCancel={() => setSubmitVisible(false)} onOk={() => submitForm.submit()} width={600}>
        <Form form={submitForm} layout="vertical" onFinish={handleSubmit}>
          {(currentSo?.items || []).map((item: any, idx: number) => (
            <Space key={idx} style={{ display: 'flex', marginBottom: 8 }} align="center">
              <span style={{ width: 120 }}>{item.skuName || item.sku_name || `SKU#${item.skuId || item.sku_id}`}</span>
              <span>系统: {item.systemQty}</span>
              <Form.Item name={`actualQty_${idx}`} label="实际" initialValue={item.actualQty || item.systemQty} style={{ marginBottom: 0 }}>
                <InputNumber min={0} precision={2} />
              </Form.Item>
              <span style={{ color: '#999' }}>
                差异: {((item.actualQty || item.systemQty) - item.systemQty).toFixed(2)}
              </span>
            </Space>
          ))}
        </Form>
      </Modal>
    </Card>
  );
};

export default StocktakeExec;
