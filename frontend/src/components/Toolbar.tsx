import React from 'react';

interface ToolbarProps {
  showExternalStubs: boolean;
  onToggleExternalStubs: () => void;
  onFitToContent: () => void;
}

/**
 * Floating toolbar overlay positioned in the top-right of the canvas container.
 */
export const Toolbar: React.FC<ToolbarProps> = ({
  showExternalStubs,
  onToggleExternalStubs,
  onFitToContent,
}) => (
  <div className="toolbar">
    <button
      className="toolbar-button"
      onClick={onFitToContent}
      title="Fit diagram to viewport"
    >
      Fit
    </button>
    <button
      className={`toolbar-button${showExternalStubs ? ' toolbar-button--active' : ''}`}
      onClick={onToggleExternalStubs}
      title={showExternalStubs ? 'Hide external connector stubs' : 'Show external connector stubs'}
    >
      {showExternalStubs ? 'Hide External' : 'Show External'}
    </button>
  </div>
);
