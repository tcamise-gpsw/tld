import { describe, expect, it } from 'vitest'

import {
  clampPressure,
  drawingPointsToStrokeInput,
  getDrawingPathData,
  getDrawingStrokeOptions,
  pointFromPointerEvent,
  shouldSimulatePressure,
} from './DrawingCanvas.freehand'

describe('DrawingCanvas freehand helpers', () => {
  it('clamps stylus pressure and omits pressure for non-pen pointers', () => {
    const toFlowPoint = (clientX: number, clientY: number) => ({ x: clientX / 2, y: clientY / 2 })

    expect(clampPressure(-0.4)).toBe(0)
    expect(clampPressure(1.8)).toBe(1)
    expect(clampPressure(Number.NaN)).toBe(0.5)

    expect(pointFromPointerEvent({ clientX: 20, clientY: 40, pressure: 0.8, pointerType: 'mouse' }, toFlowPoint))
      .toEqual({ x: 10, y: 20 })
    expect(pointFromPointerEvent({ clientX: 20, clientY: 40, pressure: 1.8, pointerType: 'pen' }, toFlowPoint))
      .toEqual({ x: 10, y: 20, pressure: 1 })
  })

  it('selects simulated pressure only for unpressured paths', () => {
    const mousePoints = [{ x: 0, y: 0 }, { x: 10, y: 10 }]
    const penPoints = [{ x: 0, y: 0, pressure: 0.2 }, { x: 10, y: 10, pressure: 0.8 }]

    expect(shouldSimulatePressure(mousePoints)).toBe(true)
    expect(getDrawingStrokeOptions(mousePoints, 6, true).simulatePressure).toBe(true)
    expect(drawingPointsToStrokeInput(mousePoints)).toEqual([[0, 0], [10, 10]])

    expect(shouldSimulatePressure(penPoints)).toBe(false)
    expect(getDrawingStrokeOptions(penPoints, 6, true).simulatePressure).toBe(false)
    expect(drawingPointsToStrokeInput(penPoints)).toEqual([[0, 0, 0.2], [10, 10, 0.8]])
  })

  it('generates path data for multi-point and dot-like single-point strokes', () => {
    expect(getDrawingPathData([{ x: 0, y: 0 }, { x: 24, y: 12 }, { x: 48, y: 4 }], 8, true))
      .toMatch(/^M.+Z$/)
    expect(getDrawingPathData([{ x: 4, y: 8, pressure: 0.5 }], 8, true))
      .toMatch(/^M.+Z$/)
  })
})
