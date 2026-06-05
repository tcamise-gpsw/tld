import React from 'react';

interface ToolbarProps {
  showExternalStubs: boolean;
  onToggleExternalStubs: () => void;
}

/**
 * Floating toolbar overlay positioned in the top-right of the canvas container.
 * Currently exposes a single toggle button for external connector stubs.
 */
export const Toolbar: React.FC<ToolbarProps> = ({
  showExternalStubs,
  onToggleExternalStubs,
}) => (
  <div className="toolbar">
    <button
      className={`toolbar-button${showExternalStubs ? ' toolbar-button--active' : ''}`}
      onClick={onToggleExternalStubs}
      title={showExternalStubs ? 'Hide external connector stubs' : 'Show external connector stubs'}
    >
      {showExternalStubs ? 'Hide External' : 'Show External'}
    </button>
  </div>
);
