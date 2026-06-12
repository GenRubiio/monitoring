import React, { useState } from 'react';
import { useMetrics } from './hooks/useMetrics';
import { MetricsWidget } from './components/MetricsWidget';
import { SSHPanel } from './components/SSHPanel';

type View = 'widget' | 'panel';

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>('widget');
  const { local, remote } = useMetrics();

  if (view === 'panel') {
    return <SSHPanel onClose={() => setView('widget')} />;
  }

  return (
    <MetricsWidget
      local={local}
      remote={remote}
      onOpenPanel={() => setView('panel')}
    />
  );
}
