import { useEffect, useState } from 'react';
import { Card, Table, Button, Modal, message, Tag, Space, Steps, Divider } from 'antd';
import { api } from '../../api';
import PageState from '../../components/PageState';
import { TABLE_PROPS } from '../../constants/table';
import EvidenceUploadModal from '../../components/EvidenceUploadModal'; // [W1-D3] 完工上报凭证

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

// 优先级徽标颜色
const getPriorityColor = (priority: number) => {
  if (priority >= 8) return 'red';
  if (priority >= 5) return 'orange';
  if (priority >= 3) return 'gold';
  return 'default';
};

// SLA 剩余时间计算
const getSlaRemaining = (slaMinutes: number, dispatchedAt: string | null) => {
  if (!dispatchedAt) return '-';
  const start = new Date(dispatchedAt).getTime();
  const deadline = start + slaMinutes * 60 * 1000;
  const remaining = deadline - Date.now();
  if (remaining <= 0) return '已超时';
  const hours = Math.floor(remaining / (60 * 60 * 1000));
  const mins = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
};

const getSlaColor = (slaMinutes: number, dispatchedAt: string | null) => {
  if (!dispatchedAt) return 'default';
  const start = new Date(dispatchedAt).getTime();
  const deadline = start + slaMinutes * 60 * 1000;
  const remaining = deadline - Date.now();
  if (remaining <= 0) return 'red';
  if (remaining < 15 * 60 * 1000) return 'orange';
  return 'green';
};

const FabQueue = () => {
  const [queue, setQueue] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [stageModalVisible, setStageModalVisible] = useState(false);
  const [evidenceTarget, setEvidenceTarget] = useState<{ id: number; woNo: string } | null>(null); // [W1-D3]
  const [selectedWo, setSelectedWo] = useState<any>(null);

  const fetchQueue = async () => {
    setLoading(true);
    try {
      const res = await api.get('/edxx/fab/queue');
      setQueue(res.items || []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchQueue(); }, []);

  const handleAccept = async (id: number) => {
    try {
      await api.post('/edxx/fab/accept', { workOrderId: id });
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
      const res = await api.post('/edxx/fab/stage/advance', { 
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
    { title: '工单号', dataIndex: 'job_id', key: 'job_id', render: (v: string, r: any) => v || r.wo_no || '-' },
    { 
      title: '类型', 
      dataIndex: 'job_type', 
      key: 'job_type',
      render: (t: string) => t ? <Tag color="blue">{t}</Tag> : <Tag>PRODUCE</Tag>
    },
    { title: '商品', dataIndex: 'product_name', key: 'product_name' },
    { title: '数量', dataIndex: 'qty', key: 'qty' },
    { 
      title: '优先级', 
      dataIndex: 'priority', 
      key: 'priority',
      sorter: (a: any, b: any) => (a.priority || 5) - (b.priority || 5),
      render: (p: number) => p ? <Tag color={getPriorityColor(p)}>P{p}</Tag> : <Tag>P5</Tag>
    },
    { 
      title: 'SLA 剩余', 
      key: 'sla',
      render: (_: any, r: any) => r.sla_minutes ? (
        <Tag color={getSlaColor(r.sla_minutes, r.dispatched_at)}>
          {getSlaRemaining(r.sla_minutes, r.dispatched_at)}
        </Tag>
      ) : '-'
    },
    { 
      title: '工位', 
      dataIndex: 'station_name', 
      key: 'station_name',
      render: (s: string) => s || '-'
    },
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
    { 
      title: '状态', 
      dataIndex: 'status', 
      key: 'status', 
      render: (s: string) => <Tag color={woStatusMap[s]?.color || 'default'}>{woStatusMap[s]?.label || s}</Tag> 
    },
    { 
      title: '操作', 
      key: 'action', 
      render: (_: any, record: any) => (
        <Space>
          {(record.status === 'pending' || record.status === 'Dispatched') && (
            <Button type="primary" onClick={() => handleAccept(record.id)}>接单</Button>
          )}
          {(record.status === 'in_progress' || record.status === 'Running') && (
            <Button onClick={() => openStageModal(record)}>产线流转</Button>
          )}
          {(record.status === 'preparing' || record.status === 'in_progress' || record.status === 'Running') && (
            <Button type="primary" ghost onClick={() => setEvidenceTarget({ id: record.id, woNo: record.wo_no || record.job_id || String(record.id) })}>完工上报</Button>
          )}
        </Space>
      )
    },
  ];

  return (
    <Card title="FAB 工作台">
      <PageState
        loading={loading}
        error={loadError}
        empty={!loading && !loadError && queue.length === 0}
        onRetry={fetchQueue}
        emptyTitle="作业队列是空的"
        emptyDesc="订单下发拆单后, 分配给你所在产线的工单会出现在这里。现在可以先接单其他产线任务, 或等待新工单派发。"
      >
      <Table dataSource={queue} columns={columns} rowKey="id" loading={loading} {...TABLE_PROPS} scroll={{ x: 900 }} />
      </PageState>

      {/* [W1-D3] 完工上报 → G-005 凭证自动归档 + 工单自动完成 */}
      <EvidenceUploadModal
        open={!!evidenceTarget}
        workOrderId={evidenceTarget?.id ?? null}
        workOrderNo={evidenceTarget?.woNo}
        onClose={() => setEvidenceTarget(null)}
        onCompleted={fetchQueue}
      />

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
