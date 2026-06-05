import { describe, it, expect } from 'vitest';
import { startTransition, startExitTransition, updateTransition, TRANSITION_DURATION, easeOutCubic } from './animation';
import { CameraState, INITIAL_CAMERA } from './camera';

describe('Animation Module', () => {
  describe('easeOutCubic', () => {
    it('returns 0 at t=0', () => {
      expect(easeOutCubic(0)).toBe(0);
    });
    it('returns 1 at t=1', () => {
      expect(easeOutCubic(1)).toBe(1);
    });
    it('returns intermediate values correctly', () => {
      expect(easeOutCubic(0.5)).toBe(0.875);
    });
  });

  describe('startTransition (enter)', () => {
    it('creates transition targeting ~80% of canvas', () => {
      const targetRect = { x: 100, y: 100, width: 200, height: 200 };
      const canvasWidth = 1000;
      const canvasHeight = 1000;
      
      const transition = startTransition(targetRect, canvasWidth, canvasHeight);
      
      expect(transition.active).toBe(true);
      expect(transition.progress).toBe(0);
      expect(transition.type).toBe('enter');
      expect(transition.from).toEqual(INITIAL_CAMERA);
      
      // Target zoom should be 80% of canvas divided by node size:
      // (1000 * 0.8) / 200 = 4.0
      expect(transition.to.zoom).toBe(4.0);
      
      // Target x should center the node:
      // canvasWidth / 2 - targetRect.x * zoom
      // 500 - 100 * 4 = 100
      expect(transition.to.x).toBe(100);
      expect(transition.to.y).toBe(100);
    });
  });

  describe('startExitTransition (exit)', () => {
    it('creates transition from exiting node rect to parent fitToContent', () => {
      const exitingNodeRect = { x: 100, y: 100, width: 200, height: 200 };
      const parentLayout = {
        nodes: [
          { ref: 'n1', x: 0, y: 0, width: 100, height: 100, isGroup: false, data: {} as any },
          { ref: 'n2', x: 500, y: 500, width: 100, height: 100, isGroup: false, data: {} as any }
        ],
        edges: [],
        width: 1000,
        height: 1000
      };
      const canvasWidth = 1000;
      const canvasHeight = 1000;

      const transition = startExitTransition(parentLayout, exitingNodeRect, canvasWidth, canvasHeight);

      expect(transition.active).toBe(true);
      expect(transition.type).toBe('exit');
      
      // Start zoom should frame the exiting node to 80% of canvas
      // (1000 * 0.8) / 200 = 4.0
      expect(transition.from.zoom).toBe(4.0);
      
      // End camera frames the parent view which spans from -50 to +550
      // That's a width/height of 600, plus 40*2 padding = 680
      // 1000 / 680 ≈ 1.4705
      expect(transition.to.zoom).toBeCloseTo(1.4705, 3);
    });
  });

  describe('updateTransition', () => {
    it('interpolates correctly over time', () => {
      const fromCamera: CameraState = { x: 0, y: 0, zoom: 1 };
      const toCamera: CameraState = { x: 100, y: 100, zoom: 2 };
      const startTime = 1000;
      
      const transition = {
        active: true,
        progress: 0,
        from: fromCamera,
        to: toCamera,
        startTime,
        type: 'enter' as const
      };

      // At start
      let result = updateTransition(transition, startTime);
      expect(result.done).toBe(false);
      expect(result.camera).toEqual(fromCamera);

      // At half time (150ms of 300ms)
      result = updateTransition(transition, startTime + TRANSITION_DURATION / 2);
      expect(result.done).toBe(false);
      // easeOutCubic(0.5) = 0.875
      expect(result.camera.x).toBe(87.5);
      expect(result.camera.y).toBe(87.5);
      expect(result.camera.zoom).toBe(1.875);

      // At end
      result = updateTransition(transition, startTime + TRANSITION_DURATION);
      expect(result.done).toBe(true);
      expect(result.camera).toEqual(toCamera);
    });

    it('clamps to end values when time exceeds duration', () => {
      const fromCamera: CameraState = { x: 0, y: 0, zoom: 1 };
      const toCamera: CameraState = { x: 100, y: 100, zoom: 2 };
      const startTime = 1000;
      
      const transition = {
        active: true,
        progress: 0,
        from: fromCamera,
        to: toCamera,
        startTime,
        type: 'enter' as const
      };

      const result = updateTransition(transition, startTime + TRANSITION_DURATION + 100);
      expect(result.done).toBe(true);
      expect(result.camera).toEqual(toCamera);
    });

    it('returns target camera directly if transition is inactive', () => {
      const toCamera: CameraState = { x: 100, y: 100, zoom: 2 };
      
      const transition = {
        active: false,
        progress: 0,
        from: INITIAL_CAMERA,
        to: toCamera,
        startTime: 0,
        type: 'enter' as const
      };

      const result = updateTransition(transition, 9999);
      expect(result.done).toBe(true);
      expect(result.camera).toEqual(toCamera);
    });
  });
});
