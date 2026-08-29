import { useEffect, useState } from 'react';
import { Card, Row, Col, Progress, Tag, Statistic, Spin, Empty, Button, Tooltip } from 'antd';
import {
  ReloadOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { api } from '../../api';

interface WorkOrder {
  id: number;
  wo_no: string;
  product_name: string;
  qty: number;
  qty_completed: number;
  status: string;
  production_stage: string;
  priority: string;
  planned_start: string;
  planned_end: string;
  started_at: string | null;
  completed_at: string | null;
}

interface StageInfo {
  key: string;
  label: string;
  color: string;
  orders: WorkOrder[];
}

const STAGE_COLORS: Record<string, string> = {
  preprocessing: '#1890ff',
  production: '#722ed1',
  packaging: '#fa8c16',
  sorting: '#52c41a',
};

const PRIORITY_MAP: Record<string, { label: string; color: string }> = {
  low: { label: '低', color: 'default' },
  normal: { label: '普通', color: 'processing' },
  high: { label: '高', color: 'warning' },
  urgent: { label: '紧急', color: 'error' },
};

export default function ProductionDashboard() {
  const [loading, setLoading] = useState(false);
  const [stages, setStages] = useState<StageInfo[]>([]);
  const [stats, setStats] = useState({ total: 0, inProgress: 0, completed: 0, delayed: 0 });

  const fetchDashboard = async () => {
    setLoading(true);
    try {
      const res = await api.get('/dexx/fab/dashboard');
      if (res?.success) {
        const orders: WorkOrder[] = res.orders || [];
        const stageList: StageInfo[] = [
          { key: 'preprocessing', label: '前置工序', color: STAGE_COLORS.preprocessing, orders: [] },
          { key: 'production', label: '制作', color: STAGE_COLORS.production, orders: [] },
          { key: 'packaging', label: '包装', color: STAGE_COLORS.packaging, orders: [] },
          { key: 'sorting', label: '分拣', color: STAGE_COLORS.sorting, orders: [] },
        ];

        let completed = 0;
        let delayed = 0;
        const now = new Date();

        orders.forEach((wo) => {
          if (wo.status === 'completed') {
            completed++;
          } else if (wo.status === 'in_progress') {
            const stage = stageList.find((s) => s.key === wo.production_stage);
            if (stage) stage.orders.push(wo);
            // Check if delayed
            if (wo.planned_end && new Date(wo.planned_end) < now) {
              delayed++;
            }
          }
        });

        setStages(stageList);
        setStats({
          total: orders.filter((o) => o.status !== 'cancelled').length,
          inProgress: orders.filter((o) => o.status === 'in_progress').length,
          completed,
          delayed,
        });
      }
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchDashboard();
    const timer = setInterval(fetchDashboard, 30000); // Refresh every 30s
    return () => clearInterval(timer);
  }, []);

  const getProgress = (wo: WorkOrder) => {
    if (!wo.qty || wo.qty === 0) return 0;
    return Math.round(((wo.qty_completed || 0) / wo.qty) * 100);
  };

  const getTimeRemaining = (plannedEnd: string) => {
    const end = new Date(plannedEnd);
    const now = new Date();
    const diff = end.getTime() - now.getTime();
    if (diff <= 0) return { text: '已超时', isOverdue: true };
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 24) return { text: `${Math.floor(hours / 24)}天${hours % 24}小时`, isOverdue: false };
    return { text: `${hours}小时${minutes}分钟`, isOverdue: false };
  };

  return (
    <div style={{ padding: 24, background: '#f5f5f5', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>产线看板</h2>
        <Button icon={<ReloadOutlined />} onClick={fetchDashboard} loading={loading}>
          刷新
        </Button>
      </div>

      {/* Stats Overview */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic title="工单总数" value={stats.total} prefix={<ThunderboltOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="进行中" value={stats.inProgress} valueStyle={{ color: '#1890ff' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="已完成" value={stats.completed} valueStyle={{ color: '#52c41a' }} prefix={<CheckCircleOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="超时预警" value={stats.delayed} valueStyle={{ color: stats.delayed > 0 ? '#ff4d4f' : '#52c41a' }} prefix={<WarningOutlined />} />
          </Card>
        </Col>
      </Row>

      <Spin spinning={loading}>
        {stages.length === 0 && !loading ? (
          <Empty description="暂无产线数据" />
        ) : (
          <Row gutter={16}>
            {stages.map((stage) => (
              <Col span={6} key={stage.key}>
                <Card
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 12, height: 12, borderRadius: '50%', background: stage.color }} />
                      <span>{stage.label}</span>
                      <Tag color={stage.color}>{stage.orders.length}</Tag>
                    </div>
                  }
                  styles={{ body: { padding: '12px 16px', maxHeight: 600, overflowY: 'auto' } }}
                  style={{ minHeight: 400 }}
                >
                  {stage.orders.length === 0 ? (
                    <Empty description="暂无工单" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    stage.orders.map((wo) => {
                      const progress = getProgress(wo);
                      const timeInfo = wo.planned_end ? getTimeRemaining(wo.planned_end) : null;
                      const priority = PRIORITY_MAP[wo.priority] || PRIORITY_MAP.normal;

                      return (
                        <Card
                          key={wo.id}
                          size="small"
                          style={{ marginBottom: 12, borderLeft: `3px solid ${stage.color}` }}
                          styles={{ body: { padding: '8px 12px' } }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 13 }}>{wo.wo_no}</div>
                              <div style={{ fontSize: 12, color: '#666', marginTop: 2 }}>{wo.product_name}</div>
                            </div>
                            <Tag color={priority.color} style={{ marginRight: 0 }}>{priority.label}</Tag>
                          </div>

                          <div style={{ marginBottom: 8 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                              <span>进度</span>
                              <span>{wo.qty_completed || 0} / {wo.qty}</span>
                            </div>
                            <Progress
                              percent={progress}
                              size="small"
                              status={progress === 100 ? 'success' : 'active'}
                              strokeColor={stage.color}
                            />
                          </div>

                          {timeInfo && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                              <span style={{ color: '#999' }}>
                                <ClockCircleOutlined style={{ marginRight: 4 }} />
                                剩余
                              </span>
                              <span style={{ color: timeInfo.isOverdue ? '#ff4d4f' : '#52c41a', fontWeight: timeInfo.isOverdue ? 600 : 400 }}>
                                {timeInfo.text}
                              </span>
                            </div>
                          )}
                        </Card>
                      );
                    })
                  )}
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Spin>
    </div>
  );
}
