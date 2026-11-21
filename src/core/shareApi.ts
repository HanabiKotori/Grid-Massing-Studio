import { dataServiceRequest } from './cloudStorage'
import type { SceneJson } from './sceneFile'
import type { Booth, Infra, Underlay, Venue, VenueRules } from './types'
import type { WeatherKind } from './weather'

export interface ShareMeta {
  token: string
  title: string
  projectKey: string
  revision: number
  sceneVersion: number
  liveMode: boolean
  allowComment: boolean
  allowDownload: boolean
  revoked: boolean
  viewerCount: number
  commentCount: number
  sceneSize: number
  createdAt: string
  updatedAt: string
}

export interface ShareSceneResponse {
  revision: number
  sceneVersion: number
  scene: SceneJson
}

export interface CommentAnchor {
  point: [number, number, number]
  object?: { kind: 'booth' | 'infra'; id: string }
  /** 评论时对象的原点，实时场景下用它把引脚跟随对象移动 */
  objectOrigin?: [number, number]
  camera?: {
    position: [number, number, number]
    target: [number, number, number]
  }
}

export interface ShareComment {
  id: number
  parentId: number | null
  shareToken: string
  shareTitle: string
  anchor: CommentAnchor
  authorName: string
  authorRole: 'owner' | 'visitor'
  content: string
  resolvedAt: string | null
  resolvedBy: string
  createdAt: string
  updatedAt: string
  mine: boolean
}

export interface BoothDelta {
  upsert: Booth[]
  remove: string[]
}

export interface InfraDelta {
  upsert: Infra[]
  remove: string[]
}

export interface ScenePatch {
  venue?: Venue
  underlay?: Underlay | null
  weather?: WeatherKind
  weatherOn?: boolean
  sunProgress?: number
  rules?: VenueRules
  booths?: BoothDelta
  infras?: InfraDelta
}

export type ReviewEvent =
  | { type: 'hello'; revision?: number; viewerCount?: number }
  | { type: 'heartbeat' }
  | { type: 'scene.patch'; revision: number; patch: ScenePatch }
  | { type: 'scene.reset'; revision: number; sceneVersion: number }
  | { type: 'share.updated'; share: ShareMeta }
  | { type: 'comment.created'; comment: ShareComment }
  | { type: 'comment.updated'; comment: ShareComment }
  | { type: 'comment.deleted'; shareToken: string; id: number }
  | { type: 'presence'; token: string; count: number }
  | { type: 'revoked' }
  | { type: 'share.created'; share: ShareMeta }
  | { type: 'share.revoked'; shareToken: string }

export interface CreateShareInput {
  title: string
  scene: SceneJson
  projectKey: string
  liveMode?: boolean
  allowComment?: boolean
  allowDownload?: boolean
}

export interface CommentInput {
  content: string
  anchor: CommentAnchor
  authorName: string
  authorToken: string
  parentId?: number | null
  clientId?: string
}

export const shareApi = {
  createShare: (input: CreateShareInput) =>
    dataServiceRequest<ShareMeta & { projectKey: string }>(
      '/api/shares',
      { method: 'POST', body: JSON.stringify(input) },
      true,
    ),

  listShares: () =>
    dataServiceRequest<{ shares: ShareMeta[] }>('/api/shares', {}, true),

  getShare: (token: string) =>
    dataServiceRequest<ShareMeta>(`/api/shares/${encodeURIComponent(token)}`),

  getShareScene: (token: string) =>
    dataServiceRequest<ShareSceneResponse>(
      `/api/shares/${encodeURIComponent(token)}/scene`,
    ),

  updateShare: (
    token: string,
    input: {
      title?: string
      liveMode?: boolean
      allowComment?: boolean
      allowDownload?: boolean
      scene?: SceneJson
    },
  ) =>
    dataServiceRequest<ShareMeta>(
      `/api/shares/${encodeURIComponent(token)}`,
      { method: 'PATCH', body: JSON.stringify(input) },
      true,
    ),

  revokeShare: (token: string) =>
    dataServiceRequest<{ ok: true }>(
      `/api/shares/${encodeURIComponent(token)}`,
      { method: 'DELETE' },
      true,
    ),

  patchLive: (token: string, baseRevision: number, patch: ScenePatch) =>
    dataServiceRequest<{ revision: number }>(
      `/api/shares/${encodeURIComponent(token)}/live`,
      { method: 'PATCH', body: JSON.stringify({ baseRevision, patch }) },
      true,
    ),

  getLiveSince: (token: string, since: number) =>
    dataServiceRequest<{ revision: number; scene: SceneJson | null }>(
      `/api/shares/${encodeURIComponent(token)}/live?since=${since}`,
    ),

  listComments: (token: string, authorToken = '') =>
    dataServiceRequest<{ comments: ShareComment[] }>(
      `/api/shares/${encodeURIComponent(token)}/comments${
        authorToken ? `?authorToken=${encodeURIComponent(authorToken)}` : ''
      }`,
    ),

  createComment: (token: string, input: CommentInput) =>
    dataServiceRequest<{ comment: ShareComment }>(
      `/api/shares/${encodeURIComponent(token)}/comments`,
      { method: 'POST', body: JSON.stringify(input) },
      true,
    ),

  updateComment: (
    token: string,
    id: number,
    input: { content?: string; resolved?: boolean; authorToken: string },
  ) =>
    dataServiceRequest<{ comment: ShareComment }>(
      `/api/shares/${encodeURIComponent(token)}/comments/${id}`,
      { method: 'PATCH', body: JSON.stringify(input) },
      true,
    ),

  deleteComment: (token: string, id: number, authorToken = '') =>
    dataServiceRequest<{ ok: true }>(
      `/api/shares/${encodeURIComponent(token)}/comments/${id}?authorToken=${encodeURIComponent(
        authorToken,
      )}`,
      { method: 'DELETE' },
      true,
    ),

  getReviewComments: (projectKey: string) =>
    dataServiceRequest<{
      links: ShareMeta[]
      comments: ShareComment[]
      unresolved: number
    }>(`/api/review/comments?projectKey=${encodeURIComponent(projectKey)}`, {}, true),

  shareStreamTicket: (token: string) =>
    dataServiceRequest<{ ticket: string; expiresIn: number }>(
      `/api/shares/${encodeURIComponent(token)}/stream-ticket`,
      { method: 'POST', body: '{}' },
    ),

  reviewStreamTicket: (projectKey: string) =>
    dataServiceRequest<{ ticket: string; expiresIn: number }>(
      '/api/review/stream-ticket',
      { method: 'POST', body: JSON.stringify({ projectKey }) },
      true,
    ),
}
