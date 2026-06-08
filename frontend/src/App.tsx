import React, { useEffect, useState, useCallback, useMemo } from 'react';
import logoUrl from './assets/logo.png';
import { loadDiagramData, getViewElements, getViewConnectors, getDescendantRefs } from './data/loader';
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
  const [hoveredGroupIcon, setHoveredGroupIcon] = useState<string | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [showExternalStubs, setShowExternalStubs] = useState(true);
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
    const descendants = getDescendantRefs(data, selectedNode);
    const memberRefs = new Set<string>([selectedNode, ...descendants]);
    const viewDescendants = getDescendantRefs(data, currentView);
    const viewMembers = new Set<string>([currentView, ...viewDescendants]);

    const externalKeys: string[] = [];
    for (const conn of data.connectors) {
      const sourceInside = memberRefs.has(conn.source);
      const targetInside = memberRefs.has(conn.target);
      if (sourceInside === targetInside) continue;
      const otherRef = sourceInside ? conn.target : conn.source;
      if (!viewMembers.has(otherRef)) {
        externalKeys.push(`${conn.source}-${conn.target}`);
      }
    }
    return new Set(externalKeys);
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
        setSelectedNode(ref);
        invalidateLayout(ref);
        window.history.pushState({ depth: navigationStack.length + 1 }, '');
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

  const handleNavigateToElement = useCallback((targetRef: string) => {
    if (!data) return;

    const targetElement = data.elements.get(targetRef);
    if (!targetElement) return;

    const targetParent = targetElement.placements[0]?.parent || 'root';

    // Target is in the current view — drill in or select
    if (targetParent === currentView) {
      if (targetElement.has_view) {
        handleEnterGroup(targetRef);
      } else {
        setSelectedNode(targetRef);
      }
      return;
    }

    // Target is in a different view — navigate to its parent view, then select it
    const path: string[] = [];
    let cur = targetParent;
    while (cur !== 'root') {
      path.unshift(cur);
      const node = data.viewTree.nodes.get(cur);
      if (!node || node.parent === cur) break;
      cur = node.parent;
    }
    path.unshift('root');

    setNavigationStack(path);
    setSelectedNode(targetRef);
    invalidateLayout(targetParent);
    window.history.pushState({ depth: path.length }, '');
  }, [data, currentView, handleEnterGroup]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleGoUp();
      }
    };
    const handlePopState = () => {
      handleGoUp();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('popstate', handlePopState);
    };
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

  // Compute external stubs:
  // - Toggle ON: show all stubs
  // - Toggle OFF + node selected: show only the selected node's stubs
  // - Toggle OFF + no selection: hide all stubs
  const externalStubs = showExternalStubs
    ? computeExternalStubs(data, currentView, layout)
    : selectedNode
      ? computeExternalStubs(data, currentView, layout).filter(s => s.nodeRef === selectedNode)
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
                  onClick={() => isLast ? handleSelect(currentView) : handleGoToLevel(idx)}
                  style={{ cursor: 'pointer', fontWeight: isLast ? 'bold' : 'normal' }}
                >
                  {item}
                </span>
              </React.Fragment>
            );
          })}
        </div>

        <img src={logoUrl} alt="TL;DR" className="app-logo" />

        <Toolbar
          showExternalStubs={showExternalStubs}
          onToggleExternalStubs={() => setShowExternalStubs(!showExternalStubs)}
          onFitToContent={() => invalidateLayout(currentView)}
        />

        <CanvasViewport
          layout={layout}
          renderState={{
            hoveredNode,
            hoveredGroupIcon,
            selectedNode,
            showExternalStubs,
            highlightedExternalEdges,
          }}
          elements={data.elements}
          externalStubs={externalStubs}
          onSelect={handleSelect}
          onEnterGroup={handleEnterGroup}
          onHover={handleHover}
          onHoverGroupIcon={setHoveredGroupIcon}
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

      {(selectedNode || currentView !== 'root') && (
        <SidePanel
          selectedNode={selectedNode || currentView}
          currentView={currentView}
          data={data}
          onNavigateToElement={handleNavigateToElement}
        />
      )}
    </div>
  );
};
