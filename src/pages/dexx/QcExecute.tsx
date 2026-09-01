import React, { useEffect, useState, useCallback } from 'react';
import { Card, Table, Button, Tag, Space, Modal, Form, Input, InputNumber, Radio, Select, message, Descriptions } from 'antd';
import { CheckCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { api } from '../../api';

const CHECK_TYPE_OPTIONS = [
  { value: 'all', label: '全部关卡' },
  { value: 'iqc', label: '来料检 IQC' },
  { value: 'ipqc', label: '过程检 IPQC' },
  { value: 'fqc', label: '成品检 FQC' },
  { value: 'oqc', label: '出货检 OQC' },
];

const CHECK_TYPE_LABEL: Record<string, string> = { iqc: '来料 IQC', ipqc: '过程 IPQC', fqc: '成品 FQC', oqc: '出货 OQC' };

const RESULT_META: Record<string, { color: string; label: string }> = {
  pending: { color: 'orange', label: '待检' },
  pass: { color: 'green', label: '通过' },
  fail: { color: 'red', label: '不通过' },
  reject: { color: 'red', label: '不通过' },
  hold: { color: 'gold', label: '可疑' },
};

const DEFECT_REASONS = ['划伤', '脏污', '尺寸偏差', '漏装', '错装', '功能异常', '包装破损', '其他'];

const QcExecute: React.FC = () => {
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkType, setCheckType] = useState('all');
  const [pendingOnly, setPendingOnly] = useState(true);
  const [executeVisible, setExecuteVisible] = useState(false);
  const [currentQc, setCurrentQc] = useState<any>(null);
  const [form] = Form.useForm();

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ pending: pendingOnly ? '1' : '0' });
      if (checkType !== 'all') qs.set('check_type', checkType);
      const res: any = await api.get(`/dexx/fab/qc/list?${qs.toString()}`);
      setList(Array.isArray(res) ? res : res.items || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  }, [checkType, pendingOnly]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleExecute = async (values: any) => {
    if (!currentQc) return;
    try {
      await api.post('/dexx/fab/qc/execute', {
        qcId: currentQc.id,
        result: values.result,
        passedQty: values.passedQty,
        failedQty: values.failedQty,
        remark: values.result === 'pass' ? values.remark : (values.reject_reason === '其他' ? (values.remark || '其他') : values.reject_reason || values.remark),
      });
      message.success(values.result === 'pass' ? '质检通过' : values.result === 'hold' ? '已标记可疑' : '质检不通过');
      setExecuteVisible(false);
      form.resetFields();
      fetchList();
    } catch (e: any) { message.error(e.message || '操作失败'); }
  };

  const columns = [
    { title: 'QC ID', dataIndex: 'id', width: 70 },
    { title: '工单', dataIndex: 'work_order_id', width: 70 },
    { title: '产品', dataIndex: 'product_name', width: 150, ellipsis: true },
    { title: '关卡', dataIndex: 'check_type', width: 100, render: (v: string) => <Tag>{CHECK_TYPE_LABEL[v] || v || 'fqc'}</Tag> },
    { title: '工序', dataIndex: 'stage', width: 90, render: (v: string) => v || '-' },
    { title: '工单数量', dataIndex: 'wo_qty', width: 80 },
    {
      title: '结果', dataIndex: 'result', width: 90,
      render: (v: string) => { const m = RESULT_META[v] || { color: 'default', label: v || '-' }; return <Tag color={m.color}>{m.label}</Tag>; },
    },
    { title: '合格', dataIndex: 'qty_pass', width: 70, render: (v: any) => v ?? '-' },
    { title: '不良', dataIndex: 'qty_reject', width: 70, render: (v: any) => v ?? '-' },
    { title: '不良原因', dataIndex: 'reject_reason', width: 110, ellipsis: true, render: (v: string) => v || '-' },
    { title: '检验员', dataIndex: 'inspector_name', width: 90, render: (v: string) => v || '-' },
    { title: '创建时间', dataIndex: 'created_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    {
      title: '操作', key: 'action', width: 110, fixed: 'right' as const,
      render: (_: any, r: any) =>
        ['pending', 'fail', 'hold'].includes(r.result) ? (
          <Button type="primary" size="small" icon={<CheckCircleOutlined />} onClick={() => { setCurrentQc(r); setExecuteVisible(true); }}>执行质检</Button>
        ) : (
          <Tag>已完结</Tag>
        ),
    },
  ];

  return (
    <Card
      title="质检任务"
      extra={
        <Space>
          <Select value={checkType} onChange={setCheckType} options={CHECK_TYPE_OPTIONS} style={{ width: 150 }} />
          <Button type={pendingOnly ? 'primary' : 'default'} onClick={() => setPendingOnly(!pendingOnly)}>
            {pendingOnly ? '仅待检' : '含已检'}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchList} />
        </Space>
      }
    >
      <Table dataSource={list} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} scroll={{ x: 1200 }} size="small" />

      <Modal title={`质检执行 - ${currentQc?.product_name || ''}`} open={executeVisible} onCancel={() => setExecuteVisible(false)} onOk={() => form.submit()} width={520} destroyOnClose>
        {currentQc && (
          <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
            <Descriptions.Item label="产品">{currentQc.product_name}</Descriptions.Item>
            <Descriptions.Item label="工单数量">{currentQc.wo_qty}</Descriptions.Item>
            <Descriptions.Item label="关卡">{CHECK_TYPE_LABEL[currentQc.check_type] || currentQc.check_type || 'fqc'}</Descriptions.Item>
            <Descriptions.Item label="工序">{currentQc.stage || '-'}</Descriptions.Item>
          </Descriptions>
        )}
        <Form form={form} layout="vertical" onFinish={handleExecute} initialValues={{ result: 'pass' }}>
          <Form.Item name="result" label="质检结果" rules={[{ required: true, message: '请选择结果' }]}>
            <Radio.Group>
              <Radio value="pass">通过</Radio>
              <Radio value="reject">不通过</Radio>
              <Radio value="hold">可疑</Radio>
            </Radio.Group>
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(p, c) => p.result !== c.result}>
            {({ getFieldValue }) =>
              getFieldValue('result') !== 'pass' && (
                <Form.Item name="reject_reason" label="不良原因" rules={[{ required: true, message: '请选择不良原因' }]}>
                  <Select
                    showSearch
                    allowClear
                    placeholder="选择或输入不良原因"
                    options={DEFECT_REASONS.map((r) => ({ value: r, label: r }))}
                  />
                </Form.Item>
              )
            }
          </Form.Item>
          <Space style={{ width: '100%' }} size="middle">
            <Form.Item name="passedQty" label="合格数量" style={{ width: '45%' }}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="failedQty" label="不良数量" style={{ width: '45%' }}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          </Space>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} placeholder="补充说明(选填)" /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default QcExecute;
