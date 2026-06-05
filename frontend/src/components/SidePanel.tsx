import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { DiagramData } from '../data/types';
import { resolveConnectors, sortConnectors, SortCol } from './SidePanel.logic';

interface SidePanelProps {
  selectedNode: string | null;
  currentView: string;
  data: DiagramData;
  showExternalStubs: boolean;
  onToggleExternalStubs: () => void;
}

export const SidePanel: React.FC<SidePanelProps> = ({
  selectedNode,
  currentView,
  data,
  showExternalStubs,
  onToggleExternalStubs,
}) => {
  const element = useMemo(() => selectedNode ? data.elements.get(selectedNode) : undefined, [data, selectedNode]);
  
  const [sortState, setSortState] = useState<{ column: SortCol; direction: 'asc' | 'desc' }>({
    column: 'Target',
    direction: 'asc'
  });

  const [panelWidth, setPanelWidth] = useState(640);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = panelWidth;
  }, [panelWidth]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = startXRef.current - e.clientX;
      setPanelWidth(Math.max(280, Math.min(900, startWidthRef.current + delta)));
    };
    const handleMouseUp = () => { draggingRef.current = false; };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const { connectors, inboundCount, outboundCount } = useMemo(
    () => selectedNode ? resolveConnectors(data, selectedNode, currentView) : { connectors: [], inboundCount: 0, outboundCount: 0 },
    [data, selectedNode, currentView]
  );

  const sortedConnectors = useMemo(
    () => sortConnectors(connectors, sortState.column, sortState.direction === 'desc'),
    [connectors, sortState.column, sortState.direction]
  );

  const handleSort = (col: SortCol) => {
    if (sortState.column === col) {
      setSortState({ ...sortState, direction: sortState.direction === 'asc' ? 'desc' : 'asc' });
    } else {
      setSortState({ column: col, direction: 'asc' });
    }
  };

  if (!selectedNode || !element) return null;

  const hasExternal = connectors.some(c => c.isExternal);

  return (
    <div className="side-panel" style={{ width: panelWidth }}>
      <div className="side-panel-resize-handle" onMouseDown={handleResizeStart} />
      <div className="panel-header">
        <h3>{element.name}</h3>
        <p className="panel-kind">{element.kind}</p>
      </div>

      <div className="panel-section">
        <p className="panel-description">{element.description}</p>
        {element.technology && <p className="panel-tech">Tech: {element.technology}</p>}
      </div>

      <div className="panel-section table-section">
        <h4>Connectors</h4>
        <div className="connector-summary">
          <span>{connectors.length} connectors ({outboundCount} outbound, {inboundCount} inbound)</span>
        </div>

        {connectors.length > 0 ? (
          <div className="table-container">
            <table className="connector-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('Direction')}>
                    Direction {sortState.column === 'Direction' && (sortState.direction === 'desc' ? '▼' : '▲')}
                  </th>
                  <th onClick={() => handleSort('Target')}>
                    Target {sortState.column === 'Target' && (sortState.direction === 'desc' ? '▼' : '▲')}
                  </th>
                  <th onClick={() => handleSort('Type')}>
                    Type {sortState.column === 'Type' && (sortState.direction === 'desc' ? '▼' : '▲')}
                  </th>
                  <th onClick={() => handleSort('View')}>
                    View {sortState.column === 'View' && (sortState.direction === 'desc' ? '▼' : '▲')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedConnectors.map((conn, idx) => (
                  <tr key={`${conn.id}-${idx}`} className={conn.isExternal ? 'external' : ''}>
                    <td className="connector-direction">
                      {conn.direction === 'Inbound' ? '← Inbound' : '→ Outbound'}
                    </td>
                    <td className="connector-target-cell" title={conn.target}>{conn.target}</td>
                    <td className="connector-type">{conn.type}</td>
                    <td className="connector-view">{conn.view}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="panel-empty">No connectors</p>
        )}
      </div>

      {hasExternal && (
        <div className="panel-section">
          <button className="panel-button" onClick={onToggleExternalStubs}>
            {showExternalStubs ? '✓' : '○'} Show External Stubs
          </button>
        </div>
      )}
    </div>
  );
};
