export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export const INITIAL_CAMERA: CameraState = { x: 0, y: 0, zoom: 1 };
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 10;

export function screenToWorld(screenX: number, screenY: number, camera: CameraState): { x: number; y: number } {
  return {
    x: (screenX - camera.x) / camera.zoom,
    y: (screenY - camera.y) / camera.zoom,
  };
}

export function worldToScreen(worldX: number, worldY: number, camera: CameraState): { x: number; y: number } {
  return {
    x: worldX * camera.zoom + camera.x,
    y: worldY * camera.zoom + camera.y,
  };
}

export function zoomAtPoint(camera: CameraState, screenX: number, screenY: number, delta: number): CameraState {
  const worldPoint = screenToWorld(screenX, screenY, camera);
  const zoomFactor = 1 + delta * 0.001;
  const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * zoomFactor));
  const screenPoint = worldToScreen(worldPoint.x, worldPoint.y, { ...camera, zoom: newZoom });
  return {
    x: screenX - screenPoint.x + camera.x,
    y: screenY - screenPoint.y + camera.y,
    zoom: newZoom,
  };
}

export function pan(camera: CameraState, dx: number, dy: number): CameraState {
  return {
    x: camera.x + dx,
    y: camera.y + dy,
    zoom: camera.zoom,
  };
}

export function clampZoom(camera: CameraState): CameraState {
  return {
    x: camera.x,
    y: camera.y,
    zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom)),
  };
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function fitToContent(nodes: BoundingBox[], canvasWidth: number, canvasHeight: number, padding: number = 40): CameraState {
  if (nodes.length === 0) {
    return INITIAL_CAMERA;
  }

  let minX = nodes[0].x - nodes[0].width / 2;
  let maxX = nodes[0].x + nodes[0].width / 2;
  let minY = nodes[0].y - nodes[0].height / 2;
  let maxY = nodes[0].y + nodes[0].height / 2;

  for (const node of nodes) {
    minX = Math.min(minX, node.x - node.width / 2);
    maxX = Math.max(maxX, node.x + node.width / 2);
    minY = Math.min(minY, node.y - node.height / 2);
    maxY = Math.max(maxY, node.y + node.height / 2);
  }

  const contentWidth = maxX - minX + padding * 2;
  const contentHeight = maxY - minY + padding * 2;

  const zoomX = canvasWidth / contentWidth;
  const zoomY = canvasHeight / contentHeight;
  const zoom = Math.min(zoomX, zoomY, MAX_ZOOM);

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return {
    x: canvasWidth / 2 - centerX * zoom,
    y: canvasHeight / 2 - centerY * zoom,
    zoom,
  };
}
