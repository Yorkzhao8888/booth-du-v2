import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Form, Input, Modal, Space, Tag, Typography, message } from 'antd';
import { apiGet, apiPost, unwrapData } from '../../api';

/**
 * [XDP-ECO] 企业主体 (#xepz) 加盟入驻卡
 * 提交入驻申请(主体信息+经营类目) → VEM 控制台审核 → 通过开通 Booth-EDP 铺+协议费率落库 / 驳回带理由
 * 嵌入 xepz/EnterpriseWorkbench
 */

interface EcoApp {
  id: number;
  shopName: string;
  category: string;
  status: 'pending' | 'approved' | 'rejected';
  rejectReason?: string | null;
  rateBps?: number | null;
  createdAt: string;
}

interface ApplyForm {
  applicant: string;
  contact: string;
  shopName: string;
  category: string;
  applyNote?: string;
}

const fmtTime = (t?: string | null): string => (t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '-');

const JoinApplyCard: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const [apps, setApps] = useState<EcoApp[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<ApplyForm>();

  const loadMyApps = useCallback(async () => {
    try {
      const res = await apiGet<EcoApp[] | { data?: EcoApp[] }>('/eco/my-applications');
      setApps(unwrapData<EcoApp[]>(res));
    } catch (err) {
      message.error(`申请状态加载失败: ${(err as Error).message}`);
    }
  }, []);

  useEffect(() => {
    void loadMyApps();
  }, [loadMyApps]);

  const hasPending = apps.some((a) => a.status === 'pending');
  const hasShop = apps.some((a) => a.status === 'approved');

  const submit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      await apiPost('/eco/applications', values);
      message.success('入驻申请已提交, 请等待平台方审核');
      setModalOpen(false);
      form.resetFields();
      void loadMyApps();
    } catch (err) {
      const e = err as Error;
      if (e.message && !e.message.includes('Validation')) message.error(`提交失败: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card
      size="small"
      title={<span><Tag color="cyan">加盟入驻</Tag> 开通 Booth-EDP 铺</span>}
      style={{ borderRadius: 12 }}
      styles={{ body: { padding: compact ? '10px 14px' : '12px 16px' } }}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: compact ? 8 : 12, whiteSpace: 'pre-line' }}>
        {'提交主体信息与经营类目 → 平台方 (VEM) 审核 → 通过后自动开通 Booth-EDP 铺并落库加盟协议费率; 驳回将回传理由。'}
      </Typography.Paragraph>

      <Space style={{ marginBottom: 8 }} wrap>
        <Button type="primary" size="small" onClick={() => setModalOpen(true)} disabled={hasPending || hasShop}>
          {hasShop ? '已开通铺位' : hasPending ? '申请审核中' : '提交入驻申请'}
        </Button>
        <Button size="small" onClick={() => void loadMyApps()}>刷新状态</Button>
      </Space>

      {apps.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {apps.slice(0, 3).map((a) => (
            <div key={a.id} style={{ fontSize: 12, padding: '6px 8px', background: '#fafafa', borderRadius: 6 }}>
              <Space size={6} wrap>
                <strong>{a.shopName}</strong>
                {a.status === 'pending' ? <Tag color="warning">审核中</Tag>
                  : a.status === 'approved' ? <Tag color="success">已开通 (费率 {(a.rateBps ?? 0) / 100}%)</Tag>
                  : <Tag color="error">已驳回</Tag>}
                <Typography.Text type="secondary">{fmtTime(a.createdAt)}</Typography.Text>
              </Space>
              {a.status === 'rejected' && a.rejectReason ? (
                <div style={{ color: '#cf1322', marginTop: 4 }}>理由: {a.rejectReason}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <Modal
        open={modalOpen}
        title="加盟入驻申请"
        okText="提交申请"
        confirmLoading={submitting}
        cancelText="取消"
        onOk={() => void submit()}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ category: '食品加工' }}>
          <Form.Item name="applicant" label="企业主体名称" rules={[{ required: true, message: '请填写企业主体名称' }]}>
            <Input placeholder="如: 新味食品有限公司" />
          </Form.Item>
          <Form.Item name="contact" label="联系方式" rules={[{ required: true, message: '请填写联系方式' }]}>
            <Input placeholder="联系人 / 电话" />
          </Form.Item>
          <Form.Item name="shopName" label="拟开铺名" rules={[{ required: true, message: '请填写拟开铺名' }]}>
            <Input placeholder="如: 新味·中央厨房铺" />
          </Form.Item>
          <Form.Item name="category" label="经营类目" rules={[{ required: true, message: '请填写经营类目' }]}>
            <Input placeholder="如: 食品加工 / 服装 / 电子" />
          </Form.Item>
          <Form.Item name="applyNote" label="补充说明 (选填)">
            <Input.TextArea rows={2} placeholder="经营计划、产能说明等" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default JoinApplyCard;
