import { message } from 'antd';
import { api } from '../api';

/**
 * Export data to CSV file
 */
export function exportToCSV(data: any[], filename: string, columns: { key: string; title: string }[]) {
  if (!data || data.length === 0) {
    message.warning('没有数据可导出');
    return;
  }

  // Build CSV header
  const header = columns.map((c) => c.title).join(',');
  
  // Build CSV rows
  const rows = data.map((row) =>
    columns
      .map((col) => {
        let value = row[col.key];
        // Handle null/undefined
        if (value === null || value === undefined) value = '';
        // Handle dates
        if (value instanceof Date) value = value.toISOString();
        // Escape quotes and wrap in quotes if contains comma
        value = String(value);
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          value = `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      })
      .join(',')
  );

  // Combine and add BOM for Excel compatibility
  const csvContent = '\uFEFF' + [header, ...rows].join('\n');
  
  // Create and download file
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${filename}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  
  message.success('导出成功');
}

/**
 * Export data from API endpoint
 */
export async function exportFromAPI(endpoint: string, filename: string, columns: { key: string; title: string }[], params?: Record<string, any>) {
  try {
    const res = await api.get(endpoint, params);
    if (res?.success) {
      const data = res.items || res.data?.items || res.orders || res.data?.orders || [];
      exportToCSV(data, filename, columns);
    } else {
      message.error('获取数据失败');
    }
  } catch (err) {
    console.error(err);
    message.error('导出失败');
  }
}
