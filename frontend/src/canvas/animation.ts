import { CameraState, INITIAL_CAMERA } from './camera';
import { ViewLayout } from './layout';

export interface TransitionState {
  active: boolean;
  progress: number;
  from: CameraState;
  to: CameraState;
  startTime: number;
  type: 'enter' | 'exit';
}

export const TRANSITION_DURATION = 300;

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function startTransition(targetNodeRect: { x: number; y: number; width: number; height: number }, canvasWidth: number, canvasHeight: number): TransitionState {
  const zoomX = (canvasWidth * 0.8) / targetNodeRect.width;
  const zoomY = (canvasHeight * 0.8) / targetNodeRect.height;
  const zoom = Math.min(zoomX, zoomY, 10);

  const to: CameraState = {
    x: canvasWidth / 2 - targetNodeRect.x * zoom,
    y: canvasHeight / 2 - targetNodeRect.y * zoom,
    zoom
  };

  return {
    active: true,
    progress: 0,
    from: INITIAL_CAMERA, // will be overridden by CanvasViewport
    to,
    startTime: Date.now(),
    type: 'enter'
  };
}

export function startExitTransition(parentViewLayout: ViewLayout, exitingNodeRect: { x: number; y: number; width: number; height: number }, canvasWidth: number, canvasHeight: number): TransitionState {
  const zoomX = (canvasWidth * 0.8) / exitingNodeRect.width;
  const zoomY = (canvasHeight * 0.8) / exitingNodeRect.height;
  const startZoom = Math.min(zoomX, zoomY, 10);

  const startCamera: CameraState = {
    x: canvasWidth / 2 - exitingNodeRect.x * startZoom,
    y: canvasHeight / 2 - exitingNodeRect.y * startZoom,
    zoom: startZoom
  };

  let minX = 0, maxX = 0, minY = 0, maxY = 0;
  if (parentViewLayout.nodes.length > 0) {
    minX = parentViewLayout.nodes[0].x - parentViewLayout.nodes[0].width / 2;
    maxX = parentViewLayout.nodes[0].x + parentViewLayout.nodes[0].width / 2;
    minY = parentViewLayout.nodes[0].y - parentViewLayout.nodes[0].height / 2;
    maxY = parentViewLayout.nodes[0].y + parentViewLayout.nodes[0].height / 2;
    for (const n of parentViewLayout.nodes) {
      minX = Math.min(minX, n.x - n.width / 2);
      maxX = Math.max(maxX, n.x + n.width / 2);
      minY = Math.min(minY, n.y - n.height / 2);
      maxY = Math.max(maxY, n.y + n.height / 2);
    }
  }

  const padding = 40;
  const parentContentWidth = maxX - minX + padding * 2;
  const parentContentHeight = maxY - minY + padding * 2;

  const toZoomX = canvasWidth / parentContentWidth;
  const toZoomY = canvasHeight / parentContentHeight;
  const toZoom = Math.min(toZoomX, toZoomY, 10);

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const to: CameraState = {
    x: canvasWidth / 2 - centerX * toZoom,
    y: canvasHeight / 2 - centerY * toZoom,
    zoom: toZoom
  };

  return {
    active: true,
    progress: 0,
    from: startCamera, // Note: for exit, `from` IS startCamera, App.tsx should NOT override it unless it's doing something else. 
    to,
    startTime: Date.now(),
    type: 'exit'
  };
}

export function updateTransition(state: TransitionState, now: number = Date.now()): { camera: CameraState; done: boolean } {
  if (!state.active) {
    return { camera: state.to, done: true };
  }
  
  const elapsed = now - state.startTime;
  state.progress = Math.min(elapsed / TRANSITION_DURATION, 1);
  const done = state.progress >= 1;
  const t = easeOutCubic(state.progress);
  
  const camera: CameraState = {
    x: state.from.x + (state.to.x - state.from.x) * t,
    y: state.from.y + (state.to.y - state.from.y) * t,
    zoom: state.from.zoom + (state.to.zoom - state.from.zoom) * t
  };

  return { camera, done };
}
