/**
 * Booth 供给系统 — 共享视觉/排版常量（Booth = 供：稳重 精确 可靠）
 * 与 src/styles/global.css 的 CSS Variables 保持一致
 */
export const BOOTH = {
  primary: '#1F3A5F',
  primaryLight: '#2B4E7A',
  action: '#2F6BFF',
  amber: '#C9A227',
  bg: '#F5F7FA',
  success: '#16A37B',
  warning: '#D97B1F',
  danger: '#C63A3A',
  border: '#D8DEE9',
  textMain: '#1F2A3C',
  textSub: '#5A6B85',
  mono: "'SFMono-Regular', 'JetBrains Mono', Menlo, Consolas, monospace",
} as const;

/** 等宽数字展示：数值 + 单位 */
export function MonoNum({ value, unit, style }: { value: number | string | null | undefined; unit?: string; style?: React.CSSProperties }) {
  if (value === null || value === undefined) return <span style={{ color: BOOTH.textSub, ...style }}>N/A</span>;
  return (
    <span style={{ fontFamily: BOOTH.mono, fontVariantNumeric: 'tabular-nums', ...style }}>
      {value}
      {unit ? <span style={{ fontSize: 11, marginLeft: 1 }}>{unit}</span> : null}
    </span>
  );
}
