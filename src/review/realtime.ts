import { dataServiceUrl } from '../core/cloudStorage'
import { shareApi, type ReviewEvent } from '../core/shareApi'

export type StreamState = 'connecting' | 'live' | 'error'

export interface StreamHandlers {
  onEvent: (event: ReviewEvent) => void
  onState?: (state: StreamState) => void
}

export interface StreamController {
  close: () => void
}

const RETRY_DELAYS = [1000, 2000, 5000, 10000]

function startStream(
  getTicket: () => Promise<{ ticket: string }>,
  path: string,
  handlers: StreamHandlers,
): StreamController {
  let closed = false
  let source: EventSource | null = null
  let timer = 0
  let attempt = 0

  const schedule = () => {
    if (closed) return
    const delay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)]
    attempt += 1
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void connect(), delay)
  }

  const connect = async () => {
    if (closed) return
    handlers.onState?.('connecting')
    try {
      const { ticket } = await getTicket()
      if (closed) return
      source?.close()
      source = new EventSource(
        dataServiceUrl(`${path}?ticket=${encodeURIComponent(ticket)}`),
      )
      source.onopen = () => {
        attempt = 0
        handlers.onState?.('live')
      }
      source.onmessage = (event) => {
        let payload: ReviewEvent
        try {
          payload = JSON.parse(event.data) as ReviewEvent
        } catch {
          return
        }
        handlers.onEvent(payload)
        if (payload.type === 'revoked') close()
      }
      source.onerror = () => {
        source?.close()
        source = null
        if (closed) return
        handlers.onState?.('error')
        schedule()
      }
    } catch {
      if (closed) return
      handlers.onState?.('error')
      schedule()
    }
  }

  const close = () => {
    if (closed) return
    closed = true
    window.clearTimeout(timer)
    source?.close()
    source = null
  }

  void connect()
  return { close }
}

export function openShareStream(token: string, handlers: StreamHandlers): StreamController {
  return startStream(
    () => shareApi.shareStreamTicket(token),
    `/api/shares/${encodeURIComponent(token)}/stream`,
    handlers,
  )
}

export function openProjectStream(
  projectKey: string,
  handlers: StreamHandlers,
): StreamController {
  return startStream(
    () => shareApi.reviewStreamTicket(projectKey),
    '/api/review/stream',
    handlers,
  )
}
