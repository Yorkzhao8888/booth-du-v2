import React from 'react';
import { Card } from 'antd';
import dayjs from 'dayjs';
import StatusTag from './StatusTag';

export interface WorkOrderData {
  id: number;
  productName: string;
  qty: number;
  status: string;
  createdAt: string;
  acceptedAt?: string;
  completedAt?: string;
  progress?: number;
  note?: string;
}

interface WorkOrderCardProps {
  workOrder: WorkOrderData;
  actions?: React.ReactNode;
}

const WorkOrderCard: React.FC<WorkOrderCardProps> = ({ workOrder, actions }) => {
  return (
    <Card
      size="small"
      style={{ marginBottom: 12, borderRadius: 8 }}
      styles={{ body: { padding: '12px 16px' } }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
            {workOrder.productName}
          </div>
          <div style={{ color: '#666', fontSize: 13, marginBottom: 4 }}>
            数量: {workOrder.qty}
          </div>
          <div style={{ color: '#999', fontSize: 12 }}>
            {dayjs(workOrder.createdAt).format('MM-DD HH:mm')}
          </div>
        </div>
        <StatusTag status={workOrder.status} />
      </div>
      {actions && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {actions}
        </div>
      )}
    </Card>
  );
};

export default WorkOrderCard;
