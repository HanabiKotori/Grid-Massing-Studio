<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ShareMeta } from '../core/shareApi'

const props = withDefaults(
  defineProps<{
    open: boolean
    venueName: string
    hasVenue: boolean
    existing: ShareMeta | null
    loggedIn: boolean
    cloudEnabled: boolean
    busy?: boolean
    error?: string
  }>(),
  { busy: false, error: '' },
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'publish', payload: {
    title: string
    liveMode: boolean
    allowComment: boolean
    allowDownload: boolean
  }): void
  (e: 'update', payload: {
    title: string
    liveMode: boolean
    allowComment: boolean
    allowDownload: boolean
  }): void
  (e: 'freeze'): void
  (e: 'revoke'): void
  (e: 'login'): void
}>()

const title = ref('')
const liveMode = ref(true)
const allowComment = ref(true)
const allowDownload = ref(false)
const copied = ref(false)
const confirmRevoke = ref(false)

const link = computed(() => {
  if (!props.existing) return ''
  const base = `${window.location.origin}${window.location.pathname}${window.location.search}`
  return `${base}#/share/${props.existing.token}`
})

const statusText = computed(() => {
  if (!props.existing) return '发布后生成只读链接'
  if (props.existing.revoked) return '链接已撤销'
  if (props.existing.liveMode) {
    return `实时 · ${props.existing.viewerCount} 人在看`
  }
  return `冻结于第 ${props.existing.sceneVersion} 版`
})

watch(
  () => [props.open, props.existing, props.venueName] as const,
  () => {
    if (!props.open) return
    title.value = props.existing?.title || props.venueName || '未命名场景'
    liveMode.value = props.existing ? props.existing.liveMode : true
    allowComment.value = props.existing ? props.existing.allowComment : true
    allowDownload.value = props.existing ? props.existing.allowDownload : false
    copied.value = false
    confirmRevoke.value = false
  },
  { immediate: true },
)

async function copyLink() {
  if (!link.value) return
  try {
    await navigator.clipboard.writeText(link.value)
  } catch {
    try {
      const input = document.createElement('input')
      input.value = link.value
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      input.remove()
    } catch {
      // 剪贴板不可用时保留输入框，用户可手动复制
    }
  }
  copied.value = true
  window.setTimeout(() => (copied.value = false), 1600)
}

function publish() {
  emit('publish', {
    title: title.value.trim() || props.venueName || '未命名场景',
    liveMode: liveMode.value,
    allowComment: allowComment.value,
    allowDownload: allowDownload.value,
  })
}

function update() {
  emit('update', {
    title: title.value.trim() || props.venueName || '未命名场景',
    liveMode: liveMode.value,
    allowComment: allowComment.value,
    allowDownload: allowDownload.value,
  })
}
</script>

<template>
  <Transition name="dialog">
    <div v-if="open" class="share-mask" @click.self="emit('close')">
      <div class="share-dialog" role="dialog" aria-label="分享查看链接">
        <div class="sd-head">
          <div>
            <div class="sd-title">分享查看链接</div>
            <div class="sd-sub">
              {{ existing ? statusText : '拿到链接即可查看；评论需要登录云端账号' }}
            </div>
          </div>
          <span class="rp-sp" />
          <span class="rp-live" :class="{ on: !!existing && existing.liveMode }">
            <i />
            {{ statusText }}
          </span>
          <button class="rp-icon" type="button" @click="emit('close')">×</button>
        </div>

        <div class="sd-body">
          <div class="sd-scene">
            <div class="sd-thumb">3D</div>
            <div class="sd-scene-meta">
              <b>{{ venueName || '未命名场景' }}</b>
              <span v-if="existing?.storageName">
                存档：{{ existing.storageName }}<template v-if="existing.storageSlot"> · 位置 {{ existing.storageSlot }}</template>
              </span>
              <span>{{ existing ? `第 ${existing.revision} 次修订 · ${existing.commentCount} 条评论` : '保存到云端存档后生成该存档的独立链接' }}</span>
              <span v-if="existing && existing.liveMode">实时同步中 · {{ existing.viewerCount }} 人正在查看</span>
            </div>
          </div>

          <label class="sd-field">
            <span class="sd-label">链接标题</span>
            <input v-model="title" class="sd-input" maxlength="64" placeholder="场馆名或评审标题" />
          </label>

          <div class="sd-rows">
            <div class="sd-row sd-row-static">
              <div>
                <b>访问方式</b>
                <span>拿到链接即可查看，无需登录</span>
              </div>
              <span class="rp-sp" />
              <span class="sd-fixed">公开</span>
            </div>
            <div class="sd-row sd-row-static">
              <div>
                <b>评论权限</b>
                <span>登录云端账号后才能评论</span>
              </div>
              <span class="rp-sp" />
              <span class="sd-fixed">登录用户</span>
            </div>
            <div class="sd-row">
              <div>
                <b>实时同步</b>
                <span>作者修改模型后，链接内容自动更新</span>
              </div>
              <span class="rp-sp" />
              <button
                type="button"
                class="sd-toggle"
                :class="{ on: liveMode }"
                :aria-pressed="liveMode"
                @click="liveMode = !liveMode"
              />
            </div>
            <div class="sd-row">
              <div>
                <b>允许评论</b>
                <span>登录后可评论；关闭后所有人只能查看</span>
              </div>
              <span class="rp-sp" />
              <button
                type="button"
                class="sd-toggle"
                :class="{ on: allowComment }"
                :aria-pressed="allowComment"
                @click="allowComment = !allowComment"
              />
            </div>
            <div class="sd-row">
              <div>
                <b>允许导出图片</b>
                <span>开放俯视汇报图下载，默认关闭</span>
              </div>
              <span class="rp-sp" />
              <button
                type="button"
                class="sd-toggle"
                :class="{ on: allowDownload }"
                :aria-pressed="allowDownload"
                @click="allowDownload = !allowDownload"
              />
            </div>
          </div>

          <div v-if="existing" class="sd-link">
            <span class="sd-label">链接</span>
            <div class="sd-link-row">
              <input :value="link" readonly />
              <button class="sd-btn" type="button" @click="copyLink">
                {{ copied ? '已复制' : '复制' }}
              </button>
            </div>
          </div>

          <div class="sd-hint">
            冻结后会生成独立快照链接，评论位置固定在该版本，适合归档或验收。当前版本不提供口令与有效期。匿名评论已移除，已有匿名评论保留为只读历史。
          </div>

          <div v-if="!cloudEnabled" class="sd-error">未开启 dataService，分享与实时评论不可用。</div>
          <div v-else-if="!loggedIn" class="sd-error">发布分享需要先登录云端存储。</div>
          <div v-else-if="!hasVenue" class="sd-error">请先创建场馆并保存场景。</div>
          <div v-if="error" class="sd-error">{{ error }}</div>
        </div>

        <div class="sd-foot">
          <template v-if="existing">
            <button
              v-if="existing.liveMode"
              class="sd-btn ghost"
              type="button"
              :disabled="busy"
              @click="emit('freeze')"
            >
              冻结当前版本
            </button>
            <button
              class="sd-btn danger"
              type="button"
              :disabled="busy"
              @click="confirmRevoke ? emit('revoke') : (confirmRevoke = true)"
            >
              {{ confirmRevoke ? '再次点击确认撤销' : '撤销链接' }}
            </button>
            <span class="rp-sp" />
            <button class="sd-btn" type="button" :disabled="busy" @click="update">
              保存设置
            </button>
            <button class="sd-btn pri" type="button" :disabled="!link" @click="copyLink">
              {{ copied ? '已复制' : '复制实时链接' }}
            </button>
          </template>
          <template v-else>
            <span class="rp-sp" />
            <button class="sd-btn ghost" type="button" @click="emit('close')">取消</button>
            <button
              class="sd-btn pri"
              type="button"
              :disabled="busy || !cloudEnabled || !hasVenue"
              @click="loggedIn ? publish() : emit('login')"
            >
              {{ loggedIn ? (busy ? '发布中…' : '发布并复制链接') : '登录云端后发布' }}
            </button>
          </template>
        </div>
      </div>
    </div>
  </Transition>
</template>
