import { describe, it, expect } from 'vitest';
import {
  screenToWorld,
  worldToScreen,
  zoomAtPoint,
  pan,
  clampZoom,
  fitToContent,
  INITIAL_CAMERA,
  MIN_ZOOM,
  MAX_ZOOM,
} from './camera';

describe('Camera Module', () => {
  describe('screenToWorld', () => {
    it('converts screen coordinates to world coordinates', () => {
      const camera = { x: 0, y: 0, zoom: 1 };
      const world = screenToWorld(100, 200, camera);
      expect(world.x).toBe(100);
      expect(world.y).toBe(200);
    });

    it('accounts for pan offset', () => {
      const camera = { x: 50, y: 100, zoom: 1 };
      const world = screenToWorld(150, 200, camera);
      expect(world.x).toBe(100);
      expect(world.y).toBe(100);
    });

    it('accounts for zoom', () => {
      const camera = { x: 0, y: 0, zoom: 2 };
      const world = screenToWorld(200, 400, camera);
      expect(world.x).toBe(100);
      expect(world.y).toBe(200);
    });
  });

  describe('worldToScreen', () => {
    it('converts world coordinates to screen coordinates', () => {
      const camera = { x: 0, y: 0, zoom: 1 };
      const screen = worldToScreen(100, 200, camera);
      expect(screen.x).toBe(100);
      expect(screen.y).toBe(200);
    });

    it('accounts for pan offset', () => {
      const camera = { x: 50, y: 100, zoom: 1 };
      const screen = worldToScreen(100, 100, camera);
      expect(screen.x).toBe(150);
      expect(screen.y).toBe(200);
    });

    it('accounts for zoom', () => {
      const camera = { x: 0, y: 0, zoom: 2 };
      const screen = worldToScreen(100, 200, camera);
      expect(screen.x).toBe(200);
      expect(screen.y).toBe(400);
    });
  });

  describe('Coordinate transforms roundtrip', () => {
    it('screenToWorld → worldToScreen returns original coordinates', () => {
      const camera = { x: 100, y: 50, zoom: 2 };
      const originalScreen = { x: 300, y: 200 };
      const world = screenToWorld(originalScreen.x, originalScreen.y, camera);
      const screen = worldToScreen(world.x, world.y, camera);
      expect(screen.x).toBeCloseTo(originalScreen.x, 5);
      expect(screen.y).toBeCloseTo(originalScreen.y, 5);
    });
  });

  describe('zoomAtPoint', () => {
    it('zooms in at cursor position', () => {
      const camera = { x: 0, y: 0, zoom: 1 };
      const newCamera = zoomAtPoint(camera, 400, 300, 100);
      expect(newCamera.zoom).toBeGreaterThan(1);
      expect(newCamera.zoom).toBeLessThanOrEqual(MAX_ZOOM);
    });

    it('zooms out at cursor position', () => {
      const camera = { x: 0, y: 0, zoom: 2 };
      const newCamera = zoomAtPoint(camera, 400, 300, -100);
      expect(newCamera.zoom).toBeLessThan(2);
      expect(newCamera.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
    });

    it('preserves cursor world point after zoom', () => {
      const camera = { x: 0, y: 0, zoom: 1 };
      const cursorScreen = { x: 400, y: 300 };
      const worldPoint = screenToWorld(cursorScreen.x, cursorScreen.y, camera);
      const newCamera = zoomAtPoint(camera, cursorScreen.x, cursorScreen.y, 50);
      const newScreenPoint = worldToScreen(worldPoint.x, worldPoint.y, newCamera);
      expect(newScreenPoint.x).toBeCloseTo(cursorScreen.x, 5);
      expect(newScreenPoint.y).toBeCloseTo(cursorScreen.y, 5);
    });

    it('clamps zoom to bounds', () => {
      const camera = { x: 0, y: 0, zoom: 1 };
      const zoomedIn = zoomAtPoint(camera, 400, 300, 10000);
      expect(zoomedIn.zoom).toBeLessThanOrEqual(MAX_ZOOM);
      const zoomedOut = zoomAtPoint(camera, 400, 300, -10000);
      expect(zoomedOut.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
    });
  });

  describe('pan', () => {
    it('applies pan offset', () => {
      const camera = { x: 0, y: 0, zoom: 1 };
      const panned = pan(camera, 100, 50);
      expect(panned.x).toBe(100);
      expect(panned.y).toBe(50);
      expect(panned.zoom).toBe(1);
    });

    it('accumulates pan offsets', () => {
      const camera = { x: 0, y: 0, zoom: 1 };
      const panned1 = pan(camera, 100, 50);
      const panned2 = pan(panned1, 50, 25);
      expect(panned2.x).toBe(150);
      expect(panned2.y).toBe(75);
    });
  });

  describe('clampZoom', () => {
    it('clamps zoom above MIN_ZOOM', () => {
      const camera = { x: 0, y: 0, zoom: 0.05 };
      const clamped = clampZoom(camera);
      expect(clamped.zoom).toBeGreaterThanOrEqual(MIN_ZOOM);
    });

    it('clamps zoom below MAX_ZOOM', () => {
      const camera = { x: 0, y: 0, zoom: 15 };
      const clamped = clampZoom(camera);
      expect(clamped.zoom).toBeLessThanOrEqual(MAX_ZOOM);
    });

    it('preserves valid zoom', () => {
      const camera = { x: 0, y: 0, zoom: 2 };
      const clamped = clampZoom(camera);
      expect(clamped.zoom).toBe(2);
    });
  });

  describe('fitToContent', () => {
    it('returns INITIAL_CAMERA for empty nodes', () => {
      const result = fitToContent([], 800, 600);
      expect(result).toEqual(INITIAL_CAMERA);
    });

    it('fits single node in viewport', () => {
      const nodes = [{ x: 0, y: 0, width: 200, height: 100 }];
      const result = fitToContent(nodes, 800, 600, 40);
      expect(result.zoom).toBeGreaterThan(0);
      expect(result.zoom).toBeLessThanOrEqual(MAX_ZOOM);
    });

    it('fits multiple nodes in viewport', () => {
      const nodes = [
        { x: 0, y: 0, width: 200, height: 100 },
        { x: 500, y: 500, width: 200, height: 100 },
      ];
      const result = fitToContent(nodes, 800, 600, 40);
      expect(result.zoom).toBeGreaterThan(0);
      expect(result.zoom).toBeLessThanOrEqual(MAX_ZOOM);
    });

    it('respects padding', () => {
      const nodes = [{ x: 0, y: 0, width: 200, height: 100 }];
      const result1 = fitToContent(nodes, 800, 600, 10);
      const result2 = fitToContent(nodes, 800, 600, 100);
      expect(result1.zoom).toBeGreaterThan(result2.zoom);
    });
  });
});
