import React, { useEffect, useRef } from 'react';
import { message } from 'antd';
import { useAuthStore } from '../store';

const SSEListener: React.FC = () => {
  const token = useAuthStore((s) => s.token);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!token) return;

    const connect = () => {
      const es = new EventSource(`/api/booth/stream?token=${encodeURIComponent(token)}`);
      esRef.current = es;

      es.addEventListener('work_order_created', (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data);
          message.info(`新工单: ${data.productName || ''} x${data.qty || ''}`);
        } catch {
          message.info('新工单已创建');
        }
        window.dispatchEvent(new CustomEvent('booth:refresh'));
      });

      es.addEventListener('work_order_updated', (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data);
          message.info(`工单更新: ${data.productName || ''} - ${data.status || ''}`);
        } catch {
          message.info('工单状态已更新');
        }
        window.dispatchEvent(new CustomEvent('booth:refresh'));
      });

      es.addEventListener('inventory_low', (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data);
          message.warning(`库存预警: ${data.skuName || ''} 库存不足`);
        } catch {
          message.warning('库存预警');
        }
        window.dispatchEvent(new CustomEvent('booth:refresh'));
      });

      // Job 状态变更事件
      es.addEventListener('job_event', (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data);
          const eventLabels: Record<string, string> = {
            JobCreated: '已创建',
            JobDispatched: '已派单',
            JobAccepted: '已接单',
            JobRunning: '开始生产',
            JobCompleted: '已完成',
            JobFailed: '失败',
            JobCancelled: '已取消',
            JobArchived: '已归档',
          };
          const label = eventLabels[data.event] || data.event;
          const jobId = data.job_id || '';
          message.info(`Job ${jobId} ${label}`);
        } catch {
          message.info('Job 状态已更新');
        }
        window.dispatchEvent(new CustomEvent('booth:refresh'));
      });

      // 安灯事件
      es.addEventListener('andon_event', (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data);
          const sevLabel: Record<string, string> = { low: '低', medium: '中', high: '高', critical: '紧急' };
          message.warning(`安灯 #${data.event_no || data.id} [${sevLabel[data.severity] || data.severity}] ${data.message || ''}`, 5);
        } catch {
          message.warning('新安灯事件');
        }
        window.dispatchEvent(new CustomEvent('booth:andon'));
        window.dispatchEvent(new CustomEvent('booth:refresh'));
      });

      es.addEventListener('andon_escalation', (e) => {
        try {
          const data = JSON.parse((e as MessageEvent).data);
          message.error(`安灯 #${data.event_no || ''} 升级至 L${data.level}（${data.target || ''}）`, 5);
        } catch {
          message.error('安灯事件已升级');
        }
        window.dispatchEvent(new CustomEvent('booth:andon'));
      });

      es.onerror = () => {
        es.close();
        reconnectTimer.current = setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      esRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [token]);

  return null;
};

export default SSEListener;
