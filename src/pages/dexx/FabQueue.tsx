import { useEffect, useState } from 'react';
import { Card, Table, Button, Modal, message, Tag, Space, Steps, Divider } from 'antd';
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
};

const FabQueue = () => {
  const [queue, setQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [stageModalVisible, setStageModalVisible] = useState(false);
  const [selectedWo, setSelectedWo] = useState<any>(null);

  const fetchQueue = async () => {
    setLoading(true);
    try {
      const res = await api.get('/dexx/fab/queue');
      setQueue(res.items || []);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchQueue(); }, []);

  const handleAccept = async (id: number) => {
    try {
      await api.post('/dexx/fab/accept', { workOrderId: id });
      message.success('已接单');
      fetchQueue();
    } catch (err: any) {
      message.error(err?.error || '接单失败');
    }
  };

  const openStageModal = (wo: any) => {
    setSelectedWo(wo);
    setStageModalVisible(true);
  };

  const handleAdvanceStage = async (targetStage: string) => {
    try {
      const res = await api.post('/dexx/fab/stage/advance', { 
        workOrderId: selectedWo.id, 
        targetStage 
      });
      message.success(res.message || `已流转至${STAGE_LABELS[targetStage]}产线`);
      fetchQueue();
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
    { 
      title: '操作', 
      key: 'action', 
      render: (_: any, record: any) => (
        <Space>
          {record.status === 'pending' && (
            <Button type="primary" onClick={() => handleAccept(record.id)}>接单</Button>
          )}
          {record.status === 'in_progress' && (
            <Button onClick={() => openStageModal(record)}>产线流转</Button>
          )}
        </Space>
      )
    },
  ];

  return (
    <Card title="FAB 工作台">
      <Table dataSource={queue} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 10 }} scroll={{ x: 900 }} />

      <Modal
        title={`产线流转 - ${selectedWo?.wo_no || ''}`}
        open={stageModalVisible}
        onCancel={() => setStageModalVisible(false)}
        footer={[<Button key="close" onClick={() => setStageModalVisible(false)}>关闭</Button>]}
        width={600}
      >
        <Steps
          current={getCurrentStageIndex(selectedWo?.production_stage)}
          size="small"
          style={{ marginBottom: 24 }}
          items={[
            { title: '前置工序' },
            { title: '制作' },
            { title: '包装' },
            { title: '分拣' },
          ]}
        />
        <Divider />
        <Space wrap>
          <span>流转至：</span>
          {getCurrentStageIndex(selectedWo?.production_stage) < 0 && (
            <Button type="primary" onClick={() => handleAdvanceStage('preprocessing')}>前置工序</Button>
          )}
          {getCurrentStageIndex(selectedWo?.production_stage) < 1 && (
            <Button type="primary" onClick={() => handleAdvanceStage('production')}>制作</Button>
          )}
          {getCurrentStageIndex(selectedWo?.production_stage) < 2 && (
            <Button type="primary" onClick={() => handleAdvanceStage('packaging')}>包装</Button>
          )}
          {getCurrentStageIndex(selectedWo?.production_stage) < 3 && (
            <Button type="primary" onClick={() => handleAdvanceStage('sorting')}>分拣</Button>
          )}
          {getCurrentStageIndex(selectedWo?.production_stage) >= 3 && (
            <Tag color="green">已完成所有产线</Tag>
          )}
        </Space>
      </Modal>
    </Card>
  );
};

export default FabQueue;
