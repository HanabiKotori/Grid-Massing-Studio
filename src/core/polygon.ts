import type { Pt } from './types'

const EPS = 1e-9

/** 有符号面积：逆时针（在 x-z 平面）为正 */
export function signedArea(pts: Pt[]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    s += a.x * b.z - b.x * a.z
  }
  return s / 2
}

export function polygonArea(pts: Pt[]): number {
  return Math.abs(signedArea(pts))
}

export function perimeter(pts: Pt[]): number {
  let len = 0
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    len += Math.hypot(b.x - a.x, b.z - a.z)
  }
  return len
}

export function boundsOf(pts: Pt[]) {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of pts) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minZ = Math.min(minZ, p.z)
    maxZ = Math.max(maxZ, p.z)
  }
  return { minX, maxX, minZ, maxZ }
}

/** 面心（按面积加权），退化时取顶点平均 */
export function centroid(pts: Pt[]): Pt {
  const a = signedArea(pts)
  if (Math.abs(a) < EPS) {
    const sum = pts.reduce((acc, p) => ({ x: acc.x + p.x, z: acc.z + p.z }), { x: 0, z: 0 })
    return { x: sum.x / pts.length, z: sum.z / pts.length }
  }
  let cx = 0
  let cz = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    const cross = p.x * q.z - q.x * p.z
    cx += (p.x + q.x) * cross
    cz += (p.z + q.z) * cross
  }
  return { x: cx / (6 * a), z: cz / (6 * a) }
}

/** 射线法判断点是否在多边形内部 */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    const intersect =
      a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z + EPS) + a.x
    if (intersect) inside = !inside
  }
  return inside
}

function intersectLines(p1: Pt, d1: Pt, p2: Pt, d2: Pt): Pt | null {
  const den = d1.x * d2.z - d1.z * d2.x
  if (Math.abs(den) < 1e-8) return null
  const t = ((p2.x - p1.x) * d2.z - (p2.z - p1.z) * d2.x) / den
  return { x: p1.x + d1.x * t, z: p1.z + d1.z * t }
}

/**
 * 多边形向内收缩（等距偏移），返回新的顶点序列。
 * 用于生成有厚度的墙体。
 */
export function insetPolygon(pts: Pt[], distance: number): Pt[] | null {
  const n = pts.length
  if (n < 3 || distance === 0) return pts.map((p) => ({ ...p }))

  const sign = signedArea(pts) > 0 ? 1 : -1
  const lines: { p: Pt; d: Pt }[] = []
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len = Math.hypot(dx, dz)
    if (len < EPS) return null
    const ux = dx / len
    const uz = dz / len
    // 逆时针时内部在左法线方向
    const nx = -uz * sign
    const nz = ux * sign
    lines.push({ p: { x: a.x + nx * distance, z: a.z + nz * distance }, d: { x: ux, z: uz } })
  }

  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const l1 = lines[(i - 1 + n) % n]
    const l2 = lines[i]
    const hit = intersectLines(l1.p, l1.d, l2.p, l2.d)
    if (!hit) return null
    out.push(hit)
  }

  // 收缩后若面积反而变大/翻向，说明多边形太窄，视为无效
  const a0 = signedArea(pts)
  const a1 = signedArea(out)
  if (Math.sign(a0) !== Math.sign(a1) || Math.abs(a1) > Math.abs(a0)) return null
  if (Math.abs(a1) < 0.05) return null
  return out
}

function segIntersect(a1: Pt, a2: Pt, b1: Pt, b2: Pt): boolean {
  const d1x = a2.x - a1.x
  const d1z = a2.z - a1.z
  const d2x = b2.x - b1.x
  const d2z = b2.z - b1.z
  const den = d1x * d2z - d1z * d2x
  if (Math.abs(den) < 1e-10) return false
  const rx = b1.x - a1.x
  const rz = b1.z - a1.z
  const t = (rx * d2z - d2x * rz) / den
  const u = (rx * d1z - d1x * rz) / den
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6
}

/** 判断多边形是否为简单多边形（无自相交、无重复点） */
export function isSimplePolygon(pts: Pt[]): boolean {
  const n = pts.length
  if (n < 3) return false
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-4) return false
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // 相邻边共享顶点，跳过
      if (j === i) continue
      if ((j + 1) % n === i || (i + 1) % n === j) continue
      if (segIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false
    }
  }
  return true
}

/** 两个多边形是否重叠（相交或包含） */
export function polygonsOverlap(a: Pt[], b: Pt[]): boolean {
  for (const p of a) if (pointInPolygon(p, b)) return true
  for (const p of b) if (pointInPolygon(p, a)) return true
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segIntersect(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true
    }
  }
  return false
}

/** 多边形是否完全落在容器内部（顶点 + 边中点采样） */
export function polygonInsidePolygon(inner: Pt[], outer: Pt[]): boolean {
  const samples: Pt[] = []
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i]
    const b = inner[(i + 1) % inner.length]
    samples.push(a, { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 })
  }
  return samples.every((p) => pointInPolygon(p, outer))
}

/** 吸附到网格 */
export function snapToGrid(p: Pt, step = 1): Pt {
  return { x: Math.round(p.x / step) * step, z: Math.round(p.z / step) * step }
}
