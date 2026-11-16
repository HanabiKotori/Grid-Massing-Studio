import type { Booth, Infra, Pt, Venue, VenueRules } from './types'

export interface ComplianceIssue {
  level: 'error' | 'warn'
  /** gap 间距 / wall 离墙 / height 限高 / gate 出入口 / aisle 通道 */
  code: 'gap' | 'wall' | 'height' | 'gate' | 'aisle'
  message: string
  boothIds: string[]
}

/** 点到线段的最短距离 */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const len2 = dx * dx + dz * dz
  if (len2 < 1e-9) return Math.hypot(p.x - a.x, p.z - a.z)
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz))
}

/** 两个多边形的最短距离（顶点到对边，双向取最小） */
export function polyPolyDist(a: Pt[], b: Pt[]): number {
  let min = Infinity
  for (const p of a) {
    for (let i = 0; i < b.length; i++) {
      const d = segDist(p, b[i], b[(i + 1) % b.length])
      if (d < min) min = d
    }
  }
  for (const p of b) {
    for (let i = 0; i < a.length; i++) {
      const d = segDist(p, a[i], a[(i + 1) % a.length])
      if (d < min) min = d
    }
  }
  return min
}

/** 多边形到场馆墙体的最短距离 */
function wallGap(venue: Pt[], booth: Pt[]): number {
  let min = Infinity
  for (const p of booth) {
    for (let i = 0; i < venue.length; i++) {
      const d = segDist(p, venue[i], venue[(i + 1) % venue.length])
      if (d < min) min = d
    }
  }
  return min
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * 规范校验：只做能稳定判定的项，避免误报。
 * - 展台高度超过限高
 * - 展台距场馆墙过近
 * - 展台之间净距过近
 * - 出入口数量 / 净宽不足
 * - 间距小于主通道宽度的位置做一次汇总提示
 */
export function checkCompliance(
  venue: Venue | null,
  booths: Booth[],
  infras: Infra[],
  rules: VenueRules,
): ComplianceIssue[] {
  if (!rules.enabled || !venue || venue.points.length < 3) return []
  const issues: ComplianceIssue[] = []
  const vp = venue.points

  for (const b of booths) {
    if (b.height > rules.maxBoothHeight + 1e-6) {
      issues.push({
        level: 'warn',
        code: 'height',
        message: `${b.name} 高度 ${round2(b.height)} m，超过限高 ${rules.maxBoothHeight} m`,
        boothIds: [b.id],
      })
    }
  }

  for (const b of booths) {
    if (b.points.length < 3) continue
    const gap = wallGap(vp, b.points)
    if (gap < rules.minGap - 1e-6) {
      issues.push({
        level: 'error',
        code: 'wall',
        message: `${b.name} 距场馆墙 ${round2(gap)} m，小于 ${rules.minGap} m`,
        boothIds: [b.id],
      })
    }
  }

  let aisleCount = 0
  for (let i = 0; i < booths.length; i++) {
    for (let j = i + 1; j < booths.length; j++) {
      const a = booths[i]
      const b = booths[j]
      if (a.points.length < 3 || b.points.length < 3) continue
      const d = polyPolyDist(a.points, b.points)
      if (d < 0.02) continue
      if (d < rules.minGap - 1e-6) {
        issues.push({
          level: 'error',
          code: 'gap',
          message: `${a.name} 与 ${b.name} 间距 ${round2(d)} m，小于 ${rules.minGap} m`,
          boothIds: [a.id, b.id],
        })
      } else if (d < rules.aisleWidth - 0.01) {
        aisleCount++
      }
    }
  }

  if (aisleCount > 0) {
    issues.push({
      level: 'warn',
      code: 'aisle',
      message: `${aisleCount} 处展台间距小于主通道 ${rules.aisleWidth} m，若为通道请加宽`,
      boothIds: [],
    })
  }

  const gates = infras.filter((i) => i.kind === 'gate')
  if (gates.length < rules.minGates) {
    issues.push({
      level: 'error',
      code: 'gate',
      message: `出入口 ${gates.length} 个，少于要求的 ${rules.minGates} 个`,
      boothIds: [],
    })
  }
  const narrow = gates.filter((g) => g.width < rules.minGateWidth - 1e-6)
  if (narrow.length) {
    issues.push({
      level: 'error',
      code: 'gate',
      message: `${narrow.length} 个出入口净宽小于 ${rules.minGateWidth} m`,
      boothIds: [],
    })
  }

  return issues
}
