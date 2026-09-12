import React, { useCallback, useEffect, useState } from 'react';
import { Card, Button, Tag, Space, message, Typography, Modal, Input, Alert } from 'antd';
import { ThunderboltOutlined, DeleteOutlined, RocketOutlined, QuestionCircleOutlined, PartitionOutlined, LineChartOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../../api';
import type { OnboardingStatus } from '../du/OnboardingWizard';

const { Text } = Typography;

// [Xfactory-ONBOARDING] EDU 工作台演示数据卡: 一键灌入/清空 (DEMO- 前缀严格隔离真实账) + 向导补完成入口
const DemoDataCard: React.FC = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false); // [W1-P3-4] 清空降权: 强二次确认
  const [confirmText, setConfirmText] = useState('');

  const load = useCallback((): void => {
    apiGet<OnboardingStatus>('/onboarding/status')
      .then((s) => setStatus(s))
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onSeed = async (): Promise<void> => {
    setBusy(true);
    try {
      await apiPost('/onboarding/seed-demo', {});
      message.success('演示数据已灌入 (来源单→拆单→波次→履约四节点→G-005 回执→结算)');
      load();
    } catch (e: unknown) {
      const err = e as { error?: string };
      message.error(err?.error || '灌入失败');
    } finally {
      setBusy(false);
    }
  };

  const onClear = async (): Promise<void> => {
    setBusy(true);
    try {
      await apiPost('/onboarding/clear-demo', {});
      message.success('演示数据已清空 (仅清除 DEMO- 标记数据, 真实账未触碰)');
      load();
    } catch (e: unknown) {
      const err = e as { error?: string };
      message.error(err?.error || '清空失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      size="small"
      title={
        <Space>
          <ThunderboltOutlined style={{ color: '#667eea' }} />
          <span>演示数据</span>
        </Space>
      }
      extra={<Tag color="purple">EDU</Tag>}
      style={{ borderRadius: 12, marginBottom: 16 }}
    >
      {!status ? (
        <Text type="secondary">加载中...</Text>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            {status.demoActive ? (
              <Space direction="vertical" size={0}>
                <Space>
                  <Tag color="orange">已灌入 {status.demoDataset?.dataset_no}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>数据带 DEMO- 前缀, 清空不触碰真实账</Text>
                </Space>
                <Space size={8} wrap style={{ marginTop: 4 }}>
                  <Button size="small" type="link" icon={<PartitionOutlined />} onClick={() => navigate('/du/production-orders')}>
                    看订单拆成工单
                  </Button>
                  <Button size="small" type="link" icon={<LineChartOutlined />} onClick={() => navigate('/xepz')}>
                    看回执触发结算 (履约时间线)
                  </Button>
                </Space>
              </Space>
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                灌入一套业务自洽的全闭环演示数据 (1 张来源单 → 拆单 → 波次 → 履约四节点 → G-005 回执 → 结算), 带明确 DEMO- 标记, 可随时清空。
              </Text>
            )}
          </div>
          <Space wrap>
            <Button size="small" icon={<RocketOutlined />} onClick={() => navigate('/du/onboarding')}>
              {status.hasOrgProfile ? '补完成向导' : '开通向导'}
            </Button>
            <Button size="small" icon={<QuestionCircleOutlined />} onClick={() => navigate('/quickstart')}>
              快速上手
            </Button>
            {status.demoActive ? (
              <>
                <Button size="small" danger loading={busy} icon={<DeleteOutlined />} onClick={() => { setConfirmText(''); setConfirmOpen(true); }}>
                  清空演示数据
                </Button>
                {/* [W1-P3-4] 清空降权: Modal 强二次确认 (输入确认词才可提交), 防误触 */}
                <Modal
                  open={confirmOpen}
                  title={<Space><ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />确认清空演示数据</Space>}
                  onCancel={() => setConfirmOpen(false)}
                  okText="确认清空"
                  okButtonProps={{ danger: true, disabled: confirmText.trim() !== '清空' }}
                  cancelText="再想想"
                  onOk={() => { setConfirmOpen(false); void onClear(); }}
                >
                  <Alert
                    type="warning"
                    showIcon
                    message="将删除全部 DEMO- 前缀演示行"
                    description="演示订单/工单/凭证/入库单及演示批次登记会被清除；真实数据不受影响。此操作不可撤销。"
                    style={{ marginBottom: 12 }}
                  />
                  <Input placeholder='输入"清空"以确认' value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
                </Modal>
              </>
            ) : (
              <Button size="small" type="primary" loading={busy} icon={<ThunderboltOutlined />} onClick={() => { void onSeed(); }}>
                一键灌入
              </Button>
            )}
          </Space>
        </div>
      )}
    </Card>
  );
};

export default DemoDataCard;

// [Xfactory-ONBOARDING] EDU 首次使用横幅 (无标记 + 无铺信息 + 无真实数据时显示)
export const OnboardingBanner: React.FC = () => {
  const navigate = useNavigate();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let done = false;
    try {
      done = localStorage.getItem('booth_onboarding_done') === '1';
    } catch {
      done = false;
    }
    if (done) return;
    apiGet<OnboardingStatus>('/onboarding/status')
      .then((s) => {
        if (s.isEdu && !s.hasOrgProfile && !s.hasRealData && !s.demoActive) setShow(true);
      })
      .catch(() => {});
  }, []);

  if (!show) return null;
  return (
    <Alert
      type="info"
      showIcon
      style={{ borderRadius: 10, marginBottom: 16 }}
      message="首次使用 Xfactory?"
      description="三步完成开通: 填写铺信息 → 选产能模板 → 可选灌入演示数据。"
      action={
        <Space direction="vertical">
          <Button size="small" type="primary" onClick={() => navigate('/du/onboarding')}>立即开始</Button>
          <Button
            size="small"
            type="text"
            onClick={() => {
              try {
                localStorage.setItem('booth_onboarding_done', '1');
              } catch {
                /* 忽略 */
              }
              setShow(false);
            }}
          >
            暂不
          </Button>
        </Space>
      }
      closable
      onClose={() => setShow(false)}
    />
  );
};
