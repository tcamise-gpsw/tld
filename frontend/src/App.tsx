import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { loadDiagramData, getViewElements, getViewConnectors, getNodeConnectors, isExternalToView } from './data/loader';
import { DiagramData } from './data/types';
import { computeExternalStubs } from './canvas/stubs';
import { getOrComputeLayout, invalidateLayout } from './canvas/layout';
import { CanvasViewport } from './canvas/CanvasViewport';
import { Toolbar } from './components/Toolbar';
import { Tooltip } from './components/Tooltip';
import { SidePanel } from './components/SidePanel';
import { startTransition, startExitTransition, TransitionState } from './canvas/animation';
import './styles.css';

export const App: React.FC = () => {
  const [data, setData] = useState<DiagramData | null>(null);
  const [navigationStack, setNavigationStack] = useState<string[]>(['root']);
  const currentView = navigationStack[navigationStack.length - 1];
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [showExternalStubs, setShowExternalStubs] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pendingNavigation, setPendingNavigation] = useState<{
    transitionState: TransitionState;
    action: () => void;
  } | null>(null);

  // Load diagram data on mount
  useEffect(() => {
    loadDiagramData()
      .then((loadedData) => {
        setData(loadedData);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const highlightedExternalEdges = useMemo(() => {
    if (!data || !selectedNode) return new Set<string>();
    const externalConnectors = getNodeConnectors(data, selectedNode).filter((conn) =>
      isExternalToView(conn, currentView, data)
    );
    return new Set(externalConnectors.map((conn) => `${conn.source}-${conn.target}`));
  }, [data, selectedNode, currentView]);

  const handleSelect = useCallback((ref: string | null) => {
    setSelectedNode(ref);
  }, []);

  const handleEnterGroup = useCallback(
    (ref: string) => {
      if (!data) return;

      const viewElements = getViewElements(data, currentView);
      const viewConnectors = getViewConnectors(data, currentView);
      const currentLayout = getOrComputeLayout(currentView, viewElements, viewConnectors);
      const targetNode = currentLayout.nodes.find(n => n.ref === ref);

      const action = () => {
        setNavigationStack((prev) => [...prev, ref]);
        setSelectedNode(null);
        invalidateLayout(ref);
      };

      if (targetNode) {
        const canvas = document.querySelector('canvas');
        if (canvas) {
          const dpr = window.devicePixelRatio || 1;
          const tState = startTransition(targetNode, canvas.width / dpr, canvas.height / dpr);
          setPendingNavigation({ transitionState: tState, action });
          return;
        }
      }

      action(); // fallback if no canvas or node
    },
    [data, currentView]
  );

  const handleGoToLevel = useCallback(
    (index: number) => {
      if (!data) return;
      const targetViewRef = navigationStack[index];
      
      const action = () => {
        setNavigationStack((prev) => prev.slice(0, index + 1));
        setSelectedNode(null);
        invalidateLayout(targetViewRef);
      };

      if (index === navigationStack.length - 2) {
        const parentElements = getViewElements(data, targetViewRef);
        const parentConnectors = getViewConnectors(data, targetViewRef);
        const parentLayout = getOrComputeLayout(targetViewRef, parentElements, parentConnectors);
        const exitingNode = parentLayout.nodes.find(n => n.ref === currentView);

        if (exitingNode) {
          const canvas = document.querySelector('canvas');
          if (canvas) {
            action();
            const dpr = window.devicePixelRatio || 1;
            const tState = startExitTransition(parentLayout, exitingNode, canvas.width / dpr, canvas.height / dpr);
            setPendingNavigation({ transitionState: tState, action: () => {} });
            return;
          }
        }
      }

      action();
    },
    [data, navigationStack, currentView]
  );

  const handleGoUp = useCallback(() => {
    if (!data) return;
    if (navigationStack.length <= 1) {
      setSelectedNode(null);
      return;
    }
    handleGoToLevel(navigationStack.length - 2);
  }, [data, navigationStack, handleGoToLevel]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleGoUp();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleGoUp]);

  const handleHover = useCallback((ref: string | null, x: number, y: number) => {
    setHoveredNode(ref);
    setMousePos({ x, y });
  }, []);

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>Loading...</div>;
  }

  if (error || !data) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>Error: {error}</div>;
  }

  const viewElements = getViewElements(data, currentView);
  const viewConnectors = getViewConnectors(data, currentView);
  const layout = getOrComputeLayout(currentView, viewElements, viewConnectors);

  // Only compute stubs when the toggle is ON — avoids O(n*m) work on every render
  // when stubs are hidden. layout.nodes carries world-space positions for stub placement.
  const externalStubs = showExternalStubs
    ? computeExternalStubs(data, currentView, layout)
    : [];

  return (
    <div className="app">
      <div className="canvas-container">
        <div className="breadcrumb">
          {navigationStack.map((item, idx) => {
            const isLast = idx === navigationStack.length - 1;
            return (
              <React.Fragment key={item}>
                {idx > 0 && <span className="breadcrumb-separator">/</span>}
                <span
                  className={`breadcrumb-item ${isLast ? 'active' : ''}`}
                  onClick={() => !isLast && handleGoToLevel(idx)}
                  style={{ cursor: isLast ? 'default' : 'pointer', fontWeight: isLast ? 'bold' : 'normal' }}
                >
                  {item}
                </span>
              </React.Fragment>
            );
          })}
        </div>

        <Toolbar
          showExternalStubs={showExternalStubs}
          onToggleExternalStubs={() => setShowExternalStubs(!showExternalStubs)}
        />

        <CanvasViewport
          layout={layout}
          renderState={{
            hoveredNode,
            selectedNode,
            showExternalStubs,
            highlightedExternalEdges,
          }}
          elements={data.elements}
          externalStubs={externalStubs}
          onSelect={handleSelect}
          onEnterGroup={handleEnterGroup}
          onHover={handleHover}
          transitionState={pendingNavigation?.transitionState}
          onTransitionComplete={() => {
            if (pendingNavigation?.action) {
              pendingNavigation.action();
            }
            setPendingNavigation(null);
          }}
        />

        {hoveredNode && (
          <Tooltip
            nodeRef={hoveredNode}
            data={data}
            x={mousePos.x}
            y={mousePos.y}
          />
        )}
      </div>

      {selectedNode && (
        <SidePanel
          selectedNode={selectedNode}
          currentView={currentView}
          data={data}
          showExternalStubs={showExternalStubs}
          onToggleExternalStubs={() => setShowExternalStubs(!showExternalStubs)}
        />
      )}
    </div>
  );
};
