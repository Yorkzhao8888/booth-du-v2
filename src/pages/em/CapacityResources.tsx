import React, { useEffect, useState, useCallback } from 'react';
import { Card, Table, Button, Tag, Space, Modal, Form, Input, Select, InputNumber, message, Tabs, Progress, Descriptions, Popconfirm, Row, Col, Statistic, Tooltip } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, DashboardOutlined, AlertOutlined, CheckCircleOutlined, WarningOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { api } from '../../api';

const resourceTypeMap: Record<string, string> = {
  line: '产线',
  station: '工位',
  labor: '人力',
};

const statusMap: Record<string, { color: string; label: string }> = {
  active: { color: 'success', label: '启用' },
  inactive: { color: 'default', label: '停用' },
  maintenance: { color: 'warning', label: '维护中' },
};

// Booth 色板
const BOOTH_COLORS = {
  primary: '#1F3A5F',
  action: '#2F6BFF',
  amber: '#C9A227',
  success: '#16A37B',
  warning: '#D97B1F',
  error: '#C63A3A',
  bgLight: '#F5F7FA',
  textSecondary: '#6B7A8D',
};

// 负荷率阈值颜色
const getLoadRateColor = (rate: number): string => {
  if (rate > 100) return BOOTH_COLORS.error;
  if (rate > 80) return BOOTH_COLORS.warning;
  return BOOTH_COLORS.success;
};

const getLoadRateStatus = (rate: number): 'success' | 'normal' | 'exception' => {
  if (rate > 100) return 'exception';
  if (rate > 80) return 'normal';
  return 'success';
};

const EmCapacityResources: React.FC = () => {
  const [resources, setResources] = useState<any[]>([]);
  const [loadData, setLoadData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [editResource, setEditResource] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [form] = Form.useForm();

  const fetchResources = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/em/capacity-resources');
      setResources(res.items || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  }, []);

  const fetchLoad = useCallback(async () => {
    try {
      const res = await api.get('/em/capacity-load');
      setLoadData(res.items || []);
    } catch (e) { /* ignore */ }
  }, []);

  useEffect(() => { fetchResources(); fetchLoad(); }, [fetchResources, fetchLoad]);

  const handleSubmit = async (values: any) => {
    try {
      if (editResource) {
        await api.put(`/em/capacity-resources/${editResource.id}`, values);
        message.success('更新成功');
      } else {
        await api.post('/em/capacity-resources', values);
        message.success('创建成功');
      }
      setCreateVisible(false);
      setEditResource(null);
      form.resetFields();
      fetchResources();
      fetchLoad();
    } catch (e: any) { message.error(e.message || '操作失败'); }
  };

  const handleDelete = async (id: number) => {
    try {
      await api.delete(`/em/capacity-resources/${id}`);
      message.success('已删除');
      fetchResources();
      fetchLoad();
    } catch (e: any) { message.error(e.message || '删除失败'); }
  };

  // 计算总览统计
  const overviewStats = {
    totalResources: resources.length,
    activeResources: resources.filter(r => r.status === 'active').length,
    avgLoadRate: loadData.length > 0 ? Math.round(loadData.reduce((sum, l) => sum + (l.load_rate || 0), 0) / loadData.length) : 0,
    overloadedCount: loadData.filter(l => (l.load_rate || 0) > 100).length,
    warningCount: loadData.filter(l => (l.load_rate || 0) > 80 && (l.load_rate || 0) <= 100).length,
  };

  const columns = [
    { title: '资源编码', dataIndex: 'resource_code', width: 120, render: (v: string) => <span className="booth-mono">{v}</span> },
    { title: '资源名称', dataIndex: 'resource_name', width: 140 },
    { title: '类型', dataIndex: 'resource_type', width: 80, render: (v: string) => resourceTypeMap[v] || v },
    { title: '容量上限', dataIndex: 'traffic_cap', width: 90, render: (v: number) => <span className="booth-mono">{v}</span> },
    { title: '单位', dataIndex: 'unit', width: 90 },
    { title: '日工时', dataIndex: 'shift_hours_per_day', width: 80, render: (v: number) => <span className="booth-mono">{v}h</span> },
    { title: '效率', dataIndex: 'efficiency_rate', width: 70, render: (v: number) => <span className="booth-mono">{Math.round(v * 100)}%</span> },
    { title: '状态', dataIndex: 'status', width: 80, render: (v: string) => <Tag color={statusMap[v]?.color}>{statusMap[v]?.label || v}</Tag> },
    {
      title: '操作', key: 'action', width: 140,
      render: (_: any, r: any) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => { setEditResource(r); form.setFieldsValue(r); setCreateVisible(true); }}>编辑</Button>
          <Popconfirm title="确认删除?" onConfirm={() => handleDelete(r.id)}><Button size="small" danger icon={<DeleteOutlined />} /></Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      {/* 产能负荷总览区 */}
      <Card style={{ marginBottom: 16, background: `linear-gradient(135deg, ${BOOTH_COLORS.primary} 0%, #2D4A7A 100%)`, border: 'none' }}>
        <Row gutter={24}>
          <Col span={6}>
            <Statistic
              title={<span style={{ color: 'rgba(255,255,255,0.7)' }}>资源总数</span>}
              value={overviewStats.totalResources}
              valueStyle={{ color: '#fff', fontFamily: 'SFMono-Regular, JetBrains Mono, monospace' }}
              prefix={<DashboardOutlined style={{ color: BOOTH_COLORS.amber }} />}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title={<span style={{ color: 'rgba(255,255,255,0.7)' }}>平均负荷率</span>}
              value={overviewStats.avgLoadRate}
              suffix="%"
              valueStyle={{ color: getLoadRateColor(overviewStats.avgLoadRate), fontFamily: 'SFMono-Regular, JetBrains Mono, monospace' }}
              prefix={overviewStats.avgLoadRate > 100 ? <CloseCircleOutlined /> : overviewStats.avgLoadRate > 80 ? <WarningOutlined /> : <CheckCircleOutlined style={{ color: BOOTH_COLORS.success }} />}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title={<span style={{ color: 'rgba(255,255,255,0.7)' }}>超负荷资源</span>}
              value={overviewStats.overloadedCount}
              valueStyle={{ color: overviewStats.overloadedCount > 0 ? BOOTH_COLORS.error : '#fff', fontFamily: 'SFMono-Regular, JetBrains Mono, monospace' }}
              prefix={<AlertOutlined style={{ color: overviewStats.overloadedCount > 0 ? BOOTH_COLORS.error : 'rgba(255,255,255,0.5)' }} />}
            />
          </Col>
          <Col span={6}>
            <Statistic
              title={<span style={{ color: 'rgba(255,255,255,0.7)' }}>预警资源</span>}
              value={overviewStats.warningCount}
              valueStyle={{ color: overviewStats.warningCount > 0 ? BOOTH_COLORS.warning : '#fff', fontFamily: 'SFMono-Regular, JetBrains Mono, monospace' }}
              prefix={<WarningOutlined style={{ color: overviewStats.warningCount > 0 ? BOOTH_COLORS.warning : 'rgba(255,255,255,0.5)' }} />}
            />
          </Col>
        </Row>
      </Card>

      {/* 每资源负荷进度条 */}
      {loadData.length > 0 && (
        <Card title="产能负荷总览" style={{ marginBottom: 16 }}>
          <Row gutter={[16, 16]}>
            {loadData.map((item: any) => {
              const loadRate = item.load_rate || 0;
              const color = getLoadRateColor(loadRate);
              return (
                <Col span={12} key={item.id}>
                  <Card size="small" style={{ borderLeft: `3px solid ${color}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div>
                        <span style={{ fontWeight: 500 }}>{item.resource_name}</span>
                        <Tag style={{ marginLeft: 8 }}>{resourceTypeMap[item.resource_type] || item.resource_type}</Tag>
                      </div>
                      <span className="booth-mono" style={{ fontSize: 18, fontWeight: 600, color }}>
                        {loadRate}%
                      </span>
                    </div>
                    <Progress
                      percent={Math.min(loadRate, 100)}
                      strokeColor={color}
                      showInfo={false}
                      size={['100%', 8]}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 12, color: BOOTH_COLORS.textSecondary }}>
                      <span>已分配: <span className="booth-mono" style={{ color: BOOTH_COLORS.primary }}>{item.total_load || 0}</span></span>
                      <span>总产能: <span className="booth-mono">{item.daily_capacity || 0}</span></span>
                      <span>剩余: <span className="booth-mono" style={{ color: item.remaining_capacity < 0 ? BOOTH_COLORS.error : BOOTH_COLORS.success }}>{item.remaining_capacity || 0}</span></span>
                    </div>
                    {loadRate > 100 && (
                      <div style={{ marginTop: 8, padding: '4px 8px', background: '#FFF2F0', borderRadius: 4, fontSize: 12, color: BOOTH_COLORS.error }}>
                        <AlertOutlined style={{ marginRight: 4 }} />
                        超负荷 {loadRate - 100}%，建议排队或调配产能
                      </div>
                    )}
                  </Card>
                </Col>
              );
            })}
          </Row>
        </Card>
      )}

      <Card>
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
          {
            key: 'overview',
            label: '负荷总览',
            children: (
              <div>
                {loadData.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 40, color: BOOTH_COLORS.textSecondary }}>
                    <DashboardOutlined style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }} />
                    <p>暂无负荷数据</p>
                    <p style={{ fontSize: 12 }}>请先创建产能资源并录入负荷数据</p>
                  </div>
                ) : (
                  <Table
                    dataSource={loadData}
                    rowKey="id"
                    pagination={false}
                    scroll={{ x: 800 }}
                    columns={[
                      { title: '资源', width: 160, render: (_: any, r: any) => <span className="booth-mono">{r.resource_code}</span> },
                      { title: '名称', dataIndex: 'resource_name', width: 140 },
                      { title: '类型', dataIndex: 'resource_type', width: 80, render: (v: string) => resourceTypeMap[v] || v },
                      { title: '日产能', dataIndex: 'daily_capacity', width: 90, render: (v: number) => <span className="booth-mono">{v}</span> },
                      { title: '当前负荷', dataIndex: 'total_load', width: 90, render: (v: number) => <span className="booth-mono">{v}</span> },
                      {
                        title: '负荷率', dataIndex: 'load_rate', width: 180,
                        render: (v: number) => (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Progress
                              percent={Math.min(v, 100)}
                              size="small"
                              strokeColor={getLoadRateColor(v)}
                              style={{ flex: 1, margin: 0 }}
                            />
                            <span className="booth-mono" style={{ color: getLoadRateColor(v), fontWeight: 500, minWidth: 45 }}>{v}%</span>
                          </div>
                        ),
                      },
                      { title: '剩余产能', dataIndex: 'remaining_capacity', width: 90, render: (v: number) => <span className="booth-mono" style={{ color: v < 0 ? BOOTH_COLORS.error : BOOTH_COLORS.success }}>{v}</span> },
                    ]}
                  />
                )}
              </div>
            ),
          },
          {
            key: 'resources',
            label: '资源列表',
            children: (
              <>
                <div style={{ marginBottom: 16 }}>
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => { setEditResource(null); form.resetFields(); form.setFieldsValue({ resourceType: 'line', unit: '件/小时', shiftHoursPerDay: 8, efficiencyRate: 1 }); setCreateVisible(true); }}>新增资源</Button>
                </div>
                <Table dataSource={resources} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 20 }} scroll={{ x: 1000 }} />
              </>
            ),
          },
        ]} />
      </Card>

      <Modal title={editResource ? '编辑产能资源' : '新增产能资源'} open={createVisible} onCancel={() => { setCreateVisible(false); setEditResource(null); }} onOk={() => form.submit()} width={520}>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="resourceCode" label="资源编码" rules={[{ required: true }]}><Input disabled={!!editResource} /></Form.Item>
          <Form.Item name="resourceName" label="资源名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="resourceType" label="资源类型" rules={[{ required: true }]}>
            <Select options={[{ value: 'line', label: '产线' }, { value: 'station', label: '工位' }, { value: 'labor', label: '人力' }]} />
          </Form.Item>
          <Form.Item name="trafficCap" label="容量上限 (traffic_cap)" rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="unit" label="产能单位"><Input placeholder="件/小时" /></Form.Item>
          <Form.Item name="shiftHoursPerDay" label="每日有效工时"><InputNumber min={1} max={24} step={0.5} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="efficiencyRate" label="效率系数"><InputNumber min={0} max={1} step={0.05} style={{ width: '100%' }} /></Form.Item>
          {editResource && (
            <Form.Item name="status" label="状态">
              <Select options={[{ value: 'active', label: '启用' }, { value: 'inactive', label: '停用' }, { value: 'maintenance', label: '维护中' }]} />
            </Form.Item>
          )}
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default EmCapacityResources;
