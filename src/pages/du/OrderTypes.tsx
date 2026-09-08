/**
 * [BOOTH-PRD-002 PM-002] 订单类型配置: 字典化设计 (MVP 三类=外发/自制/研发, 预留扩展)
 * BDD-01 类型驱动派发: default_target_shop_type 决定生产单 dispatch 默认主铺
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
const typeLabel = (t: string) => SHOP_TYPES.find((x) => x.value === t)?.label || t;

interface OrderType {
  id: number;
  type_code: string;
  type_name: string;
  default_target_shop_type: string;
  sort_order: number;
  enabled: boolean;
  remark?: string;
}

const MVP_TAG: Record<string, string> = { outsource: 'gold', self_made: 'green', rd_dev: 'purple' };

export default function OrderTypes() {
  const [rows, setRows] = useState<OrderType[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<OrderType | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiGet<OrderType[]>('/order-types');
      setRows(d || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    const v = await form.validateFields();
    await apiPost(editing ? `/order-types/${editing.id}` : '/order-types', {
      typeCode: v.typeCode,
      typeName: v.typeName,
      defaultTargetShopType: v.defaultTargetShopType,
      sortOrder: v.sortOrder ?? 0,
      enabled: v.enabled,
      remark: v.remark,
    });
    message.success(editing ? '已更新' : '订单类型已创建');
    setModalOpen(false);
    void load();
  };

  return (
    <Card
      title="订单类型配置"
      extra={
        <Button
          type="primary"
          onClick={() => {
            setEditing(null);
            form.resetFields();
            form.setFieldsValue({ enabled: true, sortOrder: 0 });
            setModalOpen(true);
          }}
        >
          新增类型 (字典化扩展)
        </Button>
      }
    >
      <Table<OrderType>
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        pagination={false}
        columns={[
          { title: '类型编码', dataIndex: 'type_code', width: 130 },
          {
            title: '类型名称',
            dataIndex: 'type_name',
            width: 110,
            render: (n: string, row: OrderType) => (
              <Space size={6}>
                <span>{n}</span>
                {MVP_TAG[row.type_code] ? <Tag color={MVP_TAG[row.type_code]}>MVP</Tag> : null}
              </Space>
            ),
          },
          {
            title: '默认派发目标铺 (BDD-01)',
            dataIndex: 'default_target_shop_type',
            width: 170,
            render: (t: string) => <Tag color="processing">{typeLabel(t)}</Tag>,
          },
          { title: '排序', dataIndex: 'sort_order', width: 70 },
          {
            title: '启用',
            dataIndex: 'enabled',
            width: 80,
            render: (e: boolean) => (e ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
          },
          { title: '备注', dataIndex: 'remark', render: (v: string) => v || '—' },
          {
            title: '操作',
            width: 80,
            render: (_: unknown, row: OrderType) => (
              <Button
                size="small"
                type="link"
                onClick={() => {
                  setEditing(row);
                  form.resetFields();
                  form.setFieldsValue({
                    typeCode: row.type_code,
                    typeName: row.type_name,
                    defaultTargetShopType: row.default_target_shop_type,
                    sortOrder: row.sort_order,
                    enabled: row.enabled,
                    remark: row.remark,
                  });
                  setModalOpen(true);
                }}
              >
                编辑
              </Button>
            ),
          },
        ]}
      />
      <Modal
        title={editing ? `编辑订单类型 — ${editing.type_name}` : '新增订单类型'}
        open={modalOpen}
        onOk={submit}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="typeCode" label="类型编码" rules={[{ required: true, message: '请输入类型编码' }]}>
            <Input placeholder="如: group_buy (扩展类型)" disabled={!!editing} />
          </Form.Item>
          <Form.Item name="typeName" label="类型名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如: 社区团购" />
          </Form.Item>
          <Form.Item
            name="defaultTargetShopType"
            label="默认派发目标铺"
            rules={[{ required: true, message: '请选择目标铺' }]}
          >
            <Select options={SHOP_TYPES} />
          </Form.Item>
          <Form.Item name="sortOrder" label="排序">
            <Input type="number" />
          </Form.Item>
          <Form.Item name="enabled" label="启用" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
