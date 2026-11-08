/** 合并组的标记色（用于模型描边与结构列表色标） */
const PALETTE = [0x0f9d8f, 0xc2681f, 0x8e5bd0, 0x4d7c0f, 0xc0397a, 0x3f7fbf, 0x9d7b2f, 0x2b7f74]

export function groupColor(groupId: string): number {
  const n = Number(groupId.replace(/\D/g, '')) || 1
  return PALETTE[(n - 1) % PALETTE.length]
}

export function groupCss(groupId: string): string {
  return `#${groupColor(groupId).toString(16).padStart(6, '0')}`
}
