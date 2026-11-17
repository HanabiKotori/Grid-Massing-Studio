<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { boothKindOf } from '../core/booth'
import type { FurniturePreset } from '../core/furniturePreset'
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
  selectedInfraIds: string[]
  presets: FurniturePreset[]
  selectedPresetId: string | null
  venueArea: number
  boothArea: number
  coverage: number
  renderOnly: boolean
}>()

const emit = defineEmits<{
  (e: 'select', id: string): void
  (e: 'select-infra', id: string, additive?: boolean): void
  (e: 'select-venue'): void
  (e: 'draw-venue'): void
  (e: 'request-redraw'): void
  (e: 'draw-booth', kind: BoothKind): void
  (e: 'add-infra', kind: InfraKind): void
  (e: 'delete-booth', id: string): void
  (e: 'delete-infra', id: string): void
  (e: 'save-preset'): void
  (e: 'place-preset', preset: FurniturePreset): void
  (e: 'delete-preset', id: string): void
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

interface FurnitureCategory {
  key: string
  label: string
  kinds: InfraKind[]
}

/** 左侧家具栏分类：目录按类别新增，已布置家具按类别归档 */
const FURNITURE_CATEGORIES: FurnitureCategory[] = [
  {
    key: 'table-chair',
    label: '桌椅',
    kinds: [
      'meeting-table',
      'meeting-chair',
      'bar-table',
      'bar-stool',
      'chair',
      'armchair',
      'sofa',
      'table-round',
      'table-square',
    ],
  },
  {
    key: 'cabinet',
    label: '柜子',
    kinds: ['reception-desk', 'display-case', 'low-cabinet', 'shelf'],
  },
  {
    key: 'other',
    label: '其他',
    kinds: [
      'display-screen',
      'display-plinth',
      'display-column',
      'brochure-stand',
      'lectern',
      'plant',
    ],
  },
]

/** 展台下直接列类型时的顺序：沿用目录分类顺序 */
const FURNITURE_KIND_ORDER = FURNITURE_CATEGORIES.flatMap((cat) => cat.kinds)

/** 树节点展开状态：缺省按节点类型给出默认值 */
const open = ref<Record<string, boolean>>({
  venue: true,
  booth: true,
  infra: true,
  furniture: true,
  'furniture-occupied': true,
  preset: true,
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
  const keys = [
    'venue',
    'booth',
    'infra',
    'furniture',
    'furniture-occupied',
    'preset',
  ]
  for (const g of BOOTH_GROUPS) keys.push('bk-' + g.kind)
  for (const k of INFRA_GROUPS) keys.push('ik-' + k)
  for (const cat of FURNITURE_CATEGORIES) keys.push('fc-' + cat.key)
  for (const b of props.booths) {
    keys.push('fb-' + b.id)
    for (const cat of FURNITURE_CATEGORIES) {
      for (const fk of cat.kinds) keys.push('fbk-' + b.id + '-' + fk)
    }
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

/** 当前画布选中的对象：优先设施 / 家具，其次展台 */
const locateTargetId = computed(() => {
  if (props.selectedInfraId) {
    const infra = props.infras.find((item) => item.id === props.selectedInfraId)
    if (infra) return infra.id
  }
  for (let i = props.selectedIds.length - 1; i >= 0; i -= 1) {
    const id = props.selectedIds[i]
    if (props.booths.some((booth) => booth.id === id)) return id
  }
  return null
})
const canLocate = computed(() => !!locateTargetId.value)

function scrollToNode(id: string, center: boolean) {
  const root = treeEl.value
  if (!root) return
  const el = [...root.querySelectorAll<HTMLElement>('.wb-node')].find(
    (node) => node.dataset.nodeId === id,
  )
  if (!el) return
  if (center) {
    const r = el.getBoundingClientRect()
    const rr = root.getBoundingClientRect()
    root.scrollTo({
      top: Math.max(
        0,
        root.scrollTop + r.top - rr.top - root.clientHeight / 2 + r.height / 2,
      ),
      behavior: 'smooth',
    })
    return
  }
  const r = el.getBoundingClientRect()
  const rr = root.getBoundingClientRect()
  if (r.top < rr.top + 8) root.scrollTop -= rr.top + 8 - r.top
  else if (r.bottom > rr.bottom - 8) root.scrollTop += r.bottom - (rr.bottom - 8)
}

/** 展开选中对象所在的树分组并滚动到对应节点 */
async function locateSelected() {
  const targetId = locateTargetId.value
  if (!targetId) return

  const infra = props.infras.find((item) => item.id === targetId)
  if (infra) {
    if (isFurnitureKind(infra.kind)) {
      open.value.furniture = true
      open.value['furniture-occupied'] = true
      const owner = props.booths.find(
        (b) =>
          b.points.length >= 3 && pointInPolygon({ x: infra.x, z: infra.z }, b.points),
      )
      if (owner) {
        open.value['fb-' + owner.id] = true
        open.value['fbk-' + owner.id + '-' + infra.kind] = true
      }
    } else {
      open.value.infra = true
      open.value['ik-' + infra.kind] = true
    }
  } else {
    const booth = props.booths.find((item) => item.id === targetId)
    if (!booth) return
    open.value.booth = true
    open.value['bk-' + boothKindOf(booth)] = true
  }

  await nextTick()
  scrollToNode(targetId, true)
}

// 供 App 的 L 快捷键调用
defineExpose({ locateSelected })

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

/** 多选高亮：所有被选中的家具 / 设施都给选中态 */
const selectedInfraSet = computed(() => new Set(props.selectedInfraIds))

function isInfraOn(id: string) {
  return selectedInfraSet.value.has(id)
}

/** 当前多选的家具数量：决定「保存组合 / 整组旋转 / 复制」是否可用 */
const selectedFurnitureCount = computed(
  () =>
    props.infras.filter(
      (it) => selectedInfraSet.value.has(it.id) && isFurnitureKind(it.kind),
    ).length,
)

const canSavePreset = computed(
  () => !props.renderOnly && selectedFurnitureCount.value >= 2,
)

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

/** 家具目录：按类别统计全场景数量 */
function furnitureKindCount(kind: InfraKind) {
  return furnitureAll.value.filter((it) => it.kind === kind).length
}

function categoryCount(cat: FurnitureCategory) {
  return furnitureAll.value.filter((it) => cat.kinds.includes(it.kind)).length
}

function addFurnitureKind(kind: InfraKind) {
  if (props.renderOnly || !props.booths.length) return
  emit('add-infra', kind)
}

interface OccupiedKind {
  kind: InfraKind
  items: Infra[]
}
interface OccupiedBooth {
  booth: Booth
  items: Infra[]
  kinds: OccupiedKind[]
}

/** 「有家具的展台」：展台下直接列具体家具类型（按目录分类顺序排列） */
const occupiedTree = computed<OccupiedBooth[]>(() => {
  const rows: OccupiedBooth[] = []
  for (const booth of props.booths) {
    const items = furnitureOf(booth.id)
    if (!items.length) continue
    const kinds: OccupiedKind[] = []
    for (const kind of FURNITURE_KIND_ORDER) {
      const kindItems = items.filter((it) => it.kind === kind)
      if (kindItems.length) kinds.push({ kind, items: kindItems })
    }
    rows.push({ booth, items, kinds })
  }
  return rows
})

/** 家具目录里的全部类型数（用于标题计数） */
const furnitureKindTotal = computed(() =>
  FURNITURE_CATEGORIES.reduce((sum, cat) => sum + cat.kinds.length, 0),
)

/** 场景内实际出现的家具种类数 */
const placedFurnitureKindCount = computed(
  () => new Set(furnitureAll.value.map((it) => it.kind)).size,
)

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

/** 重绘场馆会替换轮廓，交给 App 的自定义确认弹层 */
function requestRedraw() {
  if (props.renderOnly) return
  emit('request-redraw')
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
        class="wb-mini-btn wb-locate-btn"
        :disabled="!canLocate"
        :title="canLocate ? '定位到当前选中对象 (L)' : '请先在画布中选中模型'"
        aria-label="定位到当前选中对象"
        @click="locateSelected"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="7" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
      </button>
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
          @click.stop="requestRedraw"
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
            <button v-if="!renderOnly" type="button" class="wb-btn" style="height: 26px" @click="requestRedraw">
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
              :data-node-id="b.id"
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
              :class="{ on: isInfraOn(it.id) }"
              :data-node-id="it.id"
              title="Ctrl / Shift 点击可多选"
              @click="emit('select-infra', it.id, $event.ctrlKey || $event.metaKey || $event.shiftKey)"
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

      <!-- 家具：上方按类别添加，下方按展台归档已布置家具 -->
      <button type="button" class="wb-grp" @click="toggle('furniture')">
        <span class="tri" :class="{ open: isOpen('furniture') }" />
        <b>家具</b>
        <span
          class="cnt"
          :title="`可添加 ${furnitureKindTotal} 种家具 · 场景内已放置 ${placedFurnitureKindCount} 种，共 ${furnitureAll.length} 件`"
        >
          {{ furnitureKindTotal }} 种 · {{ furnitureAll.length }} 件
        </span>
      </button>
      <template v-if="isOpen('furniture')">
        <div v-if="!booths.length" class="wb-empty sub">家具需要放在展台内部</div>

        <template v-for="cat in FURNITURE_CATEGORIES" :key="'fc-' + cat.key">
          <div
            class="wb-grp sub"
            :style="{ '--lv': 1 }"
            @click="toggle('fc-' + cat.key, false)"
          >
            <span class="tri" :class="{ open: isOpen('fc-' + cat.key, false) }" />
            <b>{{ cat.label }}</b>
            <span class="cnt">{{ categoryCount(cat) }}</span>
          </div>
          <template v-if="isOpen('fc-' + cat.key, false)">
            <div
              v-for="fk in cat.kinds"
              :key="fk"
              class="wb-grp sub wb-furniture-add"
              :class="{ disabled: !booths.length || renderOnly }"
              :style="{ '--lv': 2 }"
              :title="
                !booths.length || renderOnly
                  ? ''
                  : `添加${INFRA_LABELS[fk]}：点击后在任意展台内落位`
              "
              @click="addFurnitureKind(fk)"
            >
              <b>{{ INFRA_LABELS[fk] }}</b>
              <span class="cnt">{{ furnitureKindCount(fk) }}</span>
              <button
                v-if="!renderOnly"
                type="button"
                class="wb-add"
                :disabled="!booths.length"
                :title="`添加${INFRA_LABELS[fk]}`"
                @click.stop="emit('add-infra', fk)"
              >
                +
              </button>
            </div>
          </template>
        </template>

        <div
          class="wb-grp sub"
          :style="{ '--lv': 1 }"
          @click="toggle('furniture-occupied')"
        >
          <span class="tri" :class="{ open: isOpen('furniture-occupied') }" />
          <b>有家具的展台</b>
          <span class="cnt">{{ occupiedTree.length }}</span>
        </div>
        <template v-if="isOpen('furniture-occupied')">
          <div v-if="!occupiedTree.length" class="wb-empty sub">暂无已布置的家具</div>
          <template v-for="row in occupiedTree" :key="'fb-' + row.booth.id">
            <div
              class="wb-grp sub"
              :style="{ '--lv': 2 }"
              @click="toggle('fb-' + row.booth.id, false)"
            >
              <span class="tri" :class="{ open: isOpen('fb-' + row.booth.id, false) }" />
              <b>{{ row.booth.name }}</b>
              <span class="cnt">{{ row.items.length }}</span>
            </div>
            <template v-if="isOpen('fb-' + row.booth.id, false)">
              <template v-for="kindRow in row.kinds" :key="kindRow.kind">
                <div
                  class="wb-grp sub"
                  :style="{ '--lv': 3 }"
                  @click="
                    toggle('fbk-' + row.booth.id + '-' + kindRow.kind, false)
                  "
                >
                  <span
                    class="tri"
                    :class="{
                      open: isOpen(
                        'fbk-' + row.booth.id + '-' + kindRow.kind,
                        false,
                      ),
                    }"
                  />
                  <b>{{ INFRA_LABELS[kindRow.kind] }}</b>
                  <span class="cnt">{{ kindRow.items.length }}</span>
                </div>
                <template
                  v-if="
                    isOpen('fbk-' + row.booth.id + '-' + kindRow.kind, false)
                  "
                >
                  <button
                    v-for="it in kindRow.items"
                    :key="it.id"
                    type="button"
                    class="wb-node lv4"
                    :class="{ on: isInfraOn(it.id) }"
                    :data-node-id="it.id"
                    title="Ctrl / Shift 点击可多选，多选后可整组拖动 / 旋转 / 复制 / 存为预设"
                    @click="
                      emit(
                        'select-infra',
                        it.id,
                        $event.ctrlKey || $event.metaKey || $event.shiftKey,
                      )
                    "
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
      </template>

      <!-- 家具预设：多选家具保存的组合，点击后可摆到任意展台 -->
      <button type="button" class="wb-grp" @click="toggle('preset')">
        <span class="tri" :class="{ open: isOpen('preset') }" />
        <b>家具预设</b>
        <span class="cnt">{{ presets.length }}</span>
      </button>
      <template v-if="isOpen('preset')">
        <div class="wb-preset-bar">
          <span class="wb-preset-count" :title="`已选 ${selectedFurnitureCount} 件家具`">
            <template v-if="selectedFurnitureCount > 1">
              已选 {{ selectedFurnitureCount }} 件家具
            </template>
            <template v-else>Ctrl / Shift 多选家具后保存</template>
          </span>
          <button
            v-if="!renderOnly"
            type="button"
            class="wb-add"
            :disabled="!canSavePreset"
            title="把当前多选的家具保存为组合预设"
            aria-label="保存家具组合预设"
            @click="emit('save-preset')"
          >
            +
          </button>
        </div>
        <button
          v-for="p in presets"
          :key="p.id"
          type="button"
          class="wb-node lv2 wb-preset-node"
          :class="{ on: selectedPresetId === p.id }"
          :title="`点击后在展台内布置「${p.name}」，右侧可查看组合详情`"
          @click="emit('place-preset', p)"
        >
          <span class="sw" style="background: #4a4438" />
          <span class="nm">{{ p.name }}</span>
          <span class="num">{{ p.items.length }} 件</span>
          <span
            v-if="!renderOnly"
            class="del"
            role="button"
            title="删除预设"
            @click.stop="emit('delete-preset', p.id)"
          >
            ×
          </span>
        </button>
        <div v-if="!presets.length" class="wb-empty sub">
          把同一个展台内的多件家具选中，点「+」生成组合；点击组合可查看详情并布置到任意展台
        </div>
      </template>
    </div>

    <div class="wb-tree-foot">
      <span>展出 <b>{{ fmt(boothArea) }} m²</b></span>
      <span class="sp" />
      <span>覆盖 <b>{{ coverage }}%</b></span>
    </div>
  </aside>
</template>
