import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Col, Row, Statistic, Typography } from 'antd';
import {
  OrderedListOutlined,
  PartitionOutlined,
  ToolOutlined,
  ShoppingOutlined,
  ShopOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { apiGet } from '../../api';
import PageState from '../../components/PageState';

/**
 * [W1-SIMPLIFY] AU 店长独立工作台 —— operator（AU→dx）登录分流落点
 * 演示卡描述「店长台 · 经营与履约管理」与落地一致；不再经 /du。
 */
interface DashStats {
  todayOrders?: number;
  todayRevenue?: number;
  pendingWorkOrders?: number;
  preparingWorkOrders?: number;
  lowStockCount?: number;
}

const QUICK_LINKS: Array<{ path: string; icon: ReactNode; title: string; desc: string }> = [
  { path: '/du/orders', icon: <OrderedListOutlined />, title: '订单管理', desc: '对客订单与履约状态' },
  { path: '/du/production-orders', icon: <PartitionOutlined />, title: '生产单全链路', desc: '拆单/工单/回执三级链路' },
  { path: '/du/work-orders', icon: <ToolOutlined />, title: '工单管理', desc: '工单调度与进度' },
  { path: '/du/purchase-orders', icon: <ShoppingOutlined />, title: '采购管理', desc: '采购单与到货' },
  { path: '/du/suppliers', icon: <ShopOutlined />, title: '供应商管理', desc: '供应铺档案与能力' },
  { path: '/du/supply-orders', icon: <DatabaseOutlined />, title: '供给订单', desc: '供货契约与结算' },
  { path: '/du/batches', icon: <DeploymentUnitOutlined />, title: '批次库存', desc: '批次/四仓/效期/预警' },
  { path: '/du/onboarding', icon: <RocketOutlined />, title: '开通向导', desc: '铺信息/模板/演示数据' },
];

export default function AUWorkbench() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await apiGet<DashStats>('/du/dashboard');
      setStats(res ?? {});
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div style={{ padding: 24 }}>
      <Card style={{ marginBottom: 16, background: 'linear-gradient(135deg, #1F3A5F 0%, #2C4E7A 100%)', border: 'none' }}>
        <Typography.Title level={4} style={{ color: '#fff', margin: 0 }}>
          店长台 · 经营与履约管理
        </Typography.Title>
        <div style={{ color: 'rgba(255,255,255,0.72)', marginTop: 4, fontSize: 13 }}>
          AU 店长视角 · 履约盯办与经营速览 · 快捷入口一步直达
        </div>
      </Card>

      <PageState loading={loading} error={loadError} onRetry={fetchData} skeletonRows={3}>
        <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
          <Col xs={12} lg={6}>
            <Card hoverable onClick={() => navigate('/du/orders')}>
              <Statistic title="今日订单" value={stats?.todayOrders ?? 0} suffix="单" />
            </Card>
          </Col>
          <Col xs={12} lg={6}>
            <Card hoverable onClick={() => navigate('/du/work-orders')}>
              <Statistic title="待派工工单" value={stats?.pendingWorkOrders ?? 0} suffix="张" valueStyle={{ color: '#faad14' }} />
            </Card>
          </Col>
          <Col xs={12} lg={6}>
            <Card hoverable onClick={() => navigate('/du/work-orders')}>
              <Statistic title="执行中工单" value={stats?.preparingWorkOrders ?? 0} suffix="张" valueStyle={{ color: '#1890ff' }} />
            </Card>
          </Col>
          <Col xs={12} lg={6}>
            <Card hoverable onClick={() => navigate('/du/batches?tab=alerts')}>
              <Statistic title="库存预警" value={stats?.lowStockCount ?? 0} suffix="项" valueStyle={{ color: stats?.lowStockCount ? '#ff4d4f' : '#52c41a' }} />
            </Card>
          </Col>
        </Row>
      </PageState>

      <Row gutter={[16, 16]}>
        {QUICK_LINKS.map((l) => (
          <Col xs={12} sm={8} lg={6} key={l.path}>
            <Card
              hoverable
              style={{ height: '100%' }}
              onClick={() => navigate(l.path)}
            >
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 22, color: '#1F3A5F', lineHeight: '30px' }}>{l.icon}</span>
                <div>
                  <div style={{ fontWeight: 600 }}>{l.title}</div>
                  <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 2 }}>{l.desc}</div>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
