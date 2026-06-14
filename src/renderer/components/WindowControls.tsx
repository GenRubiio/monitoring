import React from 'react';

export function WindowControls(): React.JSX.Element {
  return (
    <div className="window-controls no-drag">
      <button
        type="button"
        className="window-control window-control--minimize"
        onClick={() => window.api.minimizeWindow()}
        aria-label="Minimize"
        title="Minimize"
      >
        −
      </button>
      <button
        type="button"
        className="window-control window-control--close"
        onClick={() => window.api.closeApp()}
        aria-label="Close application"
        title="Close application"
      >
        ×
      </button>
    </div>
  );
}
