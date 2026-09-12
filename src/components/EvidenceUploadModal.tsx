import { useState } from 'react';
import { Modal, Input, Select, message } from 'antd';

/**
 * [W1-D3] EDXX 完工上报凭证弹窗 —— G-005 BDD-07 链路
 * POST /api/booth/edxx/fab/work-orders/:id/evidences → 凭证入库 + 自动 completeWorkOrder
 * 3 步作业闭环的「签退拿凭证」步骤：看任务 → 执行上报 → 凭证签退
 */
interface EvidenceUploadModalProps {
  open: boolean;
  workOrderId: number | null;
  workOrderNo?: string;
  onClose: () => void;
  onCompleted?: () => void;
}

export default function EvidenceUploadModal({ open, workOrderId, workOrderNo, onClose, onCompleted }: EvidenceUploadModalProps) {
  const [url, setUrl] = useState('');
  const [evidenceType, setEvidenceType] = useState('photo');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setUrl('');
    setEvidenceType('photo');
    setNote('');
  };

  const handleSubmit = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      message.warning('请粘贴凭证链接（现场照片或交付文件地址）');
      return;
    }
    if (!/^https?:\/\/.+/i.test(trimmed)) {
      message.warning('凭证链接需以 http(s):// 开头');
      return;
    }
    if (!workOrderId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/booth/edxx/fab/work-orders/${workOrderId}/evidences`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('booth_token') || ''}` },
        body: JSON.stringify({ url: trimmed, evidenceType, note: note.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        message.error(json.error || '凭证上报失败, 请重试');
        return;
      }
      message.success('凭证已登记, 工单自动完成并回传回执');
      reset();
      onCompleted?.();
      onClose();
    } catch {
      message.error('网络异常, 凭证上报失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`完工上报 · ${workOrderNo ? `工单 ${workOrderNo}` : '当前工单'}`}
      okText="签退并提交凭证"
      cancelText="取消"
      confirmLoading={submitting}
      onOk={handleSubmit}
      onCancel={() => {
        reset();
        onClose();
      }}
      destroyOnClose
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
        <Input
          placeholder="凭证链接（https://... 现场照片 / 交付文件）"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          allowClear
        />
        <Select
          value={evidenceType}
          onChange={(v) => setEvidenceType(v)}
          options={[
            { value: 'photo', label: '现场照片' },
            { value: 'file', label: '交付文件' },
            { value: 'signature', label: '签收凭证' },
          ]}
          style={{ width: 200 }}
        />
        <Input.TextArea
          placeholder="备注（可选）：如批次号、交付点位、异常说明"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={200}
          showCount
        />
        <span style={{ fontSize: 12, color: '#8c8c8c' }}>
          提交后凭证自动归档, 工单自动完成并触发回执链路, 无需人工二次确认
        </span>
      </div>
    </Modal>
  );
}
