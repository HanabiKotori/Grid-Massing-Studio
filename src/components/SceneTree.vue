<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { boothKindOf } from '../core/booth'
import { INFRA_LABELS, isFurnitureKind } from '../core/infra'
import { pointInPolygon, polygonArea } from '../core/polygon'
import type { Booth, BoothKind, Infra, InfraKind, Venue } from '../core/types'

const props = defineProps<{
  venue: Venue | null
  venueName: string
  booths: Booth[]
  infras: Infra[]
  selectedIds: string[]
  selectedInfraId: string | null
  venueArea: number
  boothArea: number
  coverage: number
  renderOnly: boolean
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'select-infra', id: string): void
  (e: 'select-venue'): void
  (e: 'draw-venue'): void
  (e: 'draw-booth', kind: BoothKind): void
  (e: 'add-infra', kind: InfraKind): void
  (e: 'add-furniture', kind: InfraKind, boothId: string): void
  (e: 'delete-booth', id: string): void
  (e: 'delete-infra', id: string): void
}>()

const BOOTH_GROUPS: { kind: BoothKind; label: string }[] = [
  { kind: 'massing', label: '标准' },
  { kind: 'scaffold', label: '脚手架' },
  { kind: 'openfloor', label: '光地' },
]

const INFRA_GROUPS: InfraKind[] = [
  'restroom',
  'stairs',
  'gate',
  'elevator',
  'window',
  'wall',
]

const FURNITURE_GROUPS: InfraKind[] = [
  'chair',
  'armchair',
  'sofa',
  'table-round',
  'table-square',
]

/** 树节点展开状态：缺省按节点类型给出默认值 */
const open = ref<Record<string, boolean>>({
  venue: true,
  booth: true,
  infra: true,
  furniture: true,
})

function isOpen(key: string, fallback = true) {
  const v = open.value[key]
  return v === undefined ? fallback : v
}

function toggle(key: string, fallback = true) {
  open.value[key] = !isOpen(key, fallback)
}

/** 一键展开 / 收起：把所有已知节点写入状态，二级默认收起 */
const expandAll = ref(true)

function allKeys(): string[] {
  const keys = ['venue', 'booth', 'infra', 'furniture']
  for (const g of BOOTH_GROUPS) keys.push('bk-' + g.kind)
  for (const k of INFRA_GROUPS) keys.push('ik-' + k)
  for (const b of props.booths) {
    keys.push('fb-' + b.id)
    for (const fk of FURNITURE_GROUPS) keys.push('ff-' + b.id + '-' + fk)
  }
  return keys
}

function toggleAll() {
  expandAll.value = !expandAll.value
  const next: Record<string, boolean> = {}
  for (const k of allKeys()) next[k] = expandAll.value
  open.value = next
}

const treeEl = ref<HTMLElement | null>(null)

/* ---------- 数据分组 ---------- */

const boothsByKind = computed(() => {
  const map = new Map<BoothKind, Booth[]>()
  for (const g of BOOTH_GROUPS) map.set(g.kind, [])
  for (const b of props.booths) {
    const list = map.get(boothKindOf(b))
    if (list) list.push(b)
    else map.set(boothKindOf(b), [b])
  }
  return map
})

const infraByKind = computed(() => {
  const map = new Map<InfraKind, Infra[]>()
  for (const k of INFRA_GROUPS) map.set(k, [])
  for (const it of props.infras) {
    if (isFurnitureKind(it.kind)) continue
    const list = map.get(it.kind)
    if (list) list.push(it)
    else map.set(it.kind, [it])
  }
  return map
})

const furnitureAll = computed(() => props.infras.filter((i) => isFurnitureKind(i.kind)))

const furnitureByBooth = computed(() => {
  const map = new Map<string, Infra[]>()
  for (const b of props.booths) map.set(b.id, [])
  for (const it of furnitureAll.value) {
    const owner = props.booths.find(
      (b) => b.points.length >= 3 && pointInPolygon({ x: it.x, z: it.z }, b.points),
    )
    if (!owner) continue
    map.get(owner.id)?.push(it)
  }
  return map
})

function furnitureOf(boothId: string) {
  return furnitureByBooth.value.get(boothId) ?? []
}

function furnitureOfKind(boothId: string, kind: InfraKind) {
  return furnitureOf(boothId).filter((i) => i.kind === kind)
}

function infraCount() {
  return props.infras.filter((i) => !isFurnitureKind(i.kind)).length
}

function fmt(n: number) {
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
}

function areaOf(b: Booth) {
  return polygonArea(b.points)
}

function isOn(id: string) {
  return props.selectedIds.includes(id)
}

/** 重绘场馆会替换轮廓，先确认 */
function confirmRedraw() {
  if (props.renderOnly) return
  if (
    props.venue &&
    !window.confirm('重绘会替换当前场馆轮廓，馆内展台不会自动删除。确定重新绘制？')
  ) {
    return
  }
  emit('draw-venue')
}

watch(
  () => [props.selectedIds.join(','), props.selectedInfraId],
  () =>
    nextTick(() => {
      const root = treeEl.value
      if (!root) return
      const el = root.querySelector('.wb-node.on') as HTMLElement | null
      if (!el) return
      const r = el.getBoundingClientRect()
      const rr = root.getBoundingClientRect()
      if (r.top < rr.top + 8) root.scrollTop -= rr.top + 8 - r.top
      else if (r.bottom > rr.bottom - 8) root.scrollTop += r.bottom - (rr.bottom - 8)
    }),
)
</script>

<template>
  <aside class="wb-left">
    <div class="wb-pane-head">
      场景结构
      <span class="sp" />
      <button
        type="button"
        class="wb-mini-btn"
        :title="expandAll ? '全部收起' : '全部展开'"
        @click="toggleAll"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path v-if="expandAll" d="M7 9l5-5 5 5M7 15l5 5 5-5" />
          <path v-else d="M7 5l5 5 5-5M7 19l5-5 5 5" />
        </svg>
      </button>
    </div>

    <div ref="treeEl" class="wb-tree">
      <!-- 场馆 -->
      <div class="wb-grp" @click="toggle('venue')">
        <span class="tri" :class="{ open: isOpen('venue') }" />
        <b>场馆</b>
        <span class="cnt">{{ venue ? 1 : 0 }}</span>
        <button
          v-if="!renderOnly && venue"
          type="button"
          class="wb-add"
          title="重绘场馆轮廓"
          @click.stop="confirmRedraw"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M3.6 12a8.4 8.4 0 1 0 2.6-6.1" />
            <path d="M3.4 3.6v5h5" />
          </svg>
        </button>
      </div>
      <template v-if="isOpen('venue')">
        <div v-if="!venue" class="wb-empty">
          还未绘制场地面积
          <div style="margin-top: 8px">
            <button v-if="!renderOnly" type="button" class="wb-btn" style="height: 26px" @click="confirmRedraw">
              绘制场地面积
            </button>
          </div>
        </div>
        <template v-else>
          <button
            type="button"
            class="wb-node lv2"
            title="点击取消选中，并回到全景视角"
            @click="emit('select-venue')"
          >
            <span class="sw" style="background: #4a4f5c" />
            <span class="nm">{{ venueName }}</span>
            <span class="num">{{ fmt(venueArea) }} m²</span>
          </button>
        </template>
      </template>

      <!-- 展台 -->
      <button type="button" class="wb-grp" @click="toggle('booth')">
        <span class="tri" :class="{ open: isOpen('booth') }" />
        <b>展台</b>
        <span class="cnt">{{ booths.length }}</span>
      </button>
      <template v-if="isOpen('booth')">
        <template v-for="g in BOOTH_GROUPS" :key="g.kind">
          <div class="wb-grp sub" :style="{ '--lv': 1 }" @click="toggle('bk-' + g.kind, false)">
            <span class="tri" :class="{ open: isOpen('bk-' + g.kind, false) }" />
            <b>{{ g.label }}</b>
            <span class="cnt">{{ (boothsByKind.get(g.kind) || []).length }}</span>
            <button
              v-if="!renderOnly"
              type="button"
              class="wb-add"
              :title="`新增${g.label}展台`"
              @click.stop="emit('draw-booth', g.kind)"
            >
              +
            </button>
          </div>
          <template v-if="isOpen('bk-' + g.kind, false)">
            <button
              v-for="b in boothsByKind.get(g.kind) || []"
              :key="b.id"
              type="button"
              class="wb-node lv3"
              :class="{ on: isOn(b.id) }"
              @click="emit('select', b.id)"
            >
              <span class="sw" />
              <span class="nm">{{ b.name }}</span>
              <span class="num">{{ fmt(areaOf(b)) }} m²</span>
              <span
                v-if="!renderOnly"
                class="del"
                role="button"
                title="删除展台"
                @click.stop="emit('delete-booth', b.id)"
              >
                ×
              </span>
            </button>
            <div v-if="!(boothsByKind.get(g.kind) || []).length" class="wb-empty sub">
              暂无{{ g.label }}展台
            </div>
          </template>
        </template>
      </template>

      <!-- 基础设施 -->
      <button type="button" class="wb-grp" @click="toggle('infra')">
        <span class="tri" :class="{ open: isOpen('infra') }" />
        <b>基础设施</b>
        <span class="cnt">{{ infraCount() }}</span>
      </button>
      <template v-if="isOpen('infra')">
        <template v-for="k in INFRA_GROUPS" :key="k">
          <div class="wb-grp sub" :style="{ '--lv': 1 }" @click="toggle('ik-' + k, false)">
            <span class="tri" :class="{ open: isOpen('ik-' + k, false) }" />
            <b>{{ INFRA_LABELS[k] }}</b>
            <span class="cnt">{{ (infraByKind.get(k) || []).length }}</span>
            <button
              v-if="!renderOnly"
              type="button"
              class="wb-add"
              :title="`新增${INFRA_LABELS[k]}`"
              @click.stop="emit('add-infra', k)"
            >
              +
            </button>
          </div>
          <template v-if="isOpen('ik-' + k, false)">
            <button
              v-for="it in infraByKind.get(k) || []"
              :key="it.id"
              type="button"
              class="wb-node lv3"
              :class="{ on: selectedInfraId === it.id }"
              @click="emit('select-infra', it.id)"
            >
              <span class="sw" style="background: #4a4438" />
              <span class="nm">{{ it.name }}</span>
              <span class="num">{{ it.kind === 'gate' ? it.width.toFixed(1) + ' m' : '#' + it.id.slice(-2) }}</span>
              <span
                v-if="!renderOnly"
                class="del"
                role="button"
                title="删除设施"
                @click.stop="emit('delete-infra', it.id)"
              >
                ×
              </span>
            </button>
            <div v-if="!(infraByKind.get(k) || []).length" class="wb-empty sub">
              暂无{{ INFRA_LABELS[k] }}
            </div>
          </template>
        </template>
      </template>

      <!-- 家具：家具 → 展台 → 家具类型 -->
      <button type="button" class="wb-grp" @click="toggle('furniture')">
        <span class="tri" :class="{ open: isOpen('furniture') }" />
        <b>家具</b>
        <span class="cnt">{{ furnitureAll.length }}</span>
      </button>
      <template v-if="isOpen('furniture')">
        <div v-if="!booths.length" class="wb-empty sub">家具需要放在展台内部</div>
        <template v-for="b in booths" :key="'fb-' + b.id">
          <div class="wb-grp sub" :style="{ '--lv': 1 }" @click="toggle('fb-' + b.id, false)">
            <span class="tri" :class="{ open: isOpen('fb-' + b.id, false) }" />
            <b>{{ b.name }}</b>
            <span class="cnt">{{ furnitureOf(b.id).length }}</span>
          </div>
          <template v-if="isOpen('fb-' + b.id, false)">
            <template v-for="fk in FURNITURE_GROUPS" :key="fk">
              <div class="wb-grp sub" :style="{ '--lv': 2 }" @click="toggle('ff-' + b.id + '-' + fk, false)">
                <span class="tri" :class="{ open: isOpen('ff-' + b.id + '-' + fk, false) }" />
                <b>{{ INFRA_LABELS[fk] }}</b>
                <span class="cnt">{{ furnitureOfKind(b.id, fk).length }}</span>
                <button
                  v-if="!renderOnly"
                  type="button"
                  class="wb-add"
                  :title="`在 ${b.name} 内新增${INFRA_LABELS[fk]}`"
                  @click.stop="emit('add-furniture', fk, b.id)"
                >
                  +
                </button>
              </div>
              <template v-if="isOpen('ff-' + b.id + '-' + fk, false)">
                <button
                  v-for="it in furnitureOfKind(b.id, fk)"
                  :key="it.id"
                  type="button"
                  class="wb-node lv4"
                  :class="{ on: selectedInfraId === it.id }"
                  @click="emit('select-infra', it.id)"
                >
                  <span class="sw" style="background: #4a4438" />
                  <span class="nm">{{ it.name }}</span>
                  <span
                    v-if="!renderOnly"
                    class="del"
                    role="button"
                    title="删除家具"
                    @click.stop="emit('delete-infra', it.id)"
                  >
                    ×
                  </span>
                </button>
              </template>
            </template>
          </template>
        </template>
      </template>
    </div>

    <div class="wb-tree-foot">
      <span>展出 <b>{{ fmt(boothArea) }} m²</b></span>
      <span class="sp" />
      <span>覆盖 <b>{{ coverage }}%</b></span>
    </div>
  </aside>
</template>
