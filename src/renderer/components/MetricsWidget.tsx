import React from 'react';
import type {
  MetricsSnapshot,
  RemoteMetricsSnapshot,
  RemoteConnectionState,
} from '../../shared/types';
import { MetricCard } from './MetricCard';
import { ProfileSelector } from './ProfileSelector';
import { WindowControls } from './WindowControls';

interface MetricsWidgetProps {
  local: MetricsSnapshot | null;
  remote: RemoteMetricsSnapshot | null;
  onOpenPanel: () => void;
}

const PLACEHOLDER = '—';

function bytesToGb(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return PLACEHOLDER;
  return (bytes / 1024 ** 3).toFixed(1);
}

function formatTemp(tempC: number | null): string {
  return tempC === null ? 'N/A' : `${tempC.toFixed(1)}`;
}

function badgeLabel(state: RemoteConnectionState): string {
  switch (state) {
    case 'connected':
      return 'connected';
    case 'connecting':
      return 'connecting…';
    case 'reconnecting':
      return 'reconnecting…';
    case 'error':
      return 'error';
    case 'idle':
    default:
      return 'no remote';
  }
}

// Floating widget: local + remote metric sections. Owns the drag region.
export function MetricsWidget({
  local,
  remote,
  onOpenPanel,
}: MetricsWidgetProps): React.JSX.Element {
  const localCpu =
    local && local.error === null ? `${local.cpuLoadPercent}` : PLACEHOLDER;
  const localRam =
    local && local.error === null
      ? `${bytesToGb(local.memUsedBytes)} / ${bytesToGb(local.memTotalBytes)}`
      : PLACEHOLDER;
  const localTemp = local ? formatTemp(local.cpuTempC) : PLACEHOLDER;

  const remoteState: RemoteConnectionState = remote?.connectionState ?? 'idle';
  const remoteReady = remoteState === 'connected';
  const remoteCpu =
    remoteReady && remote ? `${remote.cpuLoadPercent ?? PLACEHOLDER}` : PLACEHOLDER;
  const remoteRam =
    remoteReady && remote
      ? `${bytesToGb(remote.memUsedBytes)} / ${bytesToGb(remote.memTotalBytes)}`
      : PLACEHOLDER;
  const remoteTemp =
    remoteReady && remote ? formatTemp(remote.cpuTempC) : PLACEHOLDER;

  return (
    <div className="widget drag">
      <header className="widget__header drag">
        <span className="widget__title">System Monitor</span>
        <div className="widget__header-actions no-drag">
          <ProfileSelector onOpenPanel={onOpenPanel} activeProfileId={remote?.profileId} />
          <WindowControls />
        </div>
      </header>

      <section className="widget__section">
        <h2 className="widget__section-title">Local</h2>
        {local?.error ? (
          <div className="widget__error">{local.error}</div>
        ) : null}
        <div className="widget__cards">
          <MetricCard label="CPU" value={localCpu} unit="%" />
          <MetricCard label="RAM" value={localRam} unit="GB" />
          <MetricCard label="Temp" value={localTemp} unit={localTemp === 'N/A' ? '' : '°C'} />
        </div>
      </section>

      <section className="widget__section">
        <div className="widget__section-head">
          <h2 className="widget__section-title">Remote</h2>
          <span className={`badge badge--${remoteState}`}>
            {badgeLabel(remoteState)}
          </span>
        </div>
        {remote?.error && remoteState === 'reconnecting' ? (
          <div className="widget__error">{remote.error}</div>
        ) : null}
        <div className="widget__cards">
          <MetricCard label="CPU" value={remoteCpu} unit={remoteCpu === PLACEHOLDER ? '' : '%'} />
          <MetricCard label="RAM" value={remoteRam} unit={remoteRam === PLACEHOLDER ? '' : 'GB'} />
          <MetricCard
            label="Temp"
            value={remoteTemp}
            unit={remoteTemp === 'N/A' || remoteTemp === PLACEHOLDER ? '' : '°C'}
          />
        </div>
      </section>
    </div>
  );
}
