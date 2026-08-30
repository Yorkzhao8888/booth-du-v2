import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, Card, Button, Tag, Space, message, Drawer, Modal, Form, Input, InputNumber,
  Select, DatePicker, Tabs, Descriptions, Badge, Popconfirm, Statistic, Row, Col, Tooltip
} from 'antd';
import {
  ReloadOutlined, TeamOutlined, PlusOutlined, CheckCircleOutlined, CloseCircleOutlined,
  EditOutlined, DeleteOutlined, FileTextOutlined, ExclamationCircleOutlined,
  AuditOutlined, EyeOutlined
} from '@ant-design/icons';
import { api } from '../../api';
import { useAuthStore } from '../../store';
import dayjs from 'dayjs';

const { TextArea } = Input;
const { Option } = Select;

// 准入状态配置
const admissionStatusConfig: Record<string, { text: string; color: string; icon: React.ReactNode }> = {
  pending: { text: '待审核', color: 'processing', icon: <AuditOutlined /> },
  admitted: { text: '已准入', color: 'success', icon: <CheckCircleOutlined /> },
  rejected: { text: '已驳回', color: 'error', icon: <CloseCircleOutlined /> },
  exited: { text: '已退出', color: 'default', icon: <ExclamationCircleOutlined /> },
};

// 合同状态配置
const contractStatusConfig: Record<string, { text: string; color: string }> = {
  draft: { text: '草稿', color: 'default' },
  active: { text: '生效中', color: 'success' },
  expired: { text: '已到期', color: 'error' },
  terminated: { text: '已终止', color: 'warning' },
};

// 供应类别
const categoryOptions = ['原材料', '半成品', '成品', '辅料', '包装材料', '设备', '服务'];
// 账期选项
const paymentTermsOptions = [
  { value: 0, label: '现结' },
  { value: 30, label: '30天' },
  { value: 60, label: '60天' },
  { value: 90, label: '90天' },
];

interface Supplier {
  id: number;
  org_id: number;
  supplier_code: string;
  name: string;
  contact_person: string | null;
  contact_phone: string | null;
  category: string | null;
  region: string | null;
  qualifications: string | null;
  business_license: string | null;
  payment_terms: number;
  admission_status: string;
  admission_remark: string | null;
  admission_reviewed_at: string | null;
  remark: string | null;
  created_at: string;
  updated_at: string;
}

interface Contract {
  id: number;
  org_id: number;
  supplier_id: number;
  contract_no: string;
  contract_name: string | null;
  start_date: string | null;
  end_date: string | null;
  terms_summary: string | null;
  status: string;
  supplier_name?: string;
  created_at: string;
  updated_at: string;
}

interface OverviewStats {
  suppliers: { admission_status: string; count: string }[];
  contracts: { status: string; count: string }[];
  expiring_contracts: number;
}

const DuSupplierManagement: React.FC = () => {
  const { user } = useAuthStore();
  const role = user?.role || '';
  // 价格可见角色：dm/du/dx
  const canSeePrice = ['dm', 'du', 'dx'].includes(role);
  // 可操作角色：dm/du/dx
  const canEdit = ['dm', 'du', 'dx'].includes(role);

  const [activeTab, setActiveTab] = useState('suppliers');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20, total: 0 });
  const [statusFilter, setStatusFilter] = useState('all');
  const [keyword, setKeyword] = useState('');

  // 统计
  const [stats, setStats] = useState<OverviewStats | null>(null);

  // 供应商表单
  const [supplierModalVisible, setSupplierModalVisible] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [supplierForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  // 合同管理
  const [contractDrawerVisible, setContractDrawerVisible] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [contractLoading, setContractLoading] = useState(false);
  const [contractModalVisible, setContractModalVisible] = useState(false);
  const [editingContract, setEditingContract] = useState<Contract | null>(null);
  const [contractForm] = Form.useForm();

  // 详情
  const [detailDrawerVisible, setDetailDrawerVisible] = useState(false);
  const [detailSupplier, setDetailSupplier] = useState<Supplier | null>(null);

  // 获取统计
  const fetchStats = useCallback(async () => {
    try {
      const res = await api.get<any>('/du/suppliers/overview/stats');
      setStats(res);
    } catch { /* ignore */ }
  }, []);

  // 获取供应商列表
  const fetchSuppliers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<any>('/du/suppliers', {
        page: pagination.current,
        pageSize: pagination.pageSize,
        admission_status: statusFilter,
        keyword: keyword || undefined,
      });
      setSuppliers(res?.items || []);
      setPagination(prev => ({ ...prev, total: res?.total || 0 }));
    } catch {
      message.error('加载供应商列表失败');
    } finally {
      setLoading(false);
    }
  }, [pagination.current, pagination.pageSize, statusFilter, keyword]);

  // 获取合同列表
  const fetchContracts = useCallback(async (supplierId: number) => {
    setContractLoading(true);
    try {
      const res = await api.get<any>(`/du/suppliers/${supplierId}/contracts`);
      setContracts(res?.items || []);
    } catch {
      message.error('加载合同列表失败');
    } finally {
      setContractLoading(false);
    }
  }, []);

  useEffect(() => { fetchSuppliers(); }, [fetchSuppliers]);
  useEffect(() => { fetchStats(); }, []);

  // 创建/编辑供应商
  const handleSaveSupplier = async (values: any) => {
    setSubmitting(true);
    try {
      if (editingSupplier) {
        await api.put(`/du/suppliers/${editingSupplier.id}`, values);
        message.success('供应商更新成功');
      } else {
        await api.post('/du/suppliers', values);
        message.success('供应商创建成功');
      }
      setSupplierModalVisible(false);
      setEditingSupplier(null);
      supplierForm.resetFields();
      fetchSuppliers();
      fetchStats();
    } catch (err: any) {
      message.error(err.message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 删除供应商
  const handleDeleteSupplier = async (id: number) => {
    try {
      await api.delete(`/du/suppliers/${id}`);
      message.success('删除成功');
      fetchSuppliers();
      fetchStats();
    } catch {
      message.error('删除失败');
    }
  };

  // 准入审核
  const handleAdmission = async (supplierId: number, status: string, remark?: string) => {
    try {
      await api.put(`/du/suppliers/${supplierId}/admission`, {
        admission_status: status,
        admission_remark: remark,
      });
      message.success(status === 'admitted' ? '准入成功' : status === 'rejected' ? '已驳回' : '操作成功');
      fetchSuppliers();
      fetchStats();
    } catch (err: any) {
      message.error(err.message || '操作失败');
    }
  };

  // 创建/编辑合同
  const handleSaveContract = async (values: any) => {
    setSubmitting(true);
    try {
      const payload = {
        ...values,
        start_date: values.start_date ? values.start_date.format('YYYY-MM-DD') : null,
        end_date: values.end_date ? values.end_date.format('YYYY-MM-DD') : null,
      };
      if (editingContract) {
        await api.put(`/du/suppliers/contracts/${editingContract.id}`, payload);
        message.success('合同更新成功');
      } else {
        await api.post(`/du/suppliers/${selectedSupplier!.id}/contracts`, payload);
        message.success('合同创建成功');
      }
      setContractModalVisible(false);
      setEditingContract(null);
      contractForm.resetFields();
      if (selectedSupplier) fetchContracts(selectedSupplier.id);
    } catch (err: any) {
      message.error(err.message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  // 删除合同
  const handleDeleteContract = async (contractId: number) => {
    try {
      await api.delete(`/du/suppliers/contracts/${contractId}`);
      message.success('删除成功');
      if (selectedSupplier) fetchContracts(selectedSupplier.id);
    } catch {
      message.error('删除失败');
    }
  };

  // 打开供应商编辑
  const openSupplierEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    supplierForm.setFieldsValue({
      name: supplier.name,
      contact_person: supplier.contact_person,
      contact_phone: supplier.contact_phone,
      category: supplier.category,
      region: supplier.region,
      qualifications: supplier.qualifications,
      business_license: supplier.business_license,
      payment_terms: supplier.payment_terms,
      remark: supplier.remark,
    });
    setSupplierModalVisible(true);
  };

  // 打开合同管理
  const openContractDrawer = (supplier: Supplier) => {
    setSelectedSupplier(supplier);
    setContractDrawerVisible(true);
    fetchContracts(supplier.id);
  };

  // 打开合同编辑
  const openContractEdit = (contract: Contract) => {
    setEditingContract(contract);
    contractForm.setFieldsValue({
      contract_no: contract.contract_no,
      contract_name: contract.contract_name,
      start_date: contract.start_date ? dayjs(contract.start_date) : null,
      end_date: contract.end_date ? dayjs(contract.end_date) : null,
      terms_summary: contract.terms_summary,
      status: contract.status,
    });
    setContractModalVisible(true);
  };

  // 供应商表格列
  const supplierColumns = [
    {
      title: '编码',
      dataIndex: 'supplier_code',
      width: 120,
      render: (code: string) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{code}</span>,
    },
    {
      title: '名称',
      dataIndex: 'name',
      width: 150,
      render: (name: string, record: Supplier) => (
        <a onClick={() => { setDetailSupplier(record); setDetailDrawerVisible(true); }}>{name}</a>
      ),
    },
    { title: '类别', dataIndex: 'category', width: 100, render: (v: string) => v || '-' },
    { title: '区域', dataIndex: 'region', width: 100, render: (v: string) => v || '-' },
    {
      title: '准入状态',
      dataIndex: 'admission_status',
      width: 100,
      render: (status: string) => {
        const config = admissionStatusConfig[status] || admissionStatusConfig.pending;
        return <Tag color={config.color} icon={config.icon}>{config.text}</Tag>;
      },
    },
    {
      title: '账期',
      dataIndex: 'payment_terms',
      width: 80,
      render: (terms: number) => canSeePrice ? (terms === 0 ? '现结' : `${terms}天`) : <span style={{ color: '#999' }}>-</span>,
    },
    { title: '联系人', dataIndex: 'contact_person', width: 100, render: (v: string) => v || '-' },
    { title: '电话', dataIndex: 'contact_phone', width: 130, render: (v: string) => v || '-' },
    {
      title: '操作',
      width: 200,
      fixed: 'right' as const,
      render: (_: any, record: Supplier) => (
        <Space size="small">
          {canEdit && record.admission_status === 'pending' && (
            <>
              <Tooltip title="准入">
                <Button type="link" size="small" icon={<CheckCircleOutlined />}
                  onClick={() => handleAdmission(record.id, 'admitted')} />
              </Tooltip>
              <Tooltip title="驳回">
                <Button type="link" size="small" danger icon={<CloseCircleOutlined />}
                  onClick={() => {
                    Modal.confirm({
                      title: '驳回供应商',
                      content: '确定要驳回该供应商准入申请吗？',
                      onOk: () => handleAdmission(record.id, 'rejected'),
                    });
                  }} />
              </Tooltip>
            </>
          )}
          {canEdit && (
            <>
              <Tooltip title="编辑">
                <Button type="link" size="small" icon={<EditOutlined />}
                  onClick={() => openSupplierEdit(record)} />
              </Tooltip>
              <Tooltip title="合同">
                <Button type="link" size="small" icon={<FileTextOutlined />}
                  onClick={() => openContractDrawer(record)} />
              </Tooltip>
              <Popconfirm title="确定删除？" onConfirm={() => handleDeleteSupplier(record.id)}>
                <Button type="link" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </>
          )}
          <Tooltip title="详情">
            <Button type="link" size="small" icon={<EyeOutlined />}
              onClick={() => { setDetailSupplier(record); setDetailDrawerVisible(true); }} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  // 合同表格列
  const contractColumns = [
    { title: '合同编号', dataIndex: 'contract_no', width: 140 },
    { title: '合同名称', dataIndex: 'contract_name', width: 150, render: (v: string) => v || '-' },
    {
      title: '开始日期',
      dataIndex: 'start_date',
      width: 110,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD') : '-',
    },
    {
      title: '到期日期',
      dataIndex: 'end_date',
      width: 110,
      render: (v: string, record: Contract) => {
        if (!v) return '-';
        const isExpiringSoon = record.status === 'active' && dayjs(v).diff(dayjs(), 'day') <= 30;
        return (
          <span>
            {dayjs(v).format('YYYY-MM-DD')}
            {isExpiringSoon && <Badge status="warning" style={{ marginLeft: 4 }} />}
          </span>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (status: string) => {
        const config = contractStatusConfig[status] || contractStatusConfig.draft;
        return <Tag color={config.color}>{config.text}</Tag>;
      },
    },
    {
      title: '操作',
      width: 100,
      render: (_: any, record: Contract) => (
        <Space size="small">
          {canEdit && (
            <>
              <Button type="link" size="small" icon={<EditOutlined />}
                onClick={() => openContractEdit(record)} />
              <Popconfirm title="确定删除？" onConfirm={() => handleDeleteContract(record.id)}>
                <Button type="link" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  // 统计卡片数据
  const getStatCounts = () => {
    if (!stats) return { pending: 0, admitted: 0, rejected: 0, total: 0 };
    const pending = stats.suppliers.find(s => s.admission_status === 'pending');
    const admitted = stats.suppliers.find(s => s.admission_status === 'admitted');
    const rejected = stats.suppliers.find(s => s.admission_status === 'rejected');
    return {
      pending: parseInt(pending?.count || '0'),
      admitted: parseInt(admitted?.count || '0'),
      rejected: parseInt(rejected?.count || '0'),
      total: (parseInt(pending?.count || '0') + parseInt(admitted?.count || '0') + parseInt(rejected?.count || '0')),
    };
  };

  const statCounts = getStatCounts();

  return (
    <div style={{ padding: 24 }}>
      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic title="供应商总数" value={statCounts.total} prefix={<TeamOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="待审核" value={statCounts.pending} valueStyle={{ color: '#1890ff' }}
              prefix={<AuditOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="已准入" value={statCounts.admitted} valueStyle={{ color: '#52c41a' }}
              prefix={<CheckCircleOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="即将到期合同" value={stats?.expiring_contracts || 0}
              valueStyle={{ color: '#faad14' }} prefix={<ExclamationCircleOutlined />} suffix="份" />
          </Card>
        </Col>
      </Row>

      {/* 主内容区 */}
      <Card
        title="本店供应商管理"
        extra={
          <Space>
            <Input.Search
              placeholder="搜索供应商名称/编码/联系人"
              allowClear
              onSearch={v => { setKeyword(v); setPagination(prev => ({ ...prev, current: 1 })); }}
              style={{ width: 240 }}
            />
            <Select value={statusFilter} onChange={v => { setStatusFilter(v); setPagination(prev => ({ ...prev, current: 1 })); }}
              style={{ width: 120 }}>
              <Option value="all">全部状态</Option>
              <Option value="pending">待审核</Option>
              <Option value="admitted">已准入</Option>
              <Option value="rejected">已驳回</Option>
              <Option value="exited">已退出</Option>
            </Select>
            <Button icon={<ReloadOutlined />} onClick={() => { fetchSuppliers(); fetchStats(); }}>刷新</Button>
            {canEdit && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => {
                setEditingSupplier(null);
                supplierForm.resetFields();
                setSupplierModalVisible(true);
              }}>
                新增供应商
              </Button>
            )}
          </Space>
        }
      >
        <Table
          rowKey="id"
          columns={supplierColumns}
          dataSource={suppliers}
          loading={loading}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: true,
            showTotal: t => `共 ${t} 条`,
            onChange: (page, pageSize) => setPagination(prev => ({ ...prev, current: page, pageSize })),
          }}
          scroll={{ x: 1200 }}
          size="middle"
        />
      </Card>

      {/* 供应商创建/编辑 Modal */}
      <Modal
        title={editingSupplier ? '编辑供应商' : '新增供应商'}
        open={supplierModalVisible}
        onCancel={() => { setSupplierModalVisible(false); setEditingSupplier(null); supplierForm.resetFields(); }}
        footer={null}
        width={640}
      >
        <Form form={supplierForm} layout="vertical" onFinish={handleSaveSupplier}>
          <Form.Item name="name" label="供应商名称" rules={[{ required: true, message: '请输入供应商名称' }]}>
            <Input placeholder="请输入供应商名称" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="category" label="供应类别">
                <Select placeholder="请选择" allowClear>
                  {categoryOptions.map(c => <Option key={c} value={c}>{c}</Option>)}
                </Select>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="region" label="区域">
                <Input placeholder="如：华东/华南/华北" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="contact_person" label="联系人">
                <Input placeholder="联系人姓名" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="contact_phone" label="联系电话">
                <Input placeholder="联系电话" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="business_license" label="营业执照号">
                <Input placeholder="统一社会信用代码" />
              </Form.Item>
            </Col>
            <Col span={12}>
              {canSeePrice && (
                <Form.Item name="payment_terms" label="账期">
                  <Select placeholder="请选择账期">
                    {paymentTermsOptions.map(o => <Option key={o.value} value={o.value}>{o.label}</Option>)}
                  </Select>
                </Form.Item>
              )}
            </Col>
          </Row>
          <Form.Item name="qualifications" label="资质信息">
            <TextArea rows={2} placeholder="供应商相关资质说明" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <TextArea rows={2} placeholder="备注信息" />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={() => { setSupplierModalVisible(false); setEditingSupplier(null); }}>取消</Button>
              <Button type="primary" htmlType="submit" loading={submitting}>
                {editingSupplier ? '更新' : '创建'}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 供应商详情 Drawer */}
      <Drawer
        title="供应商详情"
        open={detailDrawerVisible}
        onClose={() => setDetailDrawerVisible(false)}
        width={480}
      >
        {detailSupplier && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="编码">{detailSupplier.supplier_code}</Descriptions.Item>
            <Descriptions.Item label="名称">{detailSupplier.name}</Descriptions.Item>
            <Descriptions.Item label="类别">{detailSupplier.category || '-'}</Descriptions.Item>
            <Descriptions.Item label="区域">{detailSupplier.region || '-'}</Descriptions.Item>
            <Descriptions.Item label="联系人">{detailSupplier.contact_person || '-'}</Descriptions.Item>
            <Descriptions.Item label="联系电话">{detailSupplier.contact_phone || '-'}</Descriptions.Item>
            <Descriptions.Item label="营业执照">{detailSupplier.business_license || '-'}</Descriptions.Item>
            <Descriptions.Item label="资质">{detailSupplier.qualifications || '-'}</Descriptions.Item>
            {canSeePrice && (
              <Descriptions.Item label="账期">
                {detailSupplier.payment_terms === 0 ? '现结' : `${detailSupplier.payment_terms}天`}
              </Descriptions.Item>
            )}
            <Descriptions.Item label="准入状态">
              <Tag color={admissionStatusConfig[detailSupplier.admission_status]?.color || 'default'}>
                {admissionStatusConfig[detailSupplier.admission_status]?.text || detailSupplier.admission_status}
              </Tag>
            </Descriptions.Item>
            {detailSupplier.admission_remark && (
              <Descriptions.Item label="准入备注">{detailSupplier.admission_remark}</Descriptions.Item>
            )}
            {detailSupplier.admission_reviewed_at && (
              <Descriptions.Item label="审核时间">{dayjs(detailSupplier.admission_reviewed_at).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
            )}
            <Descriptions.Item label="备注">{detailSupplier.remark || '-'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{dayjs(detailSupplier.created_at).format('YYYY-MM-DD HH:mm')}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>

      {/* 合同管理 Drawer */}
      <Drawer
        title={`合同管理 - ${selectedSupplier?.name || ''}`}
        open={contractDrawerVisible}
        onClose={() => { setContractDrawerVisible(false); setSelectedSupplier(null); setContracts([]); }}
        width={720}
        extra={
          canEdit && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => {
              setEditingContract(null);
              contractForm.resetFields();
              setContractModalVisible(true);
            }}>
              新增合同
            </Button>
          )
        }
      >
        <Table
          rowKey="id"
          columns={contractColumns}
          dataSource={contracts}
          loading={contractLoading}
          pagination={false}
          size="small"
        />
      </Drawer>

      {/* 合同创建/编辑 Modal */}
      <Modal
        title={editingContract ? '编辑合同' : '新增合同'}
        open={contractModalVisible}
        onCancel={() => { setContractModalVisible(false); setEditingContract(null); contractForm.resetFields(); }}
        footer={null}
        width={560}
      >
        <Form form={contractForm} layout="vertical" onFinish={handleSaveContract}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="contract_no" label="合同编号" rules={[{ required: true, message: '请输入合同编号' }]}>
                <Input placeholder="如：HT-2024-001" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="contract_name" label="合同名称">
                <Input placeholder="合同名称" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="start_date" label="开始日期">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="end_date" label="到期日期">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="status" label="状态" initialValue="draft">
            <Select>
              <Option value="draft">草稿</Option>
              <Option value="active">生效</Option>
              <Option value="terminated">终止</Option>
            </Select>
          </Form.Item>
          <Form.Item name="terms_summary" label="条款摘要">
            <TextArea rows={4} placeholder="合同主要条款摘要" />
          </Form.Item>
          <Form.Item style={{ textAlign: 'right', marginBottom: 0 }}>
            <Space>
              <Button onClick={() => { setContractModalVisible(false); setEditingContract(null); }}>取消</Button>
              <Button type="primary" htmlType="submit" loading={submitting}>
                {editingContract ? '更新' : '创建'}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default DuSupplierManagement;
