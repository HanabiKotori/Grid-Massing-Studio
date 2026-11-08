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
    const x = mapX(item.x)
    const y = mapY(item.z)
    ctx.beginPath()
    ctx.arc(x, y, 1.8, 0, Math.PI * 2)
    ctx.fillStyle =
      item.kind === 'gate'
        ? 'rgba(110, 210, 160, 0.95)'
        : 'rgba(160, 180, 200, 0.7)'
    ctx.fill()
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

  ctx.font = `600 ${Math.round(9 * uiScale)}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.textBaseline = 'top'
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'
  ctx.fillText('N', 7 * uiScale, 6 * uiScale)
  ctx.fillStyle = 'rgba(240, 197, 106, 0.86)'
  ctx.textAlign = 'right'
  ctx.fillText('漫游', w - 7 * uiScale, 6 * uiScale)
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
  right: 18px;
  bottom: 18px;
  z-index: 32;
  width: 208px;
  height: 148px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 14px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.26);
  pointer-events: none;
  overflow: hidden;
}

.walk-minimap.is-mobile {
  top: 72px;
  right: 12px;
  bottom: auto;
  width: 132px;
  height: 96px;
}

@media (max-width: 1100px) {
  .walk-minimap {
    top: 72px;
    right: 12px;
    bottom: auto;
    width: 132px;
    height: 96px;
  }
}

.walk-minimap.expanded {
  top: 50%;
  left: 50%;
  right: auto;
  bottom: auto;
  z-index: 80;
  width: min(72vw, 760px);
  height: min(56vh, 520px);
  transform: translate(-50%, -50%);
  border-color: rgba(255, 255, 255, 0.28);
  border-radius: 18px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.44);
}
</style>
