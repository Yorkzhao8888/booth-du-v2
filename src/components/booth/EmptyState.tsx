/**
 * Booth 空态组件
 * 页面无数据时给操作引导 + 一句话说明，禁止纯空白
 */
import React from 'react';
import { Button, Space } from 'antd';
import { PlusOutlined, InboxOutlined } from '@ant-design/icons';

interface EmptyStateAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  type?: 'primary' | 'default';
}

interface EmptyStateProps {
  /** 主标题 */
  title?: string;
  /** 说明文案 */
  description: string;
  /** 操作按钮 */
  actions?: EmptyStateAction[];
  /** 自定义图标 */
  icon?: React.ReactNode;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title = '暂无数据',
  description,
  actions,
  icon,
}) => {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        background: '#FAFBFD',
        borderRadius: 8,
        border: '1px dashed #E5E9F0',
      }}
    >
      <div
        style={{
          fontSize: 48,
          color: '#C9D4E3',
          marginBottom: 16,
        }}
      >
        {icon || <InboxOutlined />}
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 500,
          color: '#1F3A5F',
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: 14,
          color: '#6B7280',
          textAlign: 'center',
          maxWidth: 360,
          marginBottom: actions && actions.length > 0 ? 24 : 0,
          lineHeight: 1.6,
        }}
      >
        {description}
      </div>
      {actions && actions.length > 0 && (
        <Space>
          {actions.map((action, index) => (
            <Button
              key={index}
              type={action.type || (index === 0 ? 'primary' : 'default')}
              icon={action.icon || <PlusOutlined />}
              onClick={action.onClick}
            >
              {action.label}
            </Button>
          ))}
        </Space>
      )}
    </div>
  );
};

export default EmptyState;
