/**
 * Booth KPI 卡片
 * 指标数值用等宽字体 + 单位
 * 产能利用率加进度条（≤80% 绿 / 81-100% 橙 / >100% 红）
 */
import React from 'react';
import { Card, Progress } from 'antd';
import type { ReactNode } from 'react';

interface KpiCardProps {
  /** 标题 */
  title: string;
  /** 数值 */
  value: number | string;
  /** 单位 */
  unit?: string;
  /** 图标 */
  icon?: ReactNode;
  /** 进度条百分比 (0-100+) */
  progressPercent?: number;
  /** 进度条类型: capacity=产能利用率语义色, default=主色 */
  progressType?: 'capacity' | 'default';
  /** 副标题/说明 */
  subtitle?: string;
  /** 底部标签 */
  tags?: ReactNode;
  /** 点击事件 */
  onClick?: () => void;
  /** 背景色 */
  bgColor?: string;
}

const monoFont = "'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, monospace";

const getCapacityColor = (percent: number): string => {
  if (percent <= 80) return '#16A37B'; // 绿
  if (percent <= 100) return '#D97B1F'; // 橙
  return '#C63A3A'; // 红
};

export const KpiCard: React.FC<KpiCardProps> = ({
  title,
  value,
  unit,
  icon,
  progressPercent,
  progressType = 'default',
  subtitle,
  tags,
  onClick,
  bgColor,
}) => {
  const progressColor =
    progressType === 'capacity' && progressPercent !== undefined
      ? getCapacityColor(progressPercent)
      : '#2F6BFF';

  return (
    <Card
      variant="borderless"
      onClick={onClick}
      style={{
        background: bgColor || '#FFFFFF',
        cursor: onClick ? 'pointer' : 'default',
        height: '100%',
        border: '1px solid #E5E9F0',
      }}
      styles={{
        body: {
          padding: '20px 24px',
        },
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        {icon && (
          <div
            style={{
              fontSize: 24,
              color: '#1F3A5F',
              opacity: 0.7,
              marginTop: 2,
            }}
          >
            {icon}
          </div>
        )}
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 13,
              color: '#6B7280',
              marginBottom: 8,
            }}
          >
            {title}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 4,
            }}
          >
            <span
              style={{
                fontSize: 28,
                fontWeight: 600,
                color: '#1F3A5F',
                fontFamily: monoFont,
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1.2,
              }}
            >
              {value}
            </span>
            {unit && (
              <span
                style={{
                  fontSize: 14,
                  color: '#6B7280',
                  fontWeight: 500,
                }}
              >
                {unit}
              </span>
            )}
          </div>
          {subtitle && (
            <div
              style={{
                fontSize: 12,
                color: '#9CA3AF',
                marginTop: 4,
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
      </div>

      {progressPercent !== undefined && (
        <div style={{ marginTop: 16 }}>
          <Progress
            percent={Math.min(progressPercent, 100)}
            showInfo={false}
            strokeColor={progressColor}
            trailColor="#F0F3F7"
            size={['100%', 8]}
          />
          {progressPercent > 100 && (
            <div
              style={{
                fontSize: 11,
                color: '#C63A3A',
                marginTop: 4,
                fontFamily: monoFont,
              }}
            >
              超负荷 +{(progressPercent - 100).toFixed(1)}%
            </div>
          )}
        </div>
      )}

      {tags && <div style={{ marginTop: 12 }}>{tags}</div>}
    </Card>
  );
};

export default KpiCard;
