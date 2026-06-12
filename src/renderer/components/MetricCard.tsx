import React from 'react';

interface MetricCardProps {
  label: string;
  value: string;
  unit?: string;
}

// Stateless atomic display unit: a labelled metric value with an optional unit.
export function MetricCard({ label, value, unit }: MetricCardProps): React.JSX.Element {
  return (
    <div className="metric-card">
      <span className="metric-card__label">{label}</span>
      <span className="metric-card__value">
        {value}
        {unit ? <span className="metric-card__unit">{unit}</span> : null}
      </span>
    </div>
  );
}
