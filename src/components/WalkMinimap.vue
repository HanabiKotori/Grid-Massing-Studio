<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { isFurnitureKind } from '../core/infra'
import type { Booth, Infra, Pt, Venue } from '../core/types'

interface MinimapPlayer {
  id: string
  nickname: string
  x: number
  z: number
  color?: string
}

const props = defineProps<{
  venue: Venue | null
  booths: Booth[]
  infras: Infra[]
  pose: { x: number; z: number; yaw: number } | null
  mobile?: boolean
  expanded?: boolean
  players?: MinimapPlayer[]
}>()

const emit = defineEmits<{
  (e: 'collapse'): void
}>()

const rootEl = ref<HTMLDivElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const expandedLocal = ref(false)
const activePlayerId = ref<string | null>(null)
const isExpanded = computed(() => !!props.expanded || expandedLocal.value)
let observer: ResizeObserver | null = null

interface PlayerHit {
  id: string
  x: number
  y: number
  radius: number
}
let playerHits: PlayerHit[] = []

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function drawPlayerLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  uiScale: number,
  width: number,
  height: number,
) {
  const fontSize = Math.min(14, Math.max(10, Math.round(9 * uiScale)))
  const label = text.length > 22 ? `${text.slice(0, 21)}…` : text
  ctx.save()
  ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  const textWidth = ctx.measureText(label).width
  const boxW = Math.min(width - 8, textWidth + 14)
  const boxH = fontSize + 10
  const boxX = Math.max(4, Math.min(width - boxW - 4, x - boxW / 2))
  let boxY = y - boxH - 11
  if (boxY < 4) boxY = y + 12
  boxY = Math.max(4, Math.min(height - boxH - 4, boxY))
  roundRect(ctx, boxX, boxY, boxW, boxH, 5)
  ctx.fillStyle = 'rgba(15, 18, 24, 0.92)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)'
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, boxX + 7, boxY + boxH / 2 + 0.5)
  ctx.restore()
}

function draw() {
  const canvas = canvasEl.value
  const pose = props.pose
  if (!canvas || !pose) return
  const rect = canvas.getBoundingClientRect()
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const width = Math.max(1, Math.round(rect.width * dpr))
  const height = Math.max(1, Math.round(rect.height * dpr))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const w = rect.width
  const h = rect.height
  const uiScale = Math.max(1, Math.min(3, w / 156))
  ctx.clearRect(0, 0, w, h)

  const points: Pt[] = props.venue ? [...props.venue.points] : []
  if (!points.length) {
    for (const b of props.booths) points.push(...b.points)
  }
  if (!points.length) return
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minZ = Math.min(minZ, p.z)
    maxZ = Math.max(maxZ, p.z)
  }
  const pad = Math.max(10, 10 * uiScale)
  const worldW = Math.max(2, maxX - minX)
  const worldD = Math.max(2, maxZ - minZ)
  const scale = Math.min((w - pad * 2) / worldW, (h - pad * 2) / worldD)
  const offsetX = (w - worldW * scale) / 2 - minX * scale
  const offsetY = (h - worldD * scale) / 2 - minZ * scale
  const mapX = (x: number) => offsetX + x * scale
  const mapY = (z: number) => offsetY + z * scale

  ctx.fillStyle = isExpanded.value
    ? 'rgba(15, 18, 24, 0.97)'
    : 'rgba(20, 24, 30, 0.82)'
  ctx.fillRect(0, 0, w, h)

  if (props.venue) {
    ctx.beginPath()
    props.venue.points.forEach((p, i) => {
      const x = mapX(p.x)
      const y = mapY(p.z)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.closePath()
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.62)'
    ctx.lineWidth = 1.2
    ctx.stroke()
  }

  for (const booth of props.booths) {
    ctx.beginPath()
    booth.points.forEach((p, i) => {
      const x = mapX(p.x)
      const y = mapY(p.z)
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.closePath()
    ctx.fillStyle = 'rgba(196, 166, 112, 0.38)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.34)'
    ctx.lineWidth = 0.8
    ctx.stroke()
  }

  for (const item of props.infras) {
    if (isFurnitureKind(item.kind)) continue
    const ux = Math.cos(item.rotation)
    const uz = -Math.sin(item.rotation)
    const vx = Math.sin(item.rotation)
    const vz = Math.cos(item.rotation)
    const hw = item.width / 2
    const hd = item.depth / 2

    if (item.kind === 'wall' || item.kind === 'gate' || item.kind === 'window') {
      const x1 = mapX(item.x - ux * hw)
      const y1 = mapY(item.z - uz * hw)
      const x2 = mapX(item.x + ux * hw)
      const y2 = mapY(item.z + uz * hw)
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.strokeStyle =
        item.kind === 'gate'
          ? 'rgba(110, 210, 160, 0.95)'
          : item.kind === 'window'
            ? 'rgba(140, 210, 235, 0.95)'
            : 'rgba(160, 180, 200, 0.9)'
      ctx.lineWidth = Math.max(1.4, item.depth * scale)
      ctx.lineCap = 'round'
      ctx.stroke()
      continue
    }

    // 其他设施画成带朝向的足迹，避免只显示一个无法判断范围的点
    const corners = [
      { x: item.x + ux * hw + vx * hd, z: item.z + uz * hw + vz * hd },
      { x: item.x + ux * hw - vx * hd, z: item.z + uz * hw - vz * hd },
      { x: item.x - ux * hw - vx * hd, z: item.z - uz * hw - vz * hd },
      { x: item.x - ux * hw + vx * hd, z: item.z - uz * hw + vz * hd },
    ]
    ctx.beginPath()
    corners.forEach((p, index) => {
      const x = mapX(p.x)
      const y = mapY(p.z)
      if (index === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.closePath()
    ctx.fillStyle = 'rgba(160, 180, 200, 0.55)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(180, 198, 216, 0.8)'
    ctx.lineWidth = 1
    ctx.stroke()
  }

  // 其他玩家位置
  playerHits = []
  const dotRadius = Math.max(3.6, Math.min(7, 3.2 * uiScale))
  for (const player of props.players ?? []) {
    if (!Number.isFinite(player.x) || !Number.isFinite(player.z)) continue
    const x = mapX(player.x)
    const y = mapY(player.z)
    const radius = dotRadius
    const color = player.color || '#7dd3fc'
    if (activePlayerId.value === player.id) {
      ctx.beginPath()
      ctx.arc(x, y, radius + 4, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
      ctx.lineWidth = 1.4
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.strokeStyle = 'rgba(20, 25, 32, 0.9)'
    ctx.lineWidth = 1.2
    ctx.stroke()
    playerHits.push({ id: player.id, x, y, radius: Math.max(12, radius + 6) })
  }

  const px = mapX(pose.x)
  const py = mapY(pose.z)
  const heading = Math.atan2(-Math.cos(pose.yaw), -Math.sin(pose.yaw))
  ctx.save()
  ctx.translate(px, py)
  ctx.rotate(heading)
  ctx.beginPath()
  ctx.moveTo(8 * uiScale, 0)
  ctx.lineTo(-5 * uiScale, 4.5 * uiScale)
  ctx.lineTo(-3 * uiScale, 0)
  ctx.lineTo(-5 * uiScale, -4.5 * uiScale)
  ctx.closePath()
  ctx.fillStyle = '#f0c56a'
  ctx.fill()
  ctx.strokeStyle = 'rgba(25, 28, 34, 0.8)'
  ctx.lineWidth = uiScale
  ctx.stroke()
  ctx.restore()

  const active = props.players?.find((player) => player.id === activePlayerId.value)
  if (active) {
    drawPlayerLabel(ctx, mapX(active.x), mapY(active.z), active.nickname, uiScale, w, h)
  }
}

function findPlayerHit(x: number, y: number): PlayerHit | null {
  return (
    [...playerHits]
      .reverse()
      .find((item) => Math.hypot(item.x - x, item.y - y) <= item.radius) ?? null
  )
}

function onMinimapClick(event: MouseEvent) {
  const root = rootEl.value
  if (!root) return
  const rect = root.getBoundingClientRect()
  const x = event.clientX - rect.left
  const y = event.clientY - rect.top
  const hit = findPlayerHit(x, y)

  // 移动端先放大地图；如果点的正好是玩家点，同时显示该玩家名称
  if (props.mobile && !isExpanded.value) {
    expandedLocal.value = true
    activePlayerId.value = hit?.id ?? null
    void nextTick(draw)
    return
  }

  activePlayerId.value = hit
    ? activePlayerId.value === hit.id
      ? null
      : hit.id
    : null
  draw()
}

function collapseMinimap() {
  if (expandedLocal.value) expandedLocal.value = false
  activePlayerId.value = null
  emit('collapse')
  void nextTick(draw)
}

watch(() => props.pose, draw, { deep: true })
watch([() => props.venue, () => props.booths, () => props.infras], draw, { deep: true })
watch(
  () => props.players,
  (players) => {
    if (
      activePlayerId.value &&
      !players?.some((player) => player.id === activePlayerId.value)
    ) {
      activePlayerId.value = null
    }
    draw()
  },
  { deep: true },
)
watch(isExpanded, async () => {
  activePlayerId.value = null
  await nextTick()
  draw()
})

onMounted(() => {
  draw()
  if (canvasEl.value) {
    observer = new ResizeObserver(draw)
    observer.observe(canvasEl.value)
  }
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div
    ref="rootEl"
    class="walk-minimap"
    :class="{ 'is-mobile': mobile, expanded: isExpanded }"
    :title="mobile && !isExpanded ? '点击放大地图' : undefined"
    aria-label="漫游缩略地图"
    @pointerdown.stop
    @click.stop="onMinimapClick"
  >
    <canvas ref="canvasEl" class="walk-minimap-canvas" aria-hidden="true" />
    <button
      v-if="mobile && isExpanded"
      type="button"
      class="walk-minimap-close"
      aria-label="缩小地图"
      @pointerdown.stop
      @click.stop="collapseMinimap"
    >
      ×
    </button>
  </div>
</template>

<style scoped>
.walk-minimap {
  position: absolute;
  top: calc(100% - 166px);
  left: calc(100% - 226px);
  z-index: 32;
  width: 208px;
  height: 148px;
  transform: translate(0, 0);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 14px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.26);
  pointer-events: auto;
  touch-action: manipulation;
  overflow: hidden;
  transition:
    top 0.28s cubic-bezier(0.2, 0.8, 0.3, 1),
    left 0.28s cubic-bezier(0.2, 0.8, 0.3, 1),
    width 0.28s cubic-bezier(0.2, 0.8, 0.3, 1),
    height 0.28s cubic-bezier(0.2, 0.8, 0.3, 1),
    transform 0.28s cubic-bezier(0.2, 0.8, 0.3, 1),
    border-radius 0.28s ease,
    box-shadow 0.28s ease;
}

.walk-minimap-canvas {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
}

.walk-minimap.is-mobile {
  top: 72px;
  left: calc(100% - 144px);
  width: 132px;
  height: 96px;
}

@media (max-width: 1100px) {
  .walk-minimap {
    top: 72px;
    left: calc(100% - 144px);
    width: 132px;
    height: 96px;
  }
}

.walk-minimap.expanded {
  top: 50%;
  left: 50%;
  z-index: 80;
  width: min(72vw, 760px);
  height: min(56vh, 520px);
  transform: translate(-50%, -50%);
  border-color: rgba(255, 255, 255, 0.28);
  border-radius: 18px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.44);
}

.walk-minimap-close {
  position: absolute;
  top: 7px;
  right: 7px;
  z-index: 2;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 8px;
  background: rgba(18, 21, 27, 0.76);
  color: #fff;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
  backdrop-filter: blur(8px);
}
</style>
