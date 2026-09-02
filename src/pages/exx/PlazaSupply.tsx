import React, { useEffect, useState, useCallback } from 'react';
import { Card, Table, Button, Tag, Space, Modal, Form, Input, Select, InputNumber, DatePicker, message, Tabs, Descriptions } from 'antd';
import { PlusOutlined, BookOutlined, UnlockOutlined } from '@ant-design/icons';
import { api } from '../../api';

const plazaStatusMap: Record<string, { color: string; label: string }> = {
  available: { color: 'success', label: '可用' },
  booked: { color: 'processing', label: '已预订' },
  occupied: { color: 'warning', label: '占用中' },
  maintenance: { color: 'error', label: '维护中' },
};

const bookingStatusMap: Record<string, { color: string; label: string }> = {
  booked: { color: 'processing', label: '已预订' },
  checked_in: { color: 'blue', label: '已入驻' },
  released: { color: 'default', label: '已释放' },
  cancelled: { color: 'error', label: '已取消' },
};

const PlazaSupply: React.FC = () => {
  const [resources, setResources] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createResVisible, setCreateResVisible] = useState(false);
  const [bookVisible, setBookVisible] = useState(false);
  const [currentResource, setCurrentResource] = useState<any>(null);
  const [activeTab, setActiveTab] = useState('resources');
  const [resForm] = Form.useForm();
  const [bookForm] = Form.useForm();

  const fetchResources = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/exx/wh/plaza-resources');
      setResources(res.items || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  }, []);

  const fetchBookings = useCallback(async () => {
    try {
      const res = await api.get('/exx/wh/plaza-bookings');
      setBookings(res.items || []);
    } catch (e) { /* ignore */ }
  }, []);

  useEffect(() => { fetchResources(); fetchBookings(); }, [fetchResources, fetchBookings]);

  const handleCreateResource = async (values: any) => {
    try {
      await api.post('/exx/wh/plaza-resources', values);
      message.success('场地资源创建成功');
      setCreateResVisible(false);
      resForm.resetFields();
      fetchResources();
    } catch (e: any) { message.error(e.message || '创建失败'); }
  };

  const handleBook = async (values: any) => {
    if (!currentResource) return;
    try {
      await api.post(`/exx/wh/plaza-resources/${currentResource.id}/book`, {
        purpose: values.purpose,
        startAt: values.startAt?.toISOString(),
        endAt: values.endAt?.toISOString(),
        remark: values.remark,
      });
      message.success('预订成功');
      setBookVisible(false);
      bookForm.resetFields();
      fetchResources();
      fetchBookings();
    } catch (e: any) { message.error(e.message || '预订失败'); }
  };

  const handleRelease = async (bookingId: number) => {
    try {
      await api.post(`/exx/wh/plaza-bookings/${bookingId}/release`);
      message.success('已释放');
      fetchResources();
      fetchBookings();
    } catch (e: any) { message.error(e.message || '操作失败'); }
  };

  const resourceColumns = [
    { title: '资源编码', dataIndex: 'resource_code', width: 120 },
    { title: '资源名称', dataIndex: 'resource_name', width: 140 },
    { title: '类型', dataIndex: 'plaza_type', width: 100, render: (v: string) => v === 'cold_storage' ? '冷藏区' : '标准铺位' },
    { title: '面积(m²)', dataIndex: 'area_sqm', width: 90 },
    { title: '容量', dataIndex: 'capacity', width: 80 },
    { title: '位置', dataIndex: 'location', width: 100, render: (v: string) => v || '-' },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color={plazaStatusMap[v]?.color}>{plazaStatusMap[v]?.label || v}</Tag> },
    {
      title: '操作', key: 'action', width: 100,
      render: (_: any, r: any) => r.status === 'available' ? (
        <Button size="small" type="primary" icon={<BookOutlined />} onClick={() => { setCurrentResource(r); setBookVisible(true); }}>预订</Button>
      ) : null,
    },
  ];

  const bookingColumns = [
    { title: '预订号', dataIndex: 'booking_no', width: 160 },
    { title: '资源', dataIndex: 'resource_name', width: 140 },
    { title: '用途', dataIndex: 'purpose', width: 100 },
    { title: '开始', dataIndex: 'start_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    { title: '结束', dataIndex: 'end_at', width: 160, render: (v: string) => v ? new Date(v).toLocaleString() : '-' },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color={bookingStatusMap[v]?.color}>{bookingStatusMap[v]?.label || v}</Tag> },
    {
      title: '操作', key: 'action', width: 100,
      render: (_: any, r: any) => ['booked', 'checked_in'].includes(r.status) ? (
        <Button size="small" danger icon={<UnlockOutlined />} onClick={() => handleRelease(r.id)}>释放</Button>
      ) : null,
    },
  ];

  return (
    <Card title="场地供给">
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        {
          key: 'resources',
          label: '资源池',
          children: (
            <>
              <div style={{ marginBottom: 16 }}>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateResVisible(true)}>登记场地</Button>
              </div>
              <Table dataSource={resources} columns={resourceColumns} rowKey="id" loading={loading} pagination={{ pageSize: 15 }} scroll={{ x: 900 }} />
            </>
          ),
        },
        {
          key: 'bookings',
          label: '预订记录',
          children: <Table dataSource={bookings} columns={bookingColumns} rowKey="id" pagination={{ pageSize: 15 }} scroll={{ x: 900 }} />,
        },
      ]} />

      <Modal title="登记场地资源" open={createResVisible} onCancel={() => setCreateResVisible(false)} onOk={() => resForm.submit()} width={500}>
        <Form form={resForm} layout="vertical" onFinish={handleCreateResource} initialValues={{ plazaType: 'standard' }}>
          <Form.Item name="resourceCode" label="资源编码" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="resourceName" label="资源名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="plazaType" label="场地类型">
            <Select options={[{ value: 'standard', label: '标准铺位' }, { value: 'cold_storage', label: '冷藏区' }, { value: 'hot_zone', label: '热区' }, { value: 'storage', label: '仓储区' }]} />
          </Form.Item>
          <Form.Item name="areaSq" label="面积(m²)"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="capacity" label="容量"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="location" label="位置"><Input /></Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal title={`预订: ${currentResource?.resource_name || ''}`} open={bookVisible} onCancel={() => setBookVisible(false)} onOk={() => bookForm.submit()}>
        <Form form={bookForm} layout="vertical" onFinish={handleBook}>
          <Form.Item name="purpose" label="用途" rules={[{ required: true }]}>
            <Select options={[
              { value: 'production', label: '生产' },
              { value: 'storage', label: '仓储' },
              { value: 'event', label: '活动' },
              { value: 'display', label: '展示' },
            ]} />
          </Form.Item>
          <Form.Item name="startAt" label="开始时间" rules={[{ required: true }]}><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="endAt" label="结束时间" rules={[{ required: true }]}><DatePicker showTime style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default PlazaSupply;
