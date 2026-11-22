import { reactive } from 'vue'

export type MessageScope = 'editor' | 'share' | 'multiplayer'
export type MessageType = 'action' | 'collab' | 'system' | 'block'
export type ToastKind = 'action' | 'collab' | 'system'
export type MessageSeverity = 'success' | 'info' | 'warning' | 'error'
/** B 类音效：普通评论 / 直接回复当前访客 / 作者删除等危险操作 */
export type CollabSound = 'comment' | 'reply' | 'danger'

export interface MessageAction {
  label: string
  run: () => void
}

export interface AppMessage {
  id: number
  scope: MessageScope
  type: MessageType
  severity: MessageSeverity
  title: string
  text?: string
  action?: MessageAction
  duration: number
  dedupeKey?: string
  createdAt: number
}

export interface MessageInput {
  scope: MessageScope
  type: MessageType
  title: string
  text?: string
  severity?: MessageSeverity
  duration?: number
  action?: MessageAction
  dedupeKey?: string
}

/** 所有 Toast 类型默认都有自动消失时间；0 仅用于确需常驻的调试场景 */
export const MESSAGE_DURATIONS: Record<MessageType, number> = {
  action: 2800,
  collab: 4200,
  system: 3600,
  block: 6000,
}

const DEFAULT_SEVERITY: Record<MessageType, MessageSeverity> = {
  action: 'info',
  collab: 'info',
  system: 'info',
  block: 'error',
}

export const messages = reactive<AppMessage[]>([])
let sequence = 0

export function toastKindOf(type: MessageType): ToastKind {
  if (type === 'action') return 'action'
  if (type === 'collab') return 'collab'
  return 'system'
}

export function typeLabel(type: MessageType): string {
  return { action: 'A', collab: 'B', system: 'C', block: 'D' }[type]
}

export function pushMessage(input: MessageInput): number {
  if (input.dedupeKey) {
    const existing = messages.find(
      (item) =>
        item.scope === input.scope &&
        item.type === input.type &&
        item.dedupeKey === input.dedupeKey,
    )
    if (existing) dismissMessage(existing.id)
  }
  const message: AppMessage = {
    id: ++sequence,
    scope: input.scope,
    type: input.type,
    severity: input.severity ?? DEFAULT_SEVERITY[input.type],
    title: input.title,
    text: input.text,
    action: input.action,
    duration:
      input.duration === undefined
        ? MESSAGE_DURATIONS[input.type]
        : Math.max(0, input.duration),
    dedupeKey: input.dedupeKey,
    createdAt: Date.now(),
  }
  messages.push(message)
  return message.id
}

export function dismissMessage(id: number): void {
  const index = messages.findIndex((item) => item.id === id)
  if (index >= 0) messages.splice(index, 1)
}

export function clearMessages(scope: MessageScope): void {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].scope === scope) messages.splice(i, 1)
  }
}
