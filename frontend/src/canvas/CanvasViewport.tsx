import React, { useRef, useEffect, useState, useCallback } from 'react';
import { CameraState, screenToWorld, pan, zoomAtPoint, INITIAL_CAMERA, fitToContent } from './camera';
import { hitTestNodes, isDrag, hitTestGroupIcon } from './hitTest';
import { renderFrame, RenderState, ExternalStub } from './renderer';
import { ViewLayout } from './layout';
import { TransitionState, updateTransition } from './animation';
import { Element } from '../data/types';

interface CanvasViewportProps {
  layout: ViewLayout;
  renderState: RenderState;
  elements: Map<string, Element>;
  externalStubs?: ExternalStub[];
  onSelect: (ref: string | null) => void;
  onEnterGroup: (ref: string) => void;
  onHover: (ref: string | null, x: number, y: number) => void;
  transitionState?: TransitionState | null;
  onTransitionComplete?: () => void;
}

export const CanvasViewport: React.FC<CanvasViewportProps> = ({
  layout,
  renderState,
  elements,
  externalStubs = [],
  onSelect,
  onEnterGroup,
  onHover,
  transitionState,
  onTransitionComplete,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<CameraState>(INITIAL_CAMERA);
  const currentTransitionRef = useRef<TransitionState | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dirtyRef = useRef(true);
  const rafRef = useRef<number | null>(null);

  const [dpr] = useState(window.devicePixelRatio || 1);

  // When transitionState prop changes, apply it
  useEffect(() => {
    if (transitionState) {
      currentTransitionRef.current = { ...transitionState };
      dirtyRef.current = true;
    }
  }, [transitionState]);

  // Handle resize
  const needsFitRef = useRef(true);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeObserver = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      // Refit on initial resize (first time canvas gets real dimensions)
      if (needsFitRef.current && layout.nodes.length > 0) {
        cameraRef.current = fitToContent(layout.nodes, rect.width, rect.height, 40);
        needsFitRef.current = false;
      }
      dirtyRef.current = true;
    });

    resizeObserver.observe(canvas);
    return () => resizeObserver.disconnect();
  }, [dpr, layout.nodes]);

  // Render loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Mark dirty whenever any render-state dependency changes (renderState,
    // externalStubs, layout, elements …) so the first frame of the new loop
    // always redraws instead of skipping due to a stale dirty=false.
    dirtyRef.current = true;

    const render = () => {
      // Update animation if active
      if (currentTransitionRef.current?.active) {
        const { camera, done } = updateTransition(currentTransitionRef.current);
        cameraRef.current = camera;
        if (done) {
          currentTransitionRef.current.active = false;
          if (onTransitionComplete) {
            onTransitionComplete();
          }
        }
        dirtyRef.current = true;
      }

      if (dirtyRef.current) {
        renderFrame(ctx, layout, cameraRef.current, renderState, elements, dpr, externalStubs);
        dirtyRef.current = false;
      }
      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [layout, renderState, elements, dpr, onTransitionComplete, externalStubs]);

  // Snap to layout fitToContent if no transition is active AND we just got a new layout
  const lastLayoutRef = useRef<ViewLayout | null>(null);
  useEffect(() => {
    if (lastLayoutRef.current !== layout) {
      lastLayoutRef.current = layout;
      needsFitRef.current = true;
      if (!currentTransitionRef.current?.active && layout.nodes.length > 0) {
        const canvas = canvasRef.current;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            cameraRef.current = fitToContent(layout.nodes, rect.width, rect.height, 40);
            needsFitRef.current = false;
          }
          dirtyRef.current = true;
        }
      }
    }
  }, [layout, dpr]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (currentTransitionRef.current?.active) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    cameraRef.current = zoomAtPoint(cameraRef.current, screenX, screenY, -e.deltaY);
    dirtyRef.current = true;
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (currentTransitionRef.current?.active) return;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (currentTransitionRef.current?.active) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    if (dragStartRef.current && e.buttons === 1) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      cameraRef.current = pan(cameraRef.current, dx, dy);
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      dirtyRef.current = true;
    }

    const worldPoint = screenToWorld(screenX, screenY, cameraRef.current);
    const hitRef = hitTestNodes(worldPoint.x, worldPoint.y, layout.nodes);
    onHover(hitRef, e.clientX, e.clientY);
  }, [layout.nodes, onHover]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (currentTransitionRef.current?.active) return;
    if (!dragStartRef.current) return;

    const isDragging = isDrag(dragStartRef.current.x, dragStartRef.current.y, e.clientX, e.clientY);
    dragStartRef.current = null;

    if (!isDragging) {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const worldPoint = screenToWorld(screenX, screenY, cameraRef.current);
      const iconHitRef = hitTestGroupIcon(worldPoint.x, worldPoint.y, layout.nodes);
      if (iconHitRef) {
        onEnterGroup(iconHitRef);
      } else {
        const hitRef = hitTestNodes(worldPoint.x, worldPoint.y, layout.nodes);
        onSelect(hitRef);
      }
    }
  }, [layout.nodes, onSelect, onEnterGroup]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    if (currentTransitionRef.current?.active) return;
    
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPoint = screenToWorld(screenX, screenY, cameraRef.current);
    const hitRef = hitTestNodes(worldPoint.x, worldPoint.y, layout.nodes);

    if (hitRef) {
      const node = layout.nodes.find((n) => n.ref === hitRef);
      if (node?.isGroup) {
        onEnterGroup(hitRef);
      }
    }
  }, [layout.nodes, onEnterGroup]);

  useEffect(() => {
    if (transitionState && transitionState.active) {
      currentTransitionRef.current = {
        ...transitionState,
        from: transitionState.type === 'enter' ? cameraRef.current : transitionState.from
      };
      dirtyRef.current = true;
    }
  }, [transitionState]);

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', width: '100%', height: '100%' }}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
    />
  );
};
