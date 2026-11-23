<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CaptchaChallenge } from '../core/cloudStorage'
import type { CloudStorageController } from '../composables/useCloudStorage'

const props = defineProps<{
  controller: CloudStorageController
  /** 保存当前场景到指定云端位置 */
  saveCurrent: (slot: number) => Promise<void>
  /** 从云端位置加载场景（覆盖确认由父组件负责） */
  loadSlot: (slot: number) => Promise<void>
  deleteSlot: (slot: number) => Promise<void>
  /** 登录时存在未保存场景，等待另存 / 覆盖 / 弃用 */
  pendingScene?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'logout'): void
  (e: 'notify', text: string): void
  (e: 'login-success'): void
  (e: 'discard-scene'): void
}>()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const captcha = ref<CaptchaChallenge | null>(null)
const captchaLoading = ref(false)
const sliderX = ref(0)
const submitting = ref(false)
const localError = ref('')
const activeSlot = ref<number | null>(null)
const pendingDelete = ref<number | null>(null)
const refreshing = ref(false)
let deleteTimer = 0

const loggedIn = computed(() => !!props.controller.user.value)
const accountName = computed(() => props.controller.user.value?.username ?? '')
const busyNow = computed(() => props.controller.busy.value)
const currentSlot = computed(() => props.controller.currentSlot.value)
const errorText = computed(() => localError.value || props.controller.error.value)

/** 滑块行程 0-100，对应拼图块可移动的宽度 */
const sliderFill = computed(() => `${sliderX.value}%`)

/** 拼图块在背景图中的左边缘百分比：滑块位置按可移动宽度缩放 */
const pieceLeft = computed(() => {
  if (!captcha.value) return 0
  return (sliderX.value * (100 - captcha.value.piecePercent)) / 100
})

const slotRows = computed(() => {
  const rows: {
    slot: number
    meta: { name: string; size: number; updatedAt: string } | null
  }[] = []
  const limit = props.controller.slotLimit.value
  for (let slot = 1; slot <= limit; slot += 1) {
    const meta = props.controller.slots.value.find((item) => item.slot === slot) ?? null
    rows.push({ slot, meta })
  }
  return rows
})

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

async function refreshCaptcha() {
  captchaLoading.value = true
  localError.value = ''
  try {
    captcha.value = await props.controller.getCaptcha()
    sliderX.value = 0
  } catch (err) {
    localError.value = err instanceof Error ? err.message : '验证码加载失败'
  } finally {
    captchaLoading.value = false
  }
}

function switchMode(next: 'login' | 'register') {
  if (mode.value === next) return
  mode.value = next
  localError.value = ''
  password.value = ''
  confirmPassword.value = ''
  void refreshCaptcha()
}

async function submitAuth() {
  if (submitting.value) return
  localError.value = ''

  const name = username.value.trim()
  if (!name) {
    localError.value = '请输入用户名'
    return
  }
  if (!password.value) {
    localError.value = '请输入密码'
    return
  }
  if (mode.value === 'register' && password.value !== confirmPassword.value) {
    localError.value = '两次输入的密码不一致'
    return
  }
  if (!captcha.value) {
    localError.value = '验证码未加载，请点击刷新'
    return
  }

  submitting.value = true
  try {
    const input = {
      username: name,
      password: password.value,
      captchaToken: captcha.value.token,
      captchaX: pieceLeft.value,
    }
    const registered = mode.value === 'register'
    if (registered) await props.controller.register(input)
    else await props.controller.login(input)

    password.value = ''
    confirmPassword.value = ''
    username.value = ''
    emit('notify', registered ? '验证通过，注册成功' : '验证通过，登录成功')
    emit('login-success')
  } catch (err) {
    localError.value = err instanceof Error ? err.message : '操作失败，请重试'
    // 验证码已被服务端消耗，失败后换一张
    captcha.value = null
    await refreshCaptcha()
  } finally {
    submitting.value = false
  }
}

async function runSlotAction(slot: number, action: () => Promise<void>) {
  if (activeSlot.value !== null) return
  activeSlot.value = slot
  localError.value = ''
  try {
    await action()
  } catch (err) {
    localError.value = err instanceof Error ? err.message : '云端操作失败'
  } finally {
    activeSlot.value = null
    pendingDelete.value = null
  }
}

function handleSave(slot: number) {
  void runSlotAction(slot, () => props.saveCurrent(slot))
}

function handleLoad(slot: number) {
  void runSlotAction(slot, () => props.loadSlot(slot))
}

function handleDelete(slot: number) {
  if (pendingDelete.value !== slot) {
    pendingDelete.value = slot
    window.clearTimeout(deleteTimer)
    deleteTimer = window.setTimeout(() => {
      pendingDelete.value = null
    }, 3200)
    return
  }
  window.clearTimeout(deleteTimer)
  void runSlotAction(slot, () => props.deleteSlot(slot))
}

function setAutoSlot(slot: number) {
  props.controller.setCurrentSlot(slot)
}

async function refreshSlots() {
  refreshing.value = true
  localError.value = ''
  try {
    await props.controller.refresh()
  } catch (err) {
    localError.value = err instanceof Error ? err.message : '刷新云端位置失败'
  } finally {
    refreshing.value = false
  }
}

/** 退出登录由父组件确认，确认后会同时清空当前场景 */
function logout() {
  emit('logout')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopImmediatePropagation()
    emit('close')
    return
  }
  // 阻止编辑器快捷键，但保留输入框、滑块等默认行为
  event.stopImmediatePropagation()
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown, true)
  if (!loggedIn.value) void refreshCaptcha()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown, true)
  window.clearTimeout(deleteTimer)
})
</script>

<template>
  <div class="cs-mask" @click.self="emit('close')">
    <div class="cs-dialog" role="dialog" aria-modal="true" aria-label="云端存储">
      <header class="cs-head">
        <div>
          <p class="cs-kicker">云端存储</p>
          <h3>{{ loggedIn ? '选择存储位置' : '登录后同步场景' }}</h3>
        </div>
        <button type="button" class="cs-close" aria-label="关闭" @click="emit('close')">×</button>
      </header>

      <div class="cs-body">
        <template v-if="!loggedIn">
          <div class="cs-tabs" role="tablist">
            <button
              type="button"
              class="cs-tab"
              :class="{ on: mode === 'login' }"
              role="tab"
              :aria-selected="mode === 'login'"
              @click="switchMode('login')"
            >
              登录
            </button>
            <button
              type="button"
              class="cs-tab"
              :class="{ on: mode === 'register' }"
              role="tab"
              :aria-selected="mode === 'register'"
              @click="switchMode('register')"
            >
              注册
            </button>
          </div>

          <label class="cs-field">
            <span>用户名</span>
            <input
              v-model="username"
              type="text"
              autocomplete="username"
              maxlength="24"
              placeholder="3-24 位中文、字母、数字或下划线"
              @keydown.enter.prevent="submitAuth"
            />
          </label>
          <label class="cs-field">
            <span>密码</span>
            <input
              v-model="password"
              type="password"
              :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
              maxlength="64"
              placeholder="至少 6 位"
              @keydown.enter.prevent="submitAuth"
            />
          </label>
          <label v-if="mode === 'register'" class="cs-field">
            <span>确认密码</span>
            <input
              v-model="confirmPassword"
              type="password"
              autocomplete="new-password"
              maxlength="64"
              placeholder="再次输入密码"
              @keydown.enter.prevent="submitAuth"
            />
          </label>

          <div class="cs-captcha-block">
            <div
              v-if="captcha"
              class="cs-captcha"
              :style="{ aspectRatio: `${captcha.width} / ${captcha.height}` }"
            >
              <img class="cs-captcha-bg" :src="captcha.background" alt="" draggable="false" />
              <img
                class="cs-captcha-piece"
                :src="captcha.piece"
                alt=""
                draggable="false"
                :style="{
                  left: `${pieceLeft}%`,
                  top: `${captcha.yPercent}%`,
                  width: `${captcha.piecePercent}%`,
                }"
              />
            </div>
            <div v-else class="cs-captcha-loading">
              {{ captchaLoading ? '验证码加载中…' : '验证码未加载' }}
            </div>

            <div class="cs-slider">
              <div class="cs-slider-fill" :style="{ width: sliderFill }" />
              <input
                v-model.number="sliderX"
                type="range"
                min="0"
                max="100"
                step="0.1"
                :disabled="captchaLoading || !captcha"
                aria-label="拖动滑块对齐拼图"
              />
              <span class="cs-slider-hint" :class="{ hidden: sliderX > 0.5 }">
                拖动滑块完成拼图
              </span>
            </div>
            <button type="button" class="cs-refresh" :disabled="captchaLoading" @click="refreshCaptcha">
              换一张
            </button>
          </div>

          <p class="cs-error" v-if="errorText">{{ errorText }}</p>

          <button
            type="button"
            class="cs-btn pri"
            :disabled="submitting || busyNow"
            @click="submitAuth"
          >
            {{ submitting || busyNow ? '请稍候…' : mode === 'register' ? '注册并登录' : '登录' }}
          </button>

          <p class="cs-foot-note">
            云端为每个账号提供 10 个存储位置；开启云存储后不会写入浏览器 IndexedDB。
          </p>
        </template>

        <template v-else>
          <div class="cs-user">
            <span class="cs-avatar">{{ accountName.slice(0, 1).toUpperCase() }}</span>
            <div class="cs-user-info">
              <b>{{ accountName }}</b>
              <span>已连接云端存储</span>
            </div>
            <button type="button" class="cs-mini" :disabled="refreshing" @click="refreshSlots">
              {{ refreshing ? '刷新中…' : '刷新' }}
            </button>
            <button type="button" class="cs-mini" @click="logout">退出</button>
          </div>

          <div v-if="pendingScene" class="cs-pending">
            <div class="cs-pending-copy">
              <b>当前场景尚未保存</b>
              <span>
                登录不会自动覆盖云端数据。请选择下方空位置另存，或覆盖已有位置；也可以弃用当前场景。
              </span>
            </div>
            <button type="button" class="cs-mini danger" @click="emit('discard-scene')">
              弃用当前场景
            </button>
          </div>

          <p class="cs-auto">
            自动保存位置：
            <b>{{ currentSlot ? `位置 ${currentSlot}` : '未选择（登录后需选择位置）' }}</b>
          </p>

          <p class="cs-error" v-if="errorText">{{ errorText }}</p>

          <ul class="cs-slots">
            <li
              v-for="row in slotRows"
              :key="row.slot"
              class="cs-slot"
              :class="{ empty: !row.meta, current: currentSlot === row.slot }"
            >
              <div class="cs-slot-head">
                <span class="cs-slot-index">{{ row.slot }}</span>
                <div class="cs-slot-info">
                  <b>{{ row.meta ? row.meta.name : '空位置' }}</b>
                  <span v-if="row.meta">
                    {{ formatTime(row.meta.updatedAt) }} · {{ formatSize(row.meta.size) }}
                  </span>
                  <span v-else>保存当前场景到这里</span>
                </div>
                <span v-if="currentSlot === row.slot" class="cs-badge">自动保存</span>
              </div>

              <div class="cs-slot-actions">
                <button
                  v-if="row.meta"
                  type="button"
                  class="cs-mini"
                  :disabled="activeSlot !== null"
                  @click="handleLoad(row.slot)"
                >
                  {{ activeSlot === row.slot ? '处理中…' : '加载' }}
                </button>
                <button
                  type="button"
                  class="cs-mini"
                  :disabled="activeSlot !== null"
                  @click="handleSave(row.slot)"
                >
                  {{ row.meta ? '覆盖' : '保存' }}
                </button>
                <button
                  v-if="row.meta && currentSlot !== row.slot"
                  type="button"
                  class="cs-mini"
                  @click="setAutoSlot(row.slot)"
                >
                  设为自动保存
                </button>
                <button
                  v-if="row.meta"
                  type="button"
                  class="cs-mini danger"
                  :disabled="activeSlot !== null"
                  @click="handleDelete(row.slot)"
                >
                  {{ pendingDelete === row.slot ? '确认删除' : '删除' }}
                </button>
              </div>
            </li>
          </ul>

          <p class="cs-foot-note">
            最多 10 个存储位置；「加载」会用云端场景替换当前编辑内容，若本地已有数据会先询问是否覆盖。删除存档会同时删除该存档的分享链接。
          </p>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cs-mask {
  position: fixed;
  inset: 0;
  z-index: 95;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(4, 5, 6, 0.66);
  backdrop-filter: blur(3px);
}

.cs-dialog {
  width: 520px;
  max-width: 100%;
  max-height: calc(100vh - 40px);
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  background: #0b0c0e;
  box-shadow: 0 40px 90px -30px #000;
  color: var(--ink-2, #b6bac1);
}

.cs-head {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 16px 16px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
}

.cs-kicker {
  margin: 0 0 3px;
  font-family: var(--mono, monospace);
  font-size: 9px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-3, #63666c);
}

.cs-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--ink, #ecedef);
}

.cs-close {
  margin-left: auto;
  width: 26px;
  height: 26px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  background: #16171b;
  color: var(--ink-2, #b6bac1);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}

.cs-close:hover {
  color: var(--ink, #ecedef);
}

.cs-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 11px;
}

.cs-tabs {
  display: flex;
  gap: 4px;
  padding: 3px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 7px;
  background: #0e0f12;
}

.cs-tab {
  flex: 1;
  height: 28px;
  border: 0;
  border-radius: 5px;
  background: none;
  color: var(--ink-2, #b6bac1);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.cs-tab.on {
  background: #202231;
  color: #cdd3ff;
}

.cs-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 11px;
  color: var(--ink-3, #63666c);
}

.cs-field input {
  height: 34px;
  padding: 0 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  background: #0e0f12;
  color: var(--ink, #ecedef);
  font: inherit;
  font-size: 12.5px;
}

.cs-field input:focus {
  outline: none;
  border-color: #6f7ce8;
}

.cs-captcha-block {
  position: relative;
}

.cs-captcha {
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: #16171b;
  user-select: none;
}

.cs-captcha-bg {
  display: block;
  width: 100%;
  height: 100%;
}

.cs-captcha-piece {
  position: absolute;
  height: auto;
  pointer-events: none;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.55));
}

.cs-captcha-loading {
  display: grid;
  place-items: center;
  height: 140px;
  border: 1px dashed rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: var(--ink-3, #63666c);
  font-size: 11.5px;
}

.cs-slider {
  position: relative;
  margin-top: 9px;
  height: 42px;
  border-radius: 7px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: #111318;
}

.cs-slider-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(90deg, #3c447e, #6f7ce8);
  pointer-events: none;
  transition: width 0.06s linear;
}

.cs-slider input[type='range'] {
  position: absolute;
  inset: 0;
  z-index: 2;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  background: transparent;
  outline: none;
  -webkit-appearance: none;
  appearance: none;
  cursor: ew-resize;
}

.cs-slider input[type='range']::-webkit-slider-runnable-track {
  height: 100%;
  background: transparent;
  border: 0;
}

.cs-slider input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 44px;
  height: 34px;
  margin-top: 3px;
  border-radius: 6px;
  border: 1px solid #fff;
  background: linear-gradient(180deg, #ffffff 0%, #dfe3ec 100%);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.55), inset 0 -2px 0 rgba(0, 0, 0, 0.08);
  cursor: grab;
}

.cs-slider input[type='range']:active::-webkit-slider-thumb {
  cursor: grabbing;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.5), inset 0 -2px 0 rgba(0, 0, 0, 0.08);
}

.cs-slider input[type='range']::-moz-range-track {
  height: 100%;
  background: transparent;
  border: 0;
}

.cs-slider input[type='range']::-moz-range-thumb {
  width: 42px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid #fff;
  background: linear-gradient(180deg, #ffffff 0%, #dfe3ec 100%);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.55);
  cursor: grab;
}

.cs-slider-hint {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 11.5px;
  letter-spacing: 0.02em;
  color: #b6bdd0;
  pointer-events: none;
  z-index: 1;
  transition: opacity 0.15s ease;
}

.cs-slider-hint.hidden {
  opacity: 0;
}

.cs-refresh {
  position: absolute;
  right: 6px;
  top: 6px;
  z-index: 2;
  height: 22px;
  padding: 0 8px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 4px;
  background: rgba(10, 11, 14, 0.72);
  color: #cfd3dc;
  font: inherit;
  font-size: 10px;
  cursor: pointer;
}

.cs-refresh:hover {
  border-color: rgba(255, 255, 255, 0.3);
}

.cs-error {
  margin: 0;
  padding: 7px 9px;
  border: 1px solid rgba(224, 116, 116, 0.35);
  border-radius: 5px;
  background: rgba(126, 44, 44, 0.18);
  color: #e5a3a3;
  font-size: 11.5px;
}

.cs-btn {
  height: 34px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  background: #16171b;
  color: var(--ink-2, #b6bac1);
  font: inherit;
  font-size: 12.5px;
  cursor: pointer;
}

.cs-btn.pri {
  border-color: transparent;
  background: #6f7ce8;
  color: #fff;
}

.cs-btn.pri:hover:not(:disabled) {
  background: #7f8bef;
}

.cs-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.cs-foot-note {
  margin: 2px 0 0;
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--ink-3, #63666c);
}

.cs-user {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 7px;
  background: #0e0f12;
}

.cs-avatar {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  background: #2b3050;
  color: #cdd3ff;
  font-size: 13px;
  font-weight: 600;
}

.cs-user-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  margin-right: auto;
}

.cs-user-info b {
  font-size: 12.5px;
  color: var(--ink, #ecedef);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cs-user-info span {
  font-size: 10px;
  color: var(--ink-3, #63666c);
}

.cs-mini {
  height: 24px;
  padding: 0 9px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  background: #16171b;
  color: var(--ink-2, #b6bac1);
  font: inherit;
  font-size: 10.5px;
  cursor: pointer;
}

.cs-mini:hover:not(:disabled) {
  border-color: rgba(255, 255, 255, 0.24);
  color: var(--ink, #ecedef);
}

.cs-mini:disabled {
  opacity: 0.5;
  cursor: default;
}

.cs-mini.danger {
  color: #e0a0a0;
  border-color: rgba(224, 116, 116, 0.28);
}

.cs-pending {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 11px;
  border: 1px solid rgba(224, 156, 90, 0.36);
  border-radius: 7px;
  background: rgba(122, 82, 34, 0.16);
}

.cs-pending-copy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  margin-right: auto;
}

.cs-pending-copy b {
  font-size: 12px;
  font-weight: 600;
  color: #f0c48a;
}

.cs-pending-copy span {
  font-size: 10.5px;
  line-height: 1.55;
  color: var(--ink-3, #63666c);
}

.cs-pending .cs-mini {
  flex: none;
}

.cs-auto {
  margin: 0;
  font-size: 11px;
  color: var(--ink-3, #63666c);
}

.cs-auto b {
  color: #cdd3ff;
  font-weight: 500;
}

.cs-slots {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.cs-slot {
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 7px;
  background: #0e0f12;
}

.cs-slot.current {
  border-color: rgba(111, 124, 232, 0.55);
  background: #10121b;
}

.cs-slot.empty {
  opacity: 0.72;
}

.cs-slot-head {
  display: flex;
  align-items: center;
  gap: 9px;
}

.cs-slot-index {
  display: grid;
  place-items: center;
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  background: #191b22;
  color: var(--ink-3, #63666c);
  font-family: var(--mono, monospace);
  font-size: 10px;
}

.cs-slot-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  margin-right: auto;
}

.cs-slot-info b {
  font-size: 12px;
  font-weight: 500;
  color: var(--ink, #ecedef);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cs-slot-info span {
  font-size: 10px;
  color: var(--ink-3, #63666c);
}

.cs-badge {
  flex: none;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(111, 124, 232, 0.18);
  color: #b9c0ff;
  font-size: 9.5px;
}

.cs-slot-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 7px;
  padding-left: 31px;
}

@media (max-width: 520px) {
  .cs-dialog {
    width: 100%;
  }

  .cs-slot-actions {
    padding-left: 0;
  }
}
</style>
