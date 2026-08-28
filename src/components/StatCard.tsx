import React from 'react';
import { Card, Statistic } from 'antd';

interface StatCardProps {
  title: string;
  value: React.ReactNode;
  color?: string;
  suffix?: string;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, color, suffix }) => {
  return (
    <Card variant="borderless" style={{ background: color ? `${color}08` : undefined }}>
      <Statistic
        title={title}
        value={value as any}
        suffix={suffix}
        valueStyle={{ color: color || '#1f1f1f', fontSize: 28, fontWeight: 600 }}
      />
    </Card>
  );
};

export default StatCard;
