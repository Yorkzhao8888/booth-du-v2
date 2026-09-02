import React, { useEffect, useState, useCallback } from 'react';
import { Card, Table, Button, Tag, Space, Modal, Form, Input, Select, message, Descriptions, Collapse } from 'antd';
import { ToolOutlined, PlusOutlined, SendOutlined, CheckOutlined } from '@ant-design/icons';
import { api } from '../../api';

const deviceStatusMap: Record<string, { color: string; label: string }> = {
  idle: { color: 'default', label: '空闲' },
  in_use: { color: 'processing', label: '使用中' },
  maintenance: { color: 'warning', label: '维保中' },
  retired: { color: 'error', label: '已报废' },
};

const maintenanceTypeMap: Record<string, string> = {
  routine: '日常保养',
  repair: '维修',
  inspection: '巡检',
  calibration: '校准',
};

const DeviceSupply: React.FC = () => {
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [createVisible, setCreateVisible] = useState(false);
  const [dispatchVisible, setDispatchVisible] = useState(false);
  const [maintenanceVisible, setMaintenanceVisible] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [currentDevice, setCurrentDevice] = useState<any>(null);
  const [maintenanceLogs, setMaintenanceLogs] = useState<any[]>([]);
  const [createForm] = Form.useForm();
  const [dispatchForm] = Form.useForm();
  const [maintenanceForm] = Form.useForm();

  const fetchDevices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/exx/wh/devices');
      setDevices(res.items || []);
    } catch (e) { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  const handleCreate = async (values: any) => {
    try {
      await api.post('/exx/wh/devices', values);
      message.success('设备创建成功');
      setCreateVisible(false);
      createForm.resetFields();
      fetchDevices();
    } catch (e: any) { message.error(e.message || '创建失败'); }
  };

  const handleDispatch = async (values: any) => {
    if (!currentDevice) return;
    try {
      await api.post(`/exx/wh/devices/${currentDevice.id}/dispatch`, values);
      message.success('设备已出库到产线');
      setDispatchVisible(false);
      dispatchForm.resetFields();
      fetchDevices();
    } catch (e: any) { message.error(e.message || '操作失败'); }
  };

  const handleMaintenance = async (values: any) => {
    if (!currentDevice) return;
    try {
      await api.post(`/exx/wh/devices/${currentDevice.id}/maintenance`, values);
      message.success('维保记录已创建');
      setMaintenanceVisible(false);
      maintenanceForm.resetFields();
      fetchDevices();
    } catch (e: any) { message.error(e.message || '操作失败'); }
  };

  const handleCompleteMaintenance = async (logId: number) => {
    if (!currentDevice) return;
    try {
      await api.post(`/exx/wh/devices/${currentDevice.id}/maintenance/complete`, { logId });
      message.success('维保完成');
      fetchMaintenanceLogs(currentDevice.id);
      fetchDevices();
    } catch (e: any) { message.error(e.message || '操作失败'); }
  };

  const fetchMaintenanceLogs = async (deviceId: number) => {
    try {
      const res = await api.get(`/exx/wh/devices/${deviceId}/maintenance`);
      setMaintenanceLogs(res.items || []);
    } catch (e) { setMaintenanceLogs([]); }
  };

  const columns = [
    { title: '设备编码', dataIndex: 'device_code', width: 120 },
    { title: '设备名称', dataIndex: 'device_name', width: 140 },
    { title: '类型', dataIndex: 'device_type', width: 100 },
    { title: '序列号', dataIndex: 'serial_no', width: 130 },
    { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <Tag color={deviceStatusMap[v]?.color}>{deviceStatusMap[v]?.label || v}</Tag> },
    { title: '分配产线', dataIndex: 'assigned_line', width: 100, render: (v: string) => v || '-' },
    {
      title: '操作', key: 'action', width: 280,
      render: (_: any, r: any) => (
        <Space>
          {r.status === 'idle' && <Button size="small" type="primary" icon={<SendOutlined />} onClick={() => { setCurrentDevice(r); setDispatchVisible(true); }}>出库</Button>}
          {r.status !== 'retired' && <Button size="small" icon={<ToolOutlined />} onClick={() => { setCurrentDevice(r); setMaintenanceVisible(true); }}>维保</Button>}
          <Button size="small" onClick={() => { setCurrentDevice(r); fetchMaintenanceLogs(r.id); setHistoryVisible(true); }}>履历</Button>
        </Space>
      ),
    },
  ];

  return (
    <Card title="设备供给" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateVisible(true)}>登记设备</Button>}>
      <Table dataSource={devices} columns={columns} rowKey="id" loading={loading} pagination={{ pageSize: 15 }} scroll={{ x: 1000 }} />

      <Modal title="登记设备" open={createVisible} onCancel={() => setCreateVisible(false)} onOk={() => createForm.submit()} width={500}>
        <Form form={createForm} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="deviceCode" label="设备编码" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="deviceName" label="设备名称" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="deviceType" label="设备类型">
            <Select allowClear options={[
              { value: 'production', label: '生产设备' },
              { value: 'packaging', label: '包装设备' },
              { value: 'sorting', label: '分拣设备' },
              { value: 'auxiliary', label: '辅助设备' },
            ]} />
          </Form.Item>
          <Form.Item name="serialNo" label="序列号"><Input /></Form.Item>
          <Form.Item name="location" label="存放位置"><Input /></Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal title={`设备出库: ${currentDevice?.device_name || ''}`} open={dispatchVisible} onCancel={() => setDispatchVisible(false)} onOk={() => dispatchForm.submit()}>
        <Form form={dispatchForm} layout="vertical" onFinish={handleDispatch}>
          <Form.Item name="targetType" label="供给对象类型" rules={[{ required: true }]}>
            <Select options={[
              { value: 'production_line', label: '产线' },
              { value: 'station', label: '工位' },
            ]} />
          </Form.Item>
          <Form.Item name="targetName" label="目标产线/工位" rules={[{ required: true }]}><Input placeholder="如: A线" /></Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal title={`设备维保: ${currentDevice?.device_name || ''}`} open={maintenanceVisible} onCancel={() => setMaintenanceVisible(false)} onOk={() => maintenanceForm.submit()}>
        <Form form={maintenanceForm} layout="vertical" onFinish={handleMaintenance}>
          <Form.Item name="maintenanceType" label="维保类型" rules={[{ required: true }]}>
            <Select options={[
              { value: 'routine', label: '日常保养' },
              { value: 'repair', label: '维修' },
              { value: 'inspection', label: '巡检' },
              { value: 'calibration', label: '校准' },
            ]} />
          </Form.Item>
          <Form.Item name="description" label="维保描述" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="remark" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>

      <Modal title={`维保履历: ${currentDevice?.device_name || ''}`} open={historyVisible} onCancel={() => setHistoryVisible(false)} footer={null} width={600}>
        {maintenanceLogs.length === 0 ? <p style={{ color: '#999' }}>暂无维保记录</p> : (
          <Collapse items={maintenanceLogs.map((log: any) => ({
            key: log.id,
            label: (
              <Space>
                <Tag>{maintenanceTypeMap[log.maintenance_type] || log.maintenance_type}</Tag>
                <span>{log.description?.slice(0, 30)}</span>
                <span style={{ color: '#999', fontSize: 12 }}>{new Date(log.created_at).toLocaleString()}</span>
                {!log.completed_at && <Tag color="warning">进行中</Tag>}
                {log.completed_at && <Tag color="success">已完成</Tag>}
              </Space>
            ),
            children: (
              <div>
                <p>{log.description}</p>
                {log.remark && <p>备注: {log.remark}</p>}
                {!log.completed_at && (
                  <Button size="small" type="primary" icon={<CheckOutlined />} onClick={() => handleCompleteMaintenance(log.id)}>完成维保</Button>
                )}
              </div>
            ),
          }))} />
        )}
      </Modal>
    </Card>
  );
};

export default DeviceSupply;
