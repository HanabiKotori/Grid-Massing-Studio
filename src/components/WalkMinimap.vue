<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { isFurnitureKind } from '../core/infra'
import type { Booth, Infra, Pt, Venue } from '../core/types'

const props = defineProps<{
  venue: Venue | null
  booths: Booth[]
  infras: Infra[]
  pose: { x: number; z: number; yaw: number } | null
  mobile?: boolean
  expanded?: boolean
}>()

const canvasEl = ref<HTMLCanvasElement | null>(null)
let observer: ResizeObserver | null = null

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

  ctx.fillStyle = 'rgba(20, 24, 30, 0.82)'
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

    if (item.kind === 'wall' || item.kind === 'gate') {
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
}

watch(() => props.pose, draw, { deep: true })
watch([() => props.venue, () => props.booths, () => props.infras], draw, { deep: true })

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
  <canvas
    ref="canvasEl"
    class="walk-minimap"
    :class="{ 'is-mobile': mobile, expanded }"
    aria-label="漫游缩略地图"
  />
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
  pointer-events: none;
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
</style>
