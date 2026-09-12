import React from 'react';
import { Button, Empty, Result, Skeleton, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';

/**
 * [UX-BOOST ②三态] 页面数据三态统一组件：骨架屏 / 错误态重试 / 空态引导。
 * - loading → AntD Skeleton（骨架屏，替代白屏/只有转圈）
 * - error   → Result error + 重试按钮（可恢复动作前置）
 * - empty   → Empty + 「原因 + 数据价值 + 行动」引导文案（范本：/du/fab/equipment 设备档案空态）
 * 其余情况直接渲染 children（正常态）。
 */
export interface PageStateProps {
  loading?: boolean;
  error?: boolean;
  empty?: boolean;
  errorTitle?: string;
  errorDesc?: string;
  emptyTitle?: string;
  /** 空态说明：解释原因 + 数据价值（参照 /du/fab/equipment 范式） */
  emptyDesc?: string;
  emptyAction?: React.ReactNode;
  onRetry?: () => void;
  /** 骨架屏行数 */
  skeletonRows?: number;
  children?: React.ReactNode;
}

const PageState: React.FC<PageStateProps> = ({
  loading = false,
  error = false,
  empty = false,
  errorTitle = '页面数据加载失败',
  errorDesc = '网络异常或服务暂不可用，数据未受影响，可点击重试恢复。',
  emptyTitle = '暂无数据',
  emptyDesc,
  emptyAction,
  onRetry,
  skeletonRows = 4,
  children,
}) => {
  if (loading) {
    return (
      <div style={{ padding: '8px 2px' }}>
        <Skeleton active paragraph={{ rows: skeletonRows }} />
      </div>
    );
  }
  if (error) {
    return (
      <Result
        status="error"
        title={errorTitle}
        subTitle={errorDesc}
        extra={
          onRetry ? (
            <Button type="primary" icon={<ReloadOutlined />} onClick={onRetry}>
              重新加载
            </Button>
          ) : undefined
        }
      />
    );
  }
  if (empty) {
    return (
      <div style={{ textAlign: 'center', padding: '28px 12px' }}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={null}>
          <Space direction="vertical" size={4}>
            <span style={{ fontWeight: 600 }}>{emptyTitle}</span>
            {emptyDesc ? <span style={{ color: 'rgba(0,0,0,0.55)', fontSize: 13, maxWidth: 420 }}>{emptyDesc}</span> : null}
            {emptyAction ? <span style={{ marginTop: 6 }}>{emptyAction}</span> : null}
          </Space>
        </Empty>
      </div>
    );
  }
  return <>{children}</>;
};

export default PageState;
