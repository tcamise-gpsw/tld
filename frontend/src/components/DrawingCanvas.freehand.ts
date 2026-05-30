import { getStroke, type StrokeOptions, type Vec2 } from 'perfect-freehand'

import type { DrawingPoint } from './DrawingCanvas'

export type StrokeInputPoint = [number, number] | [number, number, number]

const DEFAULT_PRESSURE = 0.5

export function clampPressure(pressure: number): number {
  if (!Number.isFinite(pressure)) return DEFAULT_PRESSURE
  return Math.max(0, Math.min(1, pressure))
}

export function pointFromPointerEvent(
  event: Pick<PointerEvent, 'clientX' | 'clientY' | 'pressure' | 'pointerType'>,
  toFlowPoint: (clientX: number, clientY: number) => { x: number; y: number },
): DrawingPoint {
  const flowPoint = toFlowPoint(event.clientX, event.clientY)
  if (event.pointerType !== 'pen') return flowPoint
  return { ...flowPoint, pressure: clampPressure(event.pressure) }
}

export function drawingPointsHavePressure(points: DrawingPoint[]): boolean {
  return points.some((point) => typeof point.pressure === 'number')
}

export function shouldSimulatePressure(points: DrawingPoint[]): boolean {
  return !drawingPointsHavePressure(points)
}

export function drawingPointsToStrokeInput(points: DrawingPoint[]): StrokeInputPoint[] {
  const hasPressure = drawingPointsHavePressure(points)
  return points.map((point) => (
    hasPressure
      ? [point.x, point.y, clampPressure(point.pressure ?? DEFAULT_PRESSURE)]
      : [point.x, point.y]
  ))
}

export function getDrawingStrokeOptions(points: DrawingPoint[], width: number, last: boolean): StrokeOptions {
  return {
    size: Math.max(1, width),
    thinning: 0.55,
    smoothing: 0.5,
    streamline: 0.45,
    simulatePressure: shouldSimulatePressure(points),
    start: { cap: true, taper: 0 },
    end: { cap: true, taper: 0 },
    last,
  }
}

function average(a: number, b: number): number {
  return (a + b) / 2
}

export function getSvgPathFromStroke(points: Vec2[], closed = true): string {
  const len = points.length
  if (len < 4) return ''

  let a = points[0]
  let b = points[1]
  const c = points[2]

  let result = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${average(b[0], c[0]).toFixed(2)},${average(b[1], c[1]).toFixed(2)} T`

  for (let i = 2, max = len - 1; i < max; i++) {
    a = points[i]
    b = points[i + 1]
    result += `${average(a[0], b[0]).toFixed(2)},${average(a[1], b[1]).toFixed(2)} `
  }

  if (closed) result += 'Z'
  return result
}

export function getDrawingPathData(points: DrawingPoint[], width: number, last: boolean): string {
  if (points.length === 0) return ''
  const outline = getStroke(drawingPointsToStrokeInput(points), getDrawingStrokeOptions(points, width, last))
  return getSvgPathFromStroke(outline)
}
