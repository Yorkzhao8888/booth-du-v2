/**
 * FAB-MES-01 保养日历（/dexx/fab/maintenance）
 * 保养计划列表 · 到期/逾期红色预警 · 一键完成保养
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Modal, Row, Segmented, Space, Statistic, Tag, Tooltip, message } from 'antd';
import { CheckCircleOutlined, ClockCircleOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api } from '../../api';
import { useAuthStore } from '../../store';
import { BOOTH, MonoNum } from '../../styles/booth';

export default function FabMaintenance() {
  const { user } = useAuthStore();
  const isReadOnly = user?.role !== 'dexx';
  const [loading, setLoading] = useState(false);
  const [plans, setPlans] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');
  const [doneTarget, setDoneTarget] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.get('/dexx/fab/maintenance/plans');
      setPlans(res.data?.data || []);
    } catch (e: any) {
      message.error(e?.response?.data?.error || '加载保养计划失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const enriched = useMemo(
    () =>
      plans.map((p: any) => {
        const due = p.next_due_at ? dayjs(p.next_due_at) : null;
        const daysLeft = due ? due.diff(dayjs(), 'day') : null;
        const isOverdue = p.status !== 'done' && due !== null && daysLeft < 0;
        const isDueSoon = p.status !== 'done' && due !== null && daysLeft >= 0 && daysLeft <= 3;
        return { ...p, daysLeft, isOverdue, isDueSoon };
      }),
    [plans]
  );

  const filtered = useMemo(() => {
    if (filter === 'overdue') return enriched.filter((p) => p.isOverdue);
    if (filter === 'due') return enriched.filter((p) => p.isOverdue || p.isDueSoon);
    if (filter === 'done') return enriched.filter((p) => p.status === 'done');
    return enriched;
  }, [enriched, filter]);

  const stats = useMemo(() => {
    const overdue = enriched.filter((p) => p.isOverdue).length;
    const dueSoon = enriched.filter((p) => p.isDueSoon).length;
    const done = enriched.filter((p) => p.status === 'done').length;
    return { total: enriched.length, overdue, dueSoon, done };
  }, [enriched]);

  const onDone = async () => {
    if (!doneTarget) return;
    try {
      await api.post(`/dexx/fab/maintenance/plans/${doneTarget.id}/done`);
      message.success(`「${doneTarget.plan_name}」保养已完成，下次保养周期已重置`);
      setDoneTarget(null);
      load();
    } catch (e: any) {
      message.error(e?.response?.data?.error || '完成保养失败');
    }
  };

  const statusTag = (p: any) => {
    if (p.status === 'done') return <Tag color="success" style={{ fontSize: 11 }}>已完成</Tag>;
    if (p.isOverdue) return <Tag color="error" style={{ fontSize: 11 }}><WarningOutlined style={{ marginRight: 2 }} />已逾期</Tag>;
    if (p.isDueSoon) return <Tag color="warning" style={{ fontSize: 11 }}><ClockCircleOutlined style={{ marginRight: 2 }} />{p.daysLeft === 0 ? '今日到期' : `${p.daysLeft} 天后到期`}</Tag>;
    return <Tag style={{ fontSize: 11 }}>待保养</Tag>;
  };

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 21, fontWeight: 700, color: BOOTH.primary }}>保养日历</div>
          <div style={{ fontSize: 12, color: BOOTH.textSub, marginTop: 4 }}>按周期追踪设备保养，逾期红色预警，避免带病作业拉低稼动率</div>
        </div>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
      </div>

      {stats.overdue > 0 && (
        <Alert
          type="error"
          showIcon
          icon={<WarningOutlined />}
          style={{ marginBottom: 16 }}
          message={`有 ${stats.overdue} 项保养已逾期`}
          description="逾期设备应尽快安排保养或先停机，避免设备劣化影响良品率与可用率。"
        />
      )}

      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col span={6}><Card size="small"><Statistic title={<span style={{ fontSize: 12 }}>计划总数</span>} value={stats.total} valueStyle={{ fontFamily: BOOTH.mono, fontSize: 22, color: BOOTH.primary }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title={<span style={{ fontSize: 12 }}>已逾期</span>} value={stats.overdue} valueStyle={{ fontFamily: BOOTH.mono, fontSize: 22, color: stats.overdue > 0 ? BOOTH.danger : BOOTH.success }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title={<span style={{ fontSize: 12 }}>3 天内到期</span>} value={stats.dueSoon} valueStyle={{ fontFamily: BOOTH.mono, fontSize: 22, color: stats.dueSoon > 0 ? BOOTH.warning : BOOTH.success }} /></Card></Col>
        <Col span={6}><Card size="small"><Statistic title={<span style={{ fontSize: 12 }}>已完成</span>} value={stats.done} valueStyle={{ fontFamily: BOOTH.mono, fontSize: 22, color: BOOTH.success }} /></Card></Col>
      </Row>

      <div style={{ marginBottom: 12 }}>
        <Segmented
          value={filter}
          onChange={(v) => setFilter(v as string)}
          options={[
            { label: '全部', value: 'all' },
            { label: '到期/逾期', value: 'due' },
            { label: '仅逾期', value: 'overdue' },
            { label: '已完成', value: 'done' },
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <Empty description={<span>暂无保养计划。设备建档时已按保养周期自动生成，也可在设备详情中手动添加。</span>} style={{ padding: 60 }} />
      ) : (
        <Row gutter={[12, 12]}>
          {filtered.map((p) => (
            <Col xs={24} sm={12} lg={8} key={p.id}>
              <Card
                size="small"
                style={{ borderTop: p.isOverdue ? `3px solid ${BOOTH.danger}` : p.isDueSoon ? `3px solid ${BOOTH.warning}` : `3px solid ${BOOTH.success}` }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{p.plan_name}</div>
                  {statusTag(p)}
                </div>
                <div style={{ fontSize: 12, color: BOOTH.textSub, marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>设备: <span style={{ color: BOOTH.textMain, fontWeight: 500 }}>{p.equipment_name || '-'}</span> <span style={{ fontFamily: BOOTH.mono, fontSize: 11 }}>{p.equipment_code || ''}</span></span>
                  <span>
                    上次保养: <MonoNum value={p.last_done_at ? dayjs(p.last_done_at).format('MM-DD') : '—'} style={{ fontSize: 12 }} />
                    <span style={{ margin: '0 6px', color: BOOTH.border }}>|</span>
                    下次到期: <MonoNum value={p.next_due_at ? dayjs(p.next_due_at).format('MM-DD') : '—'} style={{ fontSize: 12, fontWeight: 600, color: p.isOverdue ? BOOTH.danger : BOOTH.textMain }} />
                  </span>
                  <span>周期: <MonoNum value={p.cycle_days} unit="天" style={{ fontSize: 12 }} />{p.remark ? <span style={{ marginLeft: 8, color: BOOTH.textSub }}>({p.remark})</span> : null}</span>
                </div>
                {p.status !== 'done' && (
                  <Button
                    size="small"
                    type={p.isOverdue ? 'primary' : 'default'}
                    danger={p.isOverdue}
                    icon={<CheckCircleOutlined />}
                    disabled={isReadOnly} onClick={() => setDoneTarget(p)}
                    block
                  >
                    完成保养
                  </Button>
                )}
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Modal
        title={doneTarget ? `确认完成保养 — ${doneTarget.plan_name}` : ''}
        open={!!doneTarget}
        onOk={onDone}
        onCancel={() => setDoneTarget(null)}
        okText="确认完成"
        cancelText="取消"
        width={400}
      >
        <div style={{ fontSize: 13, color: BOOTH.textMain, lineHeight: 2 }}>
          <div>设备: <b>{doneTarget?.equipment_name}</b></div>
          <div>完成后：计划状态置为「已完成」，<b>下次到期日 = 今日 + {doneTarget?.cycle_days ?? '—'} 天</b>，设备档案的「上次保养」同步更新。</div>
        </div>
      </Modal>
    </div>
  );
}
