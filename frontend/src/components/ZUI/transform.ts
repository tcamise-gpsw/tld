export class Matrix {
  constructor(
    public a: number = 1,
    public b: number = 0,
    public c: number = 0,
    public d: number = 1,
    public e: number = 0,
    public f: number = 0,
  ) {}

  static identity(): Matrix {
    return new Matrix(1, 0, 0, 1, 0, 0)
  }

  static translate(tx: number, ty: number): Matrix {
    return new Matrix(1, 0, 0, 1, tx, ty)
  }

  static scale(sx: number, sy: number): Matrix {
    return new Matrix(sx, 0, 0, sy, 0, 0)
  }

  resetToIdentity(): this {
    this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0
    return this
  }

  setToTranslate(tx: number, ty: number): this {
    this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = tx; this.f = ty
    return this
  }

  setToScale(sx: number, sy: number): this {
    this.a = sx; this.b = 0; this.c = 0; this.d = sy; this.e = 0; this.f = 0
    return this
  }

  setFrom(a: number, b: number, c: number, d: number, e: number, f: number): this {
    this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f
    return this
  }

  multiply(other: Matrix): Matrix {
    return new Matrix(
      this.a * other.a + this.c * other.b,
      this.b * other.a + this.d * other.b,
      this.a * other.c + this.c * other.d,
      this.b * other.c + this.d * other.d,
      this.a * other.e + this.c * other.f + this.e,
      this.b * other.e + this.d * other.f + this.f,
    )
  }

  multiplySelf(other: Matrix): this {
    const a = this.a * other.a + this.c * other.b
    const b = this.b * other.a + this.d * other.b
    const c = this.a * other.c + this.c * other.d
    const d = this.b * other.c + this.d * other.d
    const e = this.a * other.e + this.c * other.f + this.e
    const f = this.b * other.e + this.d * other.f + this.f
    this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f
    return this
  }

  transformPoint(x: number, y: number): { x: number; y: number } {
    return {
      x: this.a * x + this.c * y + this.e,
      y: this.b * x + this.d * y + this.f,
    }
  }
}

const _tempA = new Matrix()
const _tempB = new Matrix()

export function composeMatrices(a: Matrix, b: Matrix, out: Matrix): Matrix {
  return out.setFrom(
    a.a * b.a + a.c * b.b,
    a.b * b.a + a.d * b.b,
    a.a * b.c + a.c * b.d,
    a.b * b.c + a.d * b.d,
    a.a * b.e + a.c * b.f + a.e,
    a.b * b.e + a.d * b.f + a.f,
  )
}

export function buildLocalTransformForNode(
  worldX: number,
  worldY: number,
  childScale: number,
  childOffsetX: number,
  childOffsetY: number,
  out: Matrix,
): Matrix {
  const sx = childScale > 0 ? childScale : 1
  return out.setFrom(sx, 0, 0, sx, worldX - childOffsetX * sx, worldY - childOffsetY * sx)
}

export function buildRootLocalTransform(worldX: number, worldY: number, out: Matrix): Matrix {
  return out.setToTranslate(worldX, worldY)
}

export function buildRebaseTransform(
  originX: number,
  originY: number,
  zoom: number,
  canvasCenterX: number,
  canvasCenterY: number,
  out: Matrix,
): Matrix {
  return out.setFrom(
    zoom, 0, 0, zoom,
    canvasCenterX - originX * zoom,
    canvasCenterY - originY * zoom,
  )
}
