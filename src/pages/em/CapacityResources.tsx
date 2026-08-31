import React, { useEffect, useState, useCallback } from 'react';
import { Card, Table, Button, Tag, Space, Modal, Form, Input, Select, InputNumber, message, Tabs, Progress, Descriptions, Popconfirm } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, DashboardOutlined } from '@ant-design/icons';
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

const EmCapacityResources: React.FC = () => {
  const [resources, setResources] = useState<any[]>([]);
  const [loadData, setLoadData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [editResource, setEditResource] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('resources');
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

  const columns = [
    { title: '资源编码', dataIndex: 'resource_code', width: 120 },
    { title: '资源名称', dataIndex: 'resource_name', width: 140 },
    { title: '类型', dataIndex: 'resource_type', width: 80, render: (v: string) => resourceTypeMap[v] || v },
    { title: '容量上限', dataIndex: 'traffic_cap', width: 90 },
    { title: '单位', dataIndex: 'unit', width: 90 },
    { title: '日工时', dataIndex: 'shift_hours_per_day', width: 80 },
    { title: '效率', dataIndex: 'efficiency_rate', width: 70, render: (v: number) => `${Math.round(v * 100)}%` },
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

  const loadColumns = [
    { title: '资源', width: 140, render: (_: any, r: any) => `${r.resource_name} (${r.resource_code})` },
    { title: '类型', dataIndex: 'resource_type', width: 80, render: (v: string) => resourceTypeMap[v] || v },
    { title: '日产能', dataIndex: 'daily_capacity', width: 90 },
    { title: '当前负荷', dataIndex: 'total_load', width: 90 },
    {
      title: '负荷率', dataIndex: 'load_rate', width: 160,
      render: (v: number) => (
        <Progress percent={v} size="small" status={v >= 90 ? 'exception' : v >= 70 ? 'active' : 'success'} />
      ),
    },
    { title: '剩余产能', dataIndex: 'remaining_capacity', width: 90 },
  ];

  return (
    <Card title="产能资源管理">
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
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
        {
          key: 'load',
          label: <span><DashboardOutlined /> 负荷度</span>,
          children: <Table dataSource={loadData} columns={loadColumns} rowKey="id" pagination={false} scroll={{ x: 800 }} />,
        },
      ]} />

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
    </Card>
  );
};

export default EmCapacityResources;
