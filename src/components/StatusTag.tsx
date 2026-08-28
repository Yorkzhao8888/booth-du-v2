import React from 'react';
import { Tag } from 'antd';

type WorkOrderStatus = 'pending' | 'accepted' | 'preparing' | 'completed' | 'cancelled';

const statusConfig: Record<WorkOrderStatus, { color: string; text: string }> = {
  pending: { color: 'blue', text: '待接单' },
  accepted: { color: 'cyan', text: '已接单' },
  preparing: { color: 'orange', text: '制作中' },
  completed: { color: 'green', text: '已完成' },
  cancelled: { color: 'red', text: '已取消' },
};

interface StatusTagProps {
  status: string;
}

const StatusTag: React.FC<StatusTagProps> = ({ status }) => {
  const cfg = statusConfig[status as WorkOrderStatus] || { color: 'default', text: status };
  return <Tag color={cfg.color}>{cfg.text}</Tag>;
};

export default StatusTag;
