import React from 'react';
import { useAuthStore } from '../store';

interface PriceTextProps {
  value?: number | null;
}

const PriceText: React.FC<PriceTextProps> = ({ value }) => {
  const canSeePrice = useAuthStore((s) => s.canSeePrice());

  if (!canSeePrice || value == null) {
    return <span style={{ color: '#bfbfbf' }}>-</span>;
  }

  return <span>¥{(value / 100).toFixed(2)}</span>;
};

export default PriceText;
