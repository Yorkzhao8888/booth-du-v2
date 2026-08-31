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
  job_id?: string;
  job_type?: string;
  priority?: number;
  sla_minutes?: number;
  dispatched_at?: string;
  station_name?: string;
}

// 优先级徽标颜色
const getPriorityColor = (priority: number) => {
  if (priority >= 8) return '#ff4d4f';
  if (priority >= 5) return '#fa8c16';
  if (priority >= 3) return '#faad14';
  return '#d9d9d9';
};

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            {workOrder.job_id && (
              <span style={{ fontSize: 12, color: '#1890ff', fontFamily: 'monospace' }}>
                {workOrder.job_id}
              </span>
            )}
            {workOrder.job_type && (
              <span style={{ fontSize: 11, background: '#e6f7ff', color: '#1890ff', padding: '1px 6px', borderRadius: 4 }}>
                {workOrder.job_type}
              </span>
            )}
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
            {workOrder.productName}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#666', fontSize: 13, marginBottom: 4 }}>
            <span>数量: {workOrder.qty}</span>
            {workOrder.priority && (
              <span style={{ 
                background: getPriorityColor(workOrder.priority), 
                color: '#fff', 
                padding: '1px 6px', 
                borderRadius: 4,
                fontSize: 11
              }}>
                P{workOrder.priority}
              </span>
            )}
          </div>
          <div style={{ color: '#999', fontSize: 12 }}>
            {dayjs(workOrder.createdAt).format('MM-DD HH:mm')}
            {workOrder.station_name && ` · ${workOrder.station_name}`}
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
