import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Table, Tag, Button, Space, message } from 'antd';
import { TeamOutlined, ThunderboltOutlined, DashboardOutlined, PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';
import { ExecutionStatusBar } from '../../components/booth/ExecutionStatusBar';
import { KpiCard } from '../../components/booth/KpiCard';
import { EmptyState } from '../../components/booth/EmptyState';

interface OverviewData {
  admissions: { status: string; count: string }[];
  strategies: { total: string; active: string };
  capacity: { status: string; count: string; total_cap: string; alloc_cap: string }[];
}

const EmDashboard: React.FC = () => {
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadOverview();
  }, []);

  const loadOverview = async () => {
    try {
      const res = await api.get('/em/overview');
      setOverview(res.data);
    } catch (err) {
      message.error('加载概览数据失败');
    } finally {
      setLoading(false);
    }
  };

  const admissionStats = overview?.admissions || [];
  const totalAdmissions = admissionStats.reduce((sum, s) => sum + parseInt(s.count), 0);
  const admittedCount = admissionStats.find(s => s.status === 'admitted')?.count || '0';
  const pendingCount = admissionStats.find(s => s.status === 'applied')?.count || '0';

  const capacityStats = overview?.capacity || [];
  const totalCapacity = capacityStats.reduce((sum, s) => sum + parseFloat(s.total_cap || '0'), 0);
  const allocatedCapacity = capacityStats.reduce((sum, s) => sum + parseFloat(s.alloc_cap || '0'), 0);
  const utilizationRate = totalCapacity > 0 ? ((allocatedCapacity / totalCapacity) * 100) : 0;

  // 计算待履约单数（从产能规划中统计）
  const pendingFulfillment = capacityStats.reduce((sum, s) => sum + parseInt(s.count), 0);
  
  // 计算准时率（模拟值，实际应从后端获取）
  const onTimeRate = 96.4;
  
  // 计算异常预警数
  const alertCount = utilizationRate > 100 ? 1 : 0;

  const hasData = totalAdmissions > 0 || totalCapacity > 0;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0, color: '#1F3A5F', fontSize: 21, fontWeight: 600 }}>EM 供应链概览</h2>
        <p style={{ color: '#6B7280', margin: '8px 0 0', fontSize: 14 }}>生态级供给运营全局视图</p>
      </div>

      {/* 顶部执行状态条 */}
      <ExecutionStatusBar
        capacityLoad={utilizationRate}
        pendingFulfillment={pendingFulfillment}
        alertCount={alertCount}
        onTimeRate={onTimeRate}
        onCapacityClick={() => navigate('/em/capacity-plans')}
        onPendingClick={() => navigate('/em/capacity-plans')}
        onAlertClick={() => navigate('/em/capacity-resources')}
      />

      {/* KPI 卡片 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard
            title="供应商总数"
            value={totalAdmissions}
            unit="家"
            icon={<TeamOutlined />}
            subtitle={`已准入 ${admittedCount} / 待审核 ${pendingCount}`}
            tags={
              <Space size={4}>
                <Tag color="#16A37B" style={{ margin: 0 }}>已准入 {admittedCount}</Tag>
                <Tag color="#D97B1F" style={{ margin: 0 }}>待审核 {pendingCount}</Tag>
              </Space>
            }
            onClick={() => navigate('/em/admissions')}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard
            title="供给策略"
            value={overview?.strategies?.total || 0}
            unit="个"
            icon={<ThunderboltOutlined />}
            subtitle={`生效中 ${overview?.strategies?.active || 0}`}
            tags={<Tag color="#2F6BFF" style={{ margin: 0 }}>生效中 {overview?.strategies?.active || 0}</Tag>}
            onClick={() => navigate('/em/supply-strategies')}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard
            title="产能利用率"
            value={utilizationRate.toFixed(1)}
            unit="%"
            icon={<DashboardOutlined />}
            progressPercent={utilizationRate}
            progressType="capacity"
            subtitle={`已分配 ${allocatedCapacity.toFixed(0)} / 总产能 ${totalCapacity.toFixed(0)}`}
            onClick={() => navigate('/em/capacity-plans')}
          />
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <KpiCard
            title="产能规划"
            value={capacityStats.reduce((sum, s) => sum + parseInt(s.count), 0)}
            unit="个"
            icon={<DashboardOutlined />}
            subtitle={`生效中 ${capacityStats.find(s => s.status === 'active')?.count || '0'}`}
            tags={<Tag color="#16A37B" style={{ margin: 0 }}>生效中 {capacityStats.find(s => s.status === 'active')?.count || '0'}</Tag>}
            onClick={() => navigate('/em/capacity-plans')}
          />
        </Col>
      </Row>

      {/* 空态引导 */}
      {!hasData && !loading && (
        <div style={{ marginTop: 24 }}>
          <EmptyState
            title="开始配置供给系统"
            description="当前还没有供应商和产能数据，请先完成供应商准入和产能规划配置"
            actions={[
              {
                label: '管理准入',
                icon: <PlusOutlined />,
                onClick: () => navigate('/em/admissions'),
                type: 'primary',
              },
              {
                label: '管理产能',
                icon: <PlusOutlined />,
                onClick: () => navigate('/em/capacity-plans'),
              },
            ]}
          />
        </div>
      )}

      {/* 数据表格 */}
      {hasData && (
        <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
          <Col xs={24} lg={12}>
            <Card
              title={<span style={{ color: '#1F3A5F', fontSize: 16 }}>供应商准入状态</span>}
              extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/em/admissions')}>管理准入</Button>}
              styles={{ header: { borderBottom: '1px solid #E5E9F0' } }}
            >
              <Table
                dataSource={admissionStats}
                rowKey="status"
                pagination={false}
                size="small"
                loading={loading}
                columns={[
                  {
                    title: '状态',
                    dataIndex: 'status',
                    render: (status: string) => {
                      const statusMap: Record<string, { text: string; color: string }> = {
                        applied: { text: '已申请', color: '#D97B1F' },
                        reviewed: { text: '已审核', color: '#2F6BFF' },
                        admitted: { text: '已准入', color: '#16A37B' },
                        rejected: { text: '已拒绝', color: '#C63A3A' },
                        exited: { text: '已退出', color: '#9CA3AF' },
                      };
                      const s = statusMap[status] || { text: status, color: '#9CA3AF' };
                      return <Tag color={s.color}>{s.text}</Tag>;
                    },
                  },
                  { 
                    title: '数量', 
                    dataIndex: 'count',
                    align: 'right',
                    render: (val: string) => (
                      <span style={{ fontFamily: "'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, monospace", fontWeight: 500 }}>
                        {val}
                      </span>
                    ),
                  },
                ]}
              />
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card
              title={<span style={{ color: '#1F3A5F', fontSize: 16 }}>产能规划状态</span>}
              extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/em/capacity-plans')}>管理产能</Button>}
              styles={{ header: { borderBottom: '1px solid #E5E9F0' } }}
            >
              <Table
                dataSource={capacityStats}
                rowKey="status"
                pagination={false}
                size="small"
                loading={loading}
                columns={[
                  {
                    title: '状态',
                    dataIndex: 'status',
                    render: (status: string) => {
                      const statusMap: Record<string, { text: string; color: string }> = {
                        draft: { text: '草稿', color: '#9CA3AF' },
                        active: { text: '生效中', color: '#16A37B' },
                        expired: { text: '已过期', color: '#D97B1F' },
                        archived: { text: '已归档', color: '#6B7280' },
                      };
                      const s = statusMap[status] || { text: status, color: '#9CA3AF' };
                      return <Tag color={s.color}>{s.text}</Tag>;
                    },
                  },
                  { 
                    title: '数量', 
                    dataIndex: 'count',
                    align: 'right',
                    render: (val: string) => (
                      <span style={{ fontFamily: "'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, monospace", fontWeight: 500 }}>
                        {val}
                      </span>
                    ),
                  },
                  { 
                    title: '总产能', 
                    dataIndex: 'total_cap',
                    align: 'right',
                    render: (val: string) => (
                      <span style={{ fontFamily: "'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, monospace" }}>
                        {parseFloat(val || '0').toFixed(0)}
                      </span>
                    ),
                  },
                  { 
                    title: '已分配', 
                    dataIndex: 'alloc_cap',
                    align: 'right',
                    render: (val: string) => (
                      <span style={{ fontFamily: "'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, monospace" }}>
                        {parseFloat(val || '0').toFixed(0)}
                      </span>
                    ),
                  },
                ]}
              />
            </Card>
          </Col>
        </Row>
      )}
    </div>
  );
};

export default EmDashboard;
