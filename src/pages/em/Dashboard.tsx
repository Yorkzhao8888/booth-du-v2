import React, { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, Table, Tag, Button, Space, message } from 'antd';
import { TeamOutlined, ThunderboltOutlined, DashboardOutlined, PlusOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api';

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
  const utilizationRate = totalCapacity > 0 ? ((allocatedCapacity / totalCapacity) * 100).toFixed(1) : '0';

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ margin: 0 }}>EM 供应链概览</h2>
        <p style={{ color: '#666', margin: '8px 0 0' }}>生态级供给运营全局视图</p>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="供应商总数"
              value={totalAdmissions}
              prefix={<TeamOutlined />}
              suffix="家"
            />
            <div style={{ marginTop: 8 }}>
              <Tag color="green">已准入 {admittedCount}</Tag>
              <Tag color="orange">待审核 {pendingCount}</Tag>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="供给策略"
              value={overview?.strategies?.total || 0}
              prefix={<ThunderboltOutlined />}
              suffix="个"
            />
            <div style={{ marginTop: 8 }}>
              <Tag color="blue">生效中 {overview?.strategies?.active || 0}</Tag>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="产能利用率"
              value={utilizationRate}
              prefix={<DashboardOutlined />}
              suffix="%"
            />
            <div style={{ marginTop: 8 }}>
              <span style={{ fontSize: 12, color: '#666' }}>
                已分配 {allocatedCapacity.toFixed(0)} / 总产能 {totalCapacity.toFixed(0)}
              </span>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="产能规划"
              value={capacityStats.reduce((sum, s) => sum + parseInt(s.count), 0)}
              prefix={<DashboardOutlined />}
              suffix="个"
            />
            <div style={{ marginTop: 8 }}>
              <Tag color="green">生效中 {capacityStats.find(s => s.status === 'active')?.count || '0'}</Tag>
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col xs={24} lg={12}>
          <Card
            title="供应商准入状态"
            extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/em/admissions')}>管理准入</Button>}
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
                      applied: { text: '已申请', color: 'orange' },
                      reviewed: { text: '已审核', color: 'blue' },
                      admitted: { text: '已准入', color: 'green' },
                      rejected: { text: '已拒绝', color: 'red' },
                      exited: { text: '已退出', color: 'default' },
                    };
                    const s = statusMap[status] || { text: status, color: 'default' };
                    return <Tag color={s.color}>{s.text}</Tag>;
                  },
                },
                { title: '数量', dataIndex: 'count' },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title="产能规划状态"
            extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/em/capacity-plans')}>管理产能</Button>}
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
                      draft: { text: '草稿', color: 'default' },
                      active: { text: '生效中', color: 'green' },
                      completed: { text: '已完成', color: 'blue' },
                      cancelled: { text: '已取消', color: 'red' },
                    };
                    const s = statusMap[status] || { text: status, color: 'default' };
                    return <Tag color={s.color}>{s.text}</Tag>;
                  },
                },
                { title: '数量', dataIndex: 'count' },
                {
                  title: '总产能',
                  dataIndex: 'total_cap',
                  render: (v: string) => parseFloat(v || '0').toFixed(0),
                },
                {
                  title: '已分配',
                  dataIndex: 'alloc_cap',
                  render: (v: string) => parseFloat(v || '0').toFixed(0),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Card style={{ marginTop: 24 }}>
        <Space size="large">
          <Button size="large" onClick={() => navigate('/em/admissions')}>供应商准入管理</Button>
          <Button size="large" onClick={() => navigate('/em/strategies')}>供给策略配置</Button>
          <Button size="large" onClick={() => navigate('/em/capacity-plans')}>产能规划管理</Button>
        </Space>
      </Card>
    </div>
  );
};

export default EmDashboard;
