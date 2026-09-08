/**
 * [BOOTH-PRD-002 PM-001] 供应铺管理: 四铺(研发/制造/配送/供给)供应铺 CRUD + 停用 + 能力展示(PM-008 预留)
 * BDD-16 能力联动前置: 供应铺管理数据作为能力展示数据源
 */
import { useEffect, useState, useCallback } from 'react';
import { Button, Card, Form, Input, Modal, Select, Space, Switch, Table, Tag, message } from 'antd';
import { apiGet, apiPost } from '../../api';

const SHOP_TYPES = [
  { value: 'rd', label: '研发铺' },
  { value: 'manufacture', label: '制造铺' },
  { value: 'delivery', label: '配送铺' },
  { value: 'supply', label: '供给铺' },
];

interface SupplyShop {
  id: number;
  shop_type: string;
  shop_name: string;
  status: string;
  capabilities: string[];
  contact?: string;
  remark?: string;
  created_at: string;
}

const typeLabel = (t: string) => SHOP_TYPES.find((x) => x.value === t)?.label || t;
const typeColor = (t: string) =>
  ({ rd: 'purple', manufacture: 'blue', delivery: 'cyan', supply: 'orange' } as Record<string, string>)[t] || 'default';

export default function SupplyShops() {
  const [rows, setRows] = useState<SupplyShop[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SupplyShop | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet<SupplyShop[]>('/supply-shops');
      setRows(d || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ shopType: 'manufacture', enabled: true });
    setModalOpen(true);
  };

  const openEdit = (row: SupplyShop) => {
    setEditing(row);
    form.resetFields();
    form.setFieldsValue({
      shopType: row.shop_type,
      shopName: row.shop_name,
      contact: row.contact,
      remark: row.remark,
      enabled: row.status === 'active',
      capabilitiesText: (row.capabilities || []).join(','),
    });
    setModalOpen(true);
  };

  const submit = async () => {
    const v = await form.validateFields();
    const capabilities = String(v.capabilitiesText || '')
      .split(/[,，]/)
      .map((x: string) => x.trim())
      .filter(Boolean);
    if (editing) {
      await apiPost(`/supply-shops/${editing.id}`, {
        shopName: v.shopName,
        contact: v.contact,
        remark: v.remark,
        enabled: v.enabled,
        capabilities,
      });
      message.success('已更新');
    } else {
      await apiPost('/supply-shops', {
        shopType: v.shopType,
        shopName: v.shopName,
        contact: v.contact,
        remark: v.remark,
        enabled: v.enabled,
        capabilities,
      });
      message.success('供应铺已创建');
    }
    setModalOpen(false);
    void load();
  };

  const toggle = async (row: SupplyShop) => {
    await apiPost(`/supply-shops/${row.id}`, { enabled: row.status !== 'active' });
    message.success(row.status === 'active' ? '已停用' : '已启用');
    void load();
  };

  const showCapabilities = (row: SupplyShop) => {
    Modal.info({
      title: `能力展示 — ${row.shop_name} (PM-008 预留数据源)`,
      width: 520,
      content: (
        <div style={{ paddingTop: 12 }}>
          {row.capabilities && row.capabilities.length > 0 ? (
            <Space wrap>
              {row.capabilities.map((c) => (
                <Tag key={c} color="geekblue">
                  {c}
                </Tag>
              ))}
            </Space>
          ) : (
            <div style={{ color: '#999' }}>暂无登记能力 (BDD-16: 能力展示数据源 = 供应铺 capabilities)</div>
          )}
        </div>
      ),
    });
  };

  return (
    <Card
      title="供应铺管理"
      extra={
        <Button type="primary" onClick={openCreate}>
          新建供应铺
        </Button>
      }
    >
      <Table<SupplyShop>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={false}
        columns={[
          { title: 'ID', dataIndex: 'id', width: 56 },
          {
            title: '铺型',
            dataIndex: 'shop_type',
            width: 96,
            render: (t: string) => <Tag color={typeColor(t)}>{typeLabel(t)}</Tag>,
          },
          { title: '铺名', dataIndex: 'shop_name' },
          {
            title: '状态',
            dataIndex: 'status',
            width: 88,
            render: (s: string) =>
              s === 'active' ? <Tag color="green">启用</Tag> : <Tag color="default">停用</Tag>,
          },
          {
            title: '能力 (PM-008 预留)',
            dataIndex: 'capabilities',
            render: (c: string[]) =>
              (c || []).length > 0 ? (
                <Space size={4} wrap>
                  {c.slice(0, 3).map((x) => (
                    <Tag key={x} style={{ fontSize: 12 }}>
                      {x}
                    </Tag>
                  ))}
                  {c.length > 3 ? <Tag>+{c.length - 3}</Tag> : null}
                </Space>
              ) : (
                <span style={{ color: '#bbb' }}>—</span>
              ),
          },
          { title: '联系人', dataIndex: 'contact', width: 100, render: (v: string) => v || '—' },
          {
            title: '操作',
            width: 190,
            render: (_: unknown, row: SupplyShop) => (
              <Space size={4}>
                <Button size="small" type="link" onClick={() => openEdit(row)}>
                  编辑
                </Button>
                <Button size="small" type="link" onClick={() => showCapabilities(row)}>
                  能力
                </Button>
                <Switch size="small" checked={row.status === 'active'} onChange={() => toggle(row)} />
              </Space>
            ),
          },
        ]}
      />
      <Modal
        title={editing ? `编辑供应铺 — ${editing.shop_name}` : '新建供应铺'}
        open={modalOpen}
        onOk={submit}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="shopType" label="铺型" rules={[{ required: true, message: '请选择铺型' }]}>
            <Select disabled={!!editing} options={SHOP_TYPES} />
          </Form.Item>
          <Form.Item name="shopName" label="铺名" rules={[{ required: true, message: '请输入铺名' }]}>
            <Input placeholder="如: 中央制造铺" />
          </Form.Item>
          <Form.Item name="contact" label="联系人">
            <Input placeholder="选填" />
          </Form.Item>
          <Form.Item name="capabilitiesText" label="能力清单 (逗号分隔, PM-008 能力展示数据源)">
            <Input placeholder="如: 烘焙, 冷食组装, 贴标" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="选填" />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
