import React from 'react';
import { Tag } from 'antd';

type WorkOrderStatus = 'pending' | 'accepted' | 'preparing' | 'completed' | 'cancelled';

const statusConfig: Record<string, { color: string; text: string }> = {
  // 旧状态
  pending: { color: 'blue', text: '待接单' },
  accepted: { color: 'cyan', text: '已接单' },
  preparing: { color: 'orange', text: '制作中' },
  completed: { color: 'green', text: '已完成' },
  cancelled: { color: 'red', text: '已取消' },
  // 8 态状态
  Pending: { color: 'default', text: '待处理' },
  Dispatched: { color: 'geekblue', text: '已派单' },
  Accepted: { color: 'cyan', text: '已接单' },
  Running: { color: 'orange', text: '生产中' },
  Completed: { color: 'green', text: '已完成' },
  Failed: { color: 'red', text: '失败' },
  Cancelled: { color: 'red', text: '已取消' },
  Archived: { color: 'default', text: '已归档' },
};

interface StatusTagProps {
  status: string;
}

const StatusTag: React.FC<StatusTagProps> = ({ status }) => {
  const cfg = statusConfig[status as WorkOrderStatus] || { color: 'default', text: status };
  return <Tag color={cfg.color}>{cfg.text}</Tag>;
};

export default StatusTag;
