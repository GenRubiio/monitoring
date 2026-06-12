import React, { useEffect, useState } from 'react';
import type { SshProfile } from '../../shared/types';

interface ProfileSelectorProps {
  onOpenPanel: () => void;
}

// Active-profile dropdown plus a gear button to open the SSH panel. All
// controls are no-drag so they remain clickable inside the drag region.
export function ProfileSelector({
  onOpenPanel,
}: ProfileSelectorProps): React.JSX.Element {
  const [profiles, setProfiles] = useState<SshProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    void window.api.listProfiles().then((list) => {
      if (!cancelled) setProfiles(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>): void => {
    const value = e.target.value;
    setSelectedId(value);
    window.api.selectProfile(value === '' ? null : value);
  };

  return (
    <div className="profile-selector no-drag">
      <select
        className="no-drag"
        value={selectedId}
        onChange={handleChange}
        aria-label="Active remote profile"
      >
        <option value="">No remote</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="no-drag gear-button"
        onClick={onOpenPanel}
        aria-label="Open SSH profiles"
        title="SSH profiles"
      >
        ⚙
      </button>
    </div>
  );
}
