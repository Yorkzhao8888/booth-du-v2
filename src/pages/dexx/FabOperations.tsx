import { useEffect, useState } from 'react';
import { Card, Table, Button, Modal, Form, Input, InputNumber, message, Tag, List, Space, Steps, Descriptions, Divider } from 'antd';
import { api } from '../../api';

const STAGE_LABELS: Record<string, string> = {
  preprocessing: '前置工序',
  production: '制作',
  packaging: '包装',
  sorting: '分拣',
};

const STAGE_COLORS: Record<string, string> = {
  preprocessing: 'orange',
  production: 'blue',
  packaging: 'purple',
  sorting: 'green',
};

const woStatusMap: Record<string, { label: string; color: string }> = {
  pending: { label: '待接单', color: 'default' },
  accepted: { label: '已接单', color: 'processing' },
  in_progress: { label: '生产中', color: 'warning' },
  completed: { label: '已完成', color: 'success' },
  cancelled: { label: '已取消', color: 'error' },
  // 8 态状态
  Pending: { label: '待处理', color: 'default' },
  Dispatched: { label: '已派单', color: 'cyan' },
  Accepted: { label: '已接单', color: 'processing' },
  Running: { label: '生产中', color: 'warning' },
  Completed: { label: '已完成', color: 'success' },
  Failed: { label: '失败', color: 'error' },
  Cancelled: { label: '已取消', color: 'error' },
  Archived: { label: '已归档', color: 'default' },
};

const FabOperations = () => {
  const [activeOrders, setActiveOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [selectedWo, setSelectedWo] = useState<any>(null);
  const [operations, setOperations] = useState<any[]>([]);
  const [form] = Form.useForm();

  const fetchActiveOrders = async () => {
    setLoading(true);
    try {
      const res = await api.get('/dex/work-orders?status=in_progress');
      setActiveOrders(res.items || []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  const fetchOperations = async (workOrderId: number) => {
    try {
      const res = await api.get(`/dexx/fab/operations?workOrderId=${workOrderId}`);
      setOperations(res.items || []);
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchActiveOrders(); }, []);

  const openReport = (wo: any) => {
    setSelectedWo(wo);
    setReportVisible(true);
    fetchOperations(wo.id);
  };

  const handleReport = async (values: any) => {
    try {
      await api.post('/dexx/fab/report', { workOrderId: selectedWo.id, ...values });
      message.success('报工成功');
      form.resetFields();
      fetchOperations(selectedWo.id);
    } catch (err: any) {
      message.error(err?.error || '报工失败');
    }
  };

  const handleComplete = async () => {
    try {
      await api.post('/dexx/fab/complete', { workOrderId: selectedWo.id });
      message.success('工单已完工，进入质检');
      setReportVisible(false);
      fetchActiveOrders();
    } catch (err: any) {
      message.error(err?.error || '完工失败');
    }
  };

  const handleAdvanceStage = async (targetStage: string) => {
    try {
      const res = await api.post('/dexx/fab/stage/advance', { 
        workOrderId: selectedWo.id, 
        targetStage 
      });
      message.success(res.message || `已流转至${STAGE_LABELS[targetStage]}产线`);
      fetchActiveOrders();
      // Refresh selected work order
      const updatedWo = { ...selectedWo, production_stage: targetStage };
      setSelectedWo(updatedWo);
    } catch (err: any) {
      message.error(err?.error || '产线流转失败');
    }
  };

  const getCurrentStageIndex = (stage: string) => {
    const stages = ['preprocessing', 'production', 'packaging', 'sorting'];
    return stages.indexOf(stage || 'preprocessing');
  };

  const columns = [
    { title: '工单号', dataIndex: 'wo_no', key: 'wo_no' },
    { title: '商品', dataIndex: 'product_name', key: 'product_name' },
    { title: '数量', dataIndex: 'qty', key: 'qty' },
    { 
      title: '产线阶段', 
      dataIndex: 'production_stage', 
      key: 'production_stage',
      render: (stage: string) => (
        <Tag color={STAGE_COLORS[stage || 'preprocessing']}>
          {STAGE_LABELS[stage || 'preprocessing']}
        </Tag>
      )
    },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: string) => <Tag color={woStatusMap[s]?.color}>{woStatusMap[s]?.label}</Tag> },
    { title: '操作', key: 'action', render: (_: any, record: any) => <Button type="primary" onClick={() => openReport(record)}>报工</Button> },
  ];

  return (
    <Card title="工序报工">
      <Table dataSource={activeOrders} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} scroll={{ x: 900 }} />

      <Modal
        title={`报工 - ${selectedWo?.wo_no || ''} (${selectedWo?.product_name || ''})`}
        open={reportVisible}
        onCancel={() => setReportVisible(false)}
        width={800}
        footer={[
          <Button key="close" onClick={() => setReportVisible(false)}>关闭</Button>,
          <Button key="complete" type="primary" danger onClick={handleComplete}>完工</Button>,
        ]}
      >
        <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
          <Descriptions.Item label="数量">{selectedWo?.qty}</Descriptions.Item>
          <Descriptions.Item label="状态"><Tag color={woStatusMap[selectedWo?.status]?.color}>{woStatusMap[selectedWo?.status]?.label}</Tag></Descriptions.Item>
        </Descriptions>

        {/* 产线阶段进度 */}
        <Card size="small" title="产线阶段" style={{ marginBottom: 16 }}>
          <Steps
            current={getCurrentStageIndex(selectedWo?.production_stage)}
            size="small"
            items={[
              { title: '前置工序', status: getCurrentStageIndex(selectedWo?.production_stage) >= 0 ? 'finish' : 'wait' },
              { title: '制作', status: getCurrentStageIndex(selectedWo?.production_stage) >= 1 ? 'finish' : 'wait' },
              { title: '包装', status: getCurrentStageIndex(selectedWo?.production_stage) >= 2 ? 'finish' : 'wait' },
              { title: '分拣', status: getCurrentStageIndex(selectedWo?.production_stage) >= 3 ? 'finish' : 'wait' },
            ]}
          />
          <Divider style={{ margin: '12px 0' }} />
          <Space>
            <span>流转至：</span>
            {getCurrentStageIndex(selectedWo?.production_stage) < 0 && (
              <Button size="small" type="primary" onClick={() => handleAdvanceStage('preprocessing')}>前置工序</Button>
            )}
            {getCurrentStageIndex(selectedWo?.production_stage) < 1 && (
              <Button size="small" type="primary" onClick={() => handleAdvanceStage('production')}>制作</Button>
            )}
            {getCurrentStageIndex(selectedWo?.production_stage) < 2 && (
              <Button size="small" type="primary" onClick={() => handleAdvanceStage('packaging')}>包装</Button>
            )}
            {getCurrentStageIndex(selectedWo?.production_stage) < 3 && (
              <Button size="small" type="primary" onClick={() => handleAdvanceStage('sorting')}>分拣</Button>
            )}
            {getCurrentStageIndex(selectedWo?.production_stage) >= 3 && (
              <Tag color="green">已完成所有产线</Tag>
            )}
          </Space>
        </Card>

        <Card size="small" title="已报工工序" style={{ marginBottom: 16 }}>
          {operations.length === 0 ? <span style={{ color: '#999' }}>暂无报工记录</span> : (
            <List size="small" dataSource={operations} renderItem={(op: any) => (
              <List.Item>
                <Space>
                  <Tag color="blue">工序{op.seq}</Tag>
                  <span>{op.op_name}</span>
                  <span>完成 {op.qty_completed} 件</span>
                </Space>
              </List.Item>
            )} />
          )}
        </Card>

        <Card size="small" title="新增报工">
          <Form form={form} layout="inline" onFinish={handleReport}>
            <Form.Item name="seq" label="工序序号" rules={[{ required: true }]}>
              <InputNumber min={1} style={{ width: 80 }} />
            </Form.Item>
            <Form.Item name="opName" label="工序名称" rules={[{ required: true }]}>
              <Input style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="qtyCompleted" label="完成数量" rules={[{ required: true }]}>
              <InputNumber min={1} style={{ width: 80 }} />
            </Form.Item>
            <Form.Item name="remark" label="备注">
              <Input style={{ width: 120 }} />
            </Form.Item>
            <Form.Item><Button type="primary" htmlType="submit">提交报工</Button></Form.Item>
          </Form>
        </Card>
      </Modal>
    </Card>
  );
};

export default FabOperations;
