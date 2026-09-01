/**
 * Booth 顶部执行状态条
 * 展示产能负荷 / 待履约 / 异常预警 / 准时率
 * 用琥珀金 #C9A227 点缀
 */
import React from 'react';
import { Tooltip } from 'antd';
import {
  DashboardOutlined,
  FileTextOutlined,
  WarningOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';

interface ExecutionStatusBarProps {
  /** 产能负荷率 0-100+ */
  capacityLoad: number;
  /** 待履约单数 */
  pendingFulfillment: number;
  /** 异常预警数 */
  alertCount: number;
  /** 准时率 0-100 */
  onTimeRate: number;
  /** 点击产能负荷 */
  onCapacityClick?: () => void;
  /** 点击待履约 */
  onPendingClick?: () => void;
  /** 点击异常预警 */
  onAlertClick?: () => void;
}

const monoFont = "'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, monospace";

const getStatusColor = (value: number, type: 'capacity' | 'ontime'): string => {
  if (type === 'capacity') {
    if (value <= 80) return '#16A37B'; // 绿
    if (value <= 100) return '#D97B1F'; // 橙
    return '#C63A3A'; // 红
  }
  // ontime
  if (value >= 95) return '#16A37B';
  if (value >= 80) return '#D97B1F';
  return '#C63A3A';
};

export const ExecutionStatusBar: React.FC<ExecutionStatusBarProps> = ({
  capacityLoad,
  pendingFulfillment,
  alertCount,
  onTimeRate,
  onCapacityClick,
  onPendingClick,
  onAlertClick,
}) => {
  const items = [
    {
      key: 'capacity',
      icon: <DashboardOutlined />,
      label: '产能负荷',
      value: `${capacityLoad.toFixed(1)}%`,
      color: getStatusColor(capacityLoad, 'capacity'),
      onClick: onCapacityClick,
      tooltip: '当前产能占用率',
    },
    {
      key: 'pending',
      icon: <FileTextOutlined />,
      label: '待履约',
      value: `${pendingFulfillment}`,
      unit: '单',
      color: pendingFulfillment > 10 ? '#D97B1F' : '#1F3A5F',
      onClick: onPendingClick,
      tooltip: '待处理履约单数量',
    },
    {
      key: 'alerts',
      icon: <WarningOutlined />,
      label: '异常预警',
      value: `${alertCount}`,
      unit: '项',
      color: alertCount > 0 ? '#C63A3A' : '#16A37B',
      onClick: onAlertClick,
      tooltip: '需要处理的异常事项',
    },
    {
      key: 'ontime',
      icon: <CheckCircleOutlined />,
      label: '准时率',
      value: `${onTimeRate.toFixed(1)}%`,
      color: getStatusColor(onTimeRate, 'ontime'),
      tooltip: '订单准时交付率',
    },
  ];

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #1F3A5F 0%, #2A4A75 100%)',
        borderRadius: 8,
        padding: '16px 24px',
        marginBottom: 24,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 16,
      }}
    >
      {items.map((item, index) => (
        <React.Fragment key={item.key}>
          {index > 0 && (
            <div
              style={{
                width: 1,
                height: 40,
                background: 'rgba(255,255,255,0.15)',
              }}
            />
          )}
          <Tooltip title={item.tooltip}>
            <div
              onClick={item.onClick}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                cursor: item.onClick ? 'pointer' : 'default',
                padding: '4px 8px',
                borderRadius: 6,
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => {
                if (item.onClick) {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              <div
                style={{
                  fontSize: 20,
                  color: '#C9A227', // 琥珀金点缀
                }}
              >
                {item.icon}
              </div>
              <div>
                <div
                  style={{
                    fontSize: 12,
                    color: 'rgba(255,255,255,0.65)',
                    marginBottom: 2,
                  }}
                >
                  {item.label}
                </div>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 600,
                    color: item.color,
                    fontFamily: monoFont,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {item.value}
                  {item.unit && (
                    <span
                      style={{
                        fontSize: 12,
                        color: 'rgba(255,255,255,0.65)',
                        marginLeft: 2,
                        fontFamily: 'inherit',
                      }}
                    >
                      {item.unit}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </Tooltip>
        </React.Fragment>
      ))}
    </div>
  );
};

export default ExecutionStatusBar;
