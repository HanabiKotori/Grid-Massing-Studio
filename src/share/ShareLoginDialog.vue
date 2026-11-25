<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  cloudApi,
  type AuthResponse,
  type CaptchaChallenge,
} from '../core/cloudStorage'

const props = withDefaults(
  defineProps<{
    open: boolean
    initialMode?: 'login' | 'register'
    title?: string
    subtitle?: string
    note?: string
  }>(),
  {
    initialMode: 'login',
    title: '登录后参与评论',
    subtitle: '查看链接不需要登录。登录仅用于评论身份、回复和解决状态。',
    note: '使用与编辑器相同的云端账号。登录成功后回到当前视角，已选位置和草稿不会丢失。',
  },
)

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'success', result: AuthResponse): void
}>()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const captcha = ref<CaptchaChallenge | null>(null)
const captchaLoading = ref(false)
const sliderX = ref(0)
const submitting = ref(false)
const error = ref('')
const usernameInput = ref<HTMLInputElement | null>(null)

const pieceLeft = computed(() => {
  if (!captcha.value) return 0
  return (sliderX.value * (100 - captcha.value.piecePercent)) / 100
})

const sliderFill = computed(() => `${sliderX.value}%`)

async function refreshCaptcha() {
  captchaLoading.value = true
  error.value = ''
  try {
    captcha.value = await cloudApi.captcha()
    sliderX.value = 0
  } catch (err) {
    error.value = err instanceof Error ? err.message : '验证码加载失败'
  } finally {
    captchaLoading.value = false
  }
}

function switchMode(next: 'login' | 'register') {
  if (mode.value === next) return
  mode.value = next
  error.value = ''
  password.value = ''
  confirmPassword.value = ''
  void refreshCaptcha()
}

function close() {
  if (submitting.value) return
  emit('close')
}

async function submit() {
  if (submitting.value) return
  error.value = ''
  const name = username.value.trim()
  if (!name) {
    error.value = '请输入用户名'
    return
  }
  if (!password.value) {
    error.value = '请输入密码'
    return
  }
  if (mode.value === 'register' && password.value !== confirmPassword.value) {
    error.value = '两次输入的密码不一致'
    return
  }
  if (!captcha.value) {
    error.value = '验证码未加载，请点击换一张'
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
    const result =
      mode.value === 'register'
        ? await cloudApi.register(input)
        : await cloudApi.login(input)
    password.value = ''
    confirmPassword.value = ''
    sliderX.value = 0
    captcha.value = null
    emit('success', result)
  } catch (err) {
    error.value = err instanceof Error ? err.message : '登录失败，请重试'
    captcha.value = null
    await refreshCaptcha()
  } finally {
    submitting.value = false
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      password.value = ''
      confirmPassword.value = ''
      error.value = ''
      return
    }
    mode.value = props.initialMode
    error.value = ''
    sliderX.value = 0
    captcha.value = null
    void refreshCaptcha()
    void nextTick(() => usernameInput.value?.focus())
  },
  { immediate: true },
)

watch(
  () => props.initialMode,
  (next) => {
    if (!props.open) return
    if (mode.value === next) return
    mode.value = next
    error.value = ''
    password.value = ''
    confirmPassword.value = ''
    void refreshCaptcha()
  },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="sl-fade">
      <div v-if="open" class="sl-mask" @click.self="close">
        <div
          class="sl-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sl-title"
          @keydown.esc.stop="close"
        >
          <header class="sl-head">
            <div>
              <h2 id="sl-title">{{ title }}</h2>
              <p>{{ subtitle }}</p>
            </div>
            <button class="sl-close" type="button" aria-label="关闭" @click="close">×</button>
          </header>

          <div class="sl-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              :aria-selected="mode === 'login'"
              :class="{ on: mode === 'login' }"
              @click="switchMode('login')"
            >
              登录
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="mode === 'register'"
              :class="{ on: mode === 'register' }"
              @click="switchMode('register')"
            >
              注册
            </button>
          </div>

          <div class="sl-body">
            <label class="sl-field">
              <span>用户名</span>
              <input
                ref="usernameInput"
                v-model="username"
                type="text"
                autocomplete="username"
                maxlength="24"
                placeholder="3-24 位中文、字母、数字或下划线"
                @keydown.enter.prevent="submit"
              />
            </label>
            <label class="sl-field">
              <span>密码</span>
              <input
                v-model="password"
                type="password"
                :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
                maxlength="64"
                placeholder="至少 6 位"
                @keydown.enter.prevent="submit"
              />
            </label>
            <label v-if="mode === 'register'" class="sl-field">
              <span>确认密码</span>
              <input
                v-model="confirmPassword"
                type="password"
                autocomplete="new-password"
                maxlength="64"
                placeholder="再次输入密码"
                @keydown.enter.prevent="submit"
              />
            </label>

            <div class="sl-captcha-block">
              <div
                v-if="captcha"
                class="sl-captcha"
                :style="{ aspectRatio: `${captcha.width} / ${captcha.height}` }"
              >
                <img class="sl-captcha-bg" :src="captcha.background" alt="" draggable="false" />
                <img
                  class="sl-captcha-piece"
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
              <div v-else class="sl-captcha-loading">
                {{ captchaLoading ? '验证码加载中…' : '验证码未加载' }}
              </div>
              <div class="sl-slider">
                <div class="sl-slider-fill" :style="{ width: sliderFill }" />
                <input
                  v-model.number="sliderX"
                  type="range"
                  min="0"
                  max="100"
                  step="0.1"
                  :disabled="captchaLoading || !captcha"
                  aria-label="拖动滑块对齐拼图"
                />
                <span class="sl-slider-hint" :class="{ hidden: sliderX > 0.5 }">
                  拖动滑块完成拼图
                </span>
              </div>
              <button
                class="sl-refresh"
                type="button"
                :disabled="captchaLoading"
                @click="refreshCaptcha"
              >
                换一张
              </button>
            </div>

            <p v-if="error" class="sl-error">{{ error }}</p>
          </div>

          <footer class="sl-foot">
            <button class="sl-btn ghost" type="button" @click="close">取消</button>
            <span class="sl-sp" />
            <button
              class="sl-btn pri"
              type="button"
              :disabled="submitting || captchaLoading"
              @click="submit"
            >
              {{ submitting ? '请稍候…' : mode === 'register' ? '注册并登录' : '登录' }}
            </button>
          </footer>
          <p class="sl-note">{{ note }}</p>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sl-mask {
  --ink: #ecedef;
  --ink-2: #9b9fa5;
  --ink-3: #63666c;
  --line: rgba(255, 255, 255, 0.07);
  --line-strong: rgba(255, 255, 255, 0.13);
  --accent: #6f7ce8;
  --accent-soft: rgba(111, 124, 232, 0.15);
  --surface: #0b0c0e;
  --surface-2: #101113;
  --mono: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Mono", Consolas,
    monospace;
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(4, 5, 7, 0.72);
  backdrop-filter: blur(6px) saturate(80%);
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "PingFang SC",
    "HarmonyOS Sans SC", "MiSans", "Segoe UI", "Microsoft YaHei", sans-serif;
}

.sl-dialog {
  width: min(420px, 100%);
  max-height: calc(100vh - 40px);
  overflow: auto;
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  background: #0e0f12;
  box-shadow: 0 44px 90px -30px rgba(0, 0, 0, 0.96);
}

.sl-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 18px 20px 12px;
}

.sl-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.015em;
}

.sl-head p {
  margin: 4px 0 0;
  font-size: 10.5px;
  line-height: 1.65;
  color: var(--ink-3);
}

.sl-close {
  margin-left: auto;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 4px;
  background: none;
  color: var(--ink-3);
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}

.sl-close:hover {
  background: var(--surface-2);
  color: var(--ink);
}

.sl-tabs {
  display: flex;
  gap: 4px;
  margin: 0 20px;
  padding: 3px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--surface);
}

.sl-tabs button {
  flex: 1;
  height: 26px;
  border: 0;
  border-radius: 4px;
  background: none;
  font: inherit;
  font-size: 11.5px;
  color: var(--ink-3);
  cursor: pointer;
}

.sl-tabs button.on {
  background: var(--surface-2);
  color: var(--ink);
}

.sl-body {
  padding: 14px 20px 4px;
}

.sl-field {
  display: block;
  margin-top: 10px;
}

.sl-field > span {
  display: block;
  margin-bottom: 5px;
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-3);
}

.sl-field input {
  width: 100%;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--surface-2);
  color: var(--ink);
  font: inherit;
  font-size: 12px;
  outline: none;
}

.sl-field input:focus {
  border-color: var(--accent);
}

.sl-captcha-block {
  position: relative;
  margin-top: 12px;
  padding-bottom: 20px;
}

.sl-captcha {
  position: relative;
  width: 100%;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #171a20;
}

.sl-captcha-bg {
  display: block;
  width: 100%;
  height: 100%;
}

.sl-captcha-piece {
  position: absolute;
  height: auto;
  pointer-events: none;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.55));
}

.sl-captcha-loading {
  display: grid;
  place-items: center;
  height: 120px;
  border: 1px dashed var(--line-strong);
  border-radius: 6px;
  font-size: 10.5px;
  color: var(--ink-3);
}

.sl-slider {
  position: relative;
  height: 34px;
  margin-top: 8px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--surface-2);
  overflow: hidden;
}

.sl-slider-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: var(--accent-soft);
}

.sl-slider input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: grab;
}

.sl-slider-hint {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 10px;
  color: var(--ink-3);
  pointer-events: none;
}

.sl-slider-hint.hidden {
  opacity: 0;
}

.sl-refresh {
  position: absolute;
  right: 0;
  bottom: 0;
  height: 16px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--ink-3);
  font: inherit;
  font-size: 9.5px;
  cursor: pointer;
}

.sl-refresh:hover {
  color: var(--ink);
}

.sl-error {
  margin: 12px 0 0;
  padding: 7px 8px;
  border: 1px solid rgba(235, 87, 87, 0.24);
  border-radius: 5px;
  background: rgba(235, 87, 87, 0.06);
  font-size: 10px;
  color: #e98a8a;
}

.sl-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  padding: 12px 20px;
  border-top: 1px solid var(--line);
  background: var(--surface);
}

.sl-sp {
  flex: 1;
}

.sl-btn {
  height: 28px;
  padding: 0 11px;
  border: 1px solid var(--line-strong);
  border-radius: 5px;
  background: var(--surface-2);
  color: var(--ink);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
}

.sl-btn.ghost {
  border-color: transparent;
  background: transparent;
  color: var(--ink-3);
}

.sl-btn.pri {
  border-color: transparent;
  background: var(--accent);
  color: #fff;
}

.sl-btn:disabled {
  opacity: 0.45;
  cursor: wait;
}

.sl-note {
  margin: 0;
  padding: 0 20px 16px;
  font-size: 9.5px;
  line-height: 1.6;
  color: var(--ink-3);
}

.sl-fade-enter-active,
.sl-fade-leave-active {
  transition: opacity 0.16s ease;
}

.sl-fade-enter-from,
.sl-fade-leave-to {
  opacity: 0;
}

@media (max-width: 520px) {
  .sl-mask {
    padding: 12px;
    align-items: end;
  }

  .sl-dialog {
    width: 100%;
    max-height: calc(100vh - 24px);
    border-radius: 12px 12px 8px 8px;
  }
}
</style>
