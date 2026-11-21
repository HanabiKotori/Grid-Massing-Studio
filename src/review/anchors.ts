import type { Booth, Infra, Pt } from '../core/types'
import type { CommentAnchor } from '../core/shareApi'

export interface ResolvedAnchor {
  x: number
  y: number
  z: number
  valid: boolean
  moved: boolean
  label: string
}

function boothCenter(booth: Booth): Pt {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of booth.points) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minZ = Math.min(minZ, p.z)
    maxZ = Math.max(maxZ, p.z)
  }
  if (!Number.isFinite(minX)) return { x: 0, z: 0 }
  return { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 }
}

export function objectOrigin(
  object: { kind: 'booth' | 'infra'; id: string } | undefined,
  booths: Booth[],
  infras: Infra[],
): [number, number] | null {
  if (!object) return null
  if (object.kind === 'booth') {
    const booth = booths.find((b) => b.id === object.id)
    if (!booth) return null
    const c = boothCenter(booth)
    return [c.x, c.z]
  }
  const infra = infras.find((it) => it.id === object.id)
  return infra ? [infra.x, infra.z] : null
}

export function objectLabel(
  object: { kind: 'booth' | 'infra'; id: string } | undefined,
  booths: Booth[],
  infras: Infra[],
): string {
  if (!object) return '场馆'
  if (object.kind === 'booth') {
    return booths.find((b) => b.id === object.id)?.name ?? '已删除展台'
  }
  return infras.find((it) => it.id === object.id)?.name ?? '已删除设施'
}

export function resolveAnchor(
  anchor: CommentAnchor,
  booths: Booth[],
  infras: Infra[],
): ResolvedAnchor {
  const point = anchor.point ?? [0, 0, 0]
  const label = objectLabel(anchor.object, booths, infras)
  if (!anchor.object) {
    return { x: point[0], y: point[1], z: point[2], valid: true, moved: false, label }
  }
  const current = objectOrigin(anchor.object, booths, infras)
  if (!current) {
    return { x: point[0], y: point[1], z: point[2], valid: false, moved: false, label }
  }
  const origin = anchor.objectOrigin
  if (!origin) {
    return { x: point[0], y: point[1], z: point[2], valid: true, moved: false, label }
  }
  const dx = point[0] - origin[0]
  const dz = point[2] - origin[1]
  const moved = Math.hypot(current[0] - origin[0], current[1] - origin[1]) > 0.01
  return {
    x: current[0] + dx,
    y: point[1],
    z: current[1] + dz,
    valid: true,
    moved,
    label,
  }
}

export function makeAnchor(
  point: [number, number, number],
  object: { kind: 'booth' | 'infra'; id: string } | undefined,
  booths: Booth[],
  infras: Infra[],
): CommentAnchor {
  const origin = objectOrigin(object, booths, infras)
  return {
    point,
    ...(object ? { object } : {}),
    ...(origin ? { objectOrigin: origin } : {}),
  }
}
