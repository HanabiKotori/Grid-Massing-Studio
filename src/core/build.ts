import * as THREE from 'three'
import { OPEN_FLOOR_HEIGHT } from './booth'
import { ELEVATOR_DEFAULT_COUNT } from './infra'
import { insetPolygon, pointInPolygon, signedArea } from './polygon'
import type { Infra, Pt } from './types'

/** 墙面开洞（出入口）：世界坐标、沿墙宽度与高度 */
export interface MassingOpening {
  x: number
  z: number
  width: number
  height: number
}

export interface MassingOptions {
  height: number
  thickness: number
  wallColor?: number
  floorColor?: number
  edgeColor?: number
  /** 场馆墙面法线贴图（仅实际场馆传入，展台/预览不传） */
  wallNormalMap?: THREE.Texture
  wallNormalScale?: number
  wallRoughness?: number
  wallMetalness?: number
  /** 台面 / 地面法线贴图，仅展台使用；场馆地面保持平整 */
  floorNormalMap?: THREE.Texture
  floorNormalScale?: number
  /** 脚手架金属立柱 / 横梁的独立法线 */
  metalNormalMap?: THREE.Texture
  metalNormalScale?: number
  metalRoughness?: number
  metalMetalness?: number
  transparent?: boolean
  opacity?: number
  edges?: boolean
  /** 展台角柱 */
  columns?: boolean
  /** 场馆封顶 */
  ceiling?: boolean
  /** 脚手架展台是否带顶棚（默认 true） */
  canopy?: boolean
  /** 标准展台去掉顶部，同时去掉立柱 */
  noTop?: boolean
  /** 场馆墙体开门洞 */
  openings?: MassingOpening[]
}

/** 展台：底部围挡高度（米）与顶板厚度 */
export const BOOTH_SKIRT = 1
export const BOOTH_TOP = 0.12
/** 展台围挡厚度（与立柱截面一致） */
export const BOOTH_WALL = 0.16
/** 展台角柱 / 开口柱截面尺寸 */
const POST = BOOTH_WALL

/** 展台每面居中留出的漫游入口缺口（短于 2m 的边整面打开） */
export function boothGapLength(edgeLength: number): number {
  return Math.min(2, edgeLength)
}

/** 取真正的转角点（跳过共线点），并带上进入/离开边的方向 */
function corners(
  pts: Pt[],
): { x: number; z: number; dx: number; dz: number; ex: number; ez: number }[] {
  const out: { x: number; z: number; dx: number; dz: number; ex: number; ez: number }[] = []
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]
    const cur = pts[i]
    const next = pts[(i + 1) % n]
    const inX = cur.x - prev.x
    const inZ = cur.z - prev.z
    const outX = next.x - cur.x
    const outZ = next.z - cur.z
    const lenIn = Math.hypot(inX, inZ)
    const lenOut = Math.hypot(outX, outZ)
    if (lenIn < 1e-4 || lenOut < 1e-4) continue
    const cross = (inX * outZ - inZ * outX) / (lenIn * lenOut)
    const dot = (inX * outX + inZ * outZ) / (lenIn * lenOut)
    // 共线（含反向）直接跳过
    if (Math.abs(cross) < 0.01 && dot > 0) continue
    out.push({
      x: cur.x,
      z: cur.z,
      dx: inX / lenIn,
      dz: inZ / lenIn,
      ex: outX / lenOut,
      ez: outZ / lenOut,
    })
  }
  return out
}

function toShapePoints(pts: Pt[]): THREE.Vector2[] {
  // three 的 Shape 位于 XY 平面，绕 X 轴 -90° 后 shape.y 映射为 -z
  return pts.map((p) => new THREE.Vector2(p.x, -p.z))
}

function ccw(pts: Pt[]): Pt[] {
  const copy = pts.map((p) => ({ x: p.x, z: p.z }))
  if (signedArea(copy) < 0) copy.reverse()
  return copy
}

/** 有厚度的墙圈（外轮廓 + 内缩孔），无孔时退化为实体 */
function ringShape(pts: Pt[], thickness: number): THREE.Shape {
  const shape = new THREE.Shape(toShapePoints(pts))
  const inner = insetPolygon(pts, thickness)
  if (inner && Math.abs(signedArea(inner)) > 0.2) {
    shape.holes.push(new THREE.Path(toShapePoints([...inner].reverse())))
  }
  return shape
}

/** 沿 Y 轴在 [y0, y1] 区间挤出 */
function extrudeBetween(shape: THREE.Shape, y0: number, y1: number): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, y1 - y0),
    bevelEnabled: false,
    steps: 1,
    curveSegments: 1,
  })
  geo.rotateX(-Math.PI / 2)
  geo.translate(0, y0, 0)
  geo.computeVertexNormals()
  return geo
}

let venueWallNormalTexture: THREE.Texture | null = null
let boothWallNormalTexture: THREE.Texture | null = null

function loadNormalTexture(path: string): THREE.Texture {
  const texture = new THREE.TextureLoader().load(path)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

/** 场馆墙面的共享金属微法线，只在首次构建场馆时加载 */
export function getVenueWallNormalMap(): THREE.Texture {
  if (venueWallNormalTexture) return venueWallNormalTexture
  venueWallNormalTexture = loadNormalTexture(
    `${import.meta.env.BASE_URL}textures/venue/metal-normal.jpg`,
  )
  return venueWallNormalTexture
}

/** 展台表面的拉丝金属法线，比场馆法线更强，单独缓存 */
export function getBoothWallNormalMap(): THREE.Texture {
  if (boothWallNormalTexture) return boothWallNormalTexture
  boothWallNormalTexture = loadNormalTexture(
    `${import.meta.env.BASE_URL}textures/booths/metal-normal.jpg?v=2`,
  )
  return boothWallNormalTexture
}

let scaffoldMetalNormalTexture: THREE.Texture | null = null

/** 脚手架立柱 / 横梁的独立拉丝金属法线 */
export function getScaffoldMetalNormalMap(): THREE.Texture {
  if (scaffoldMetalNormalTexture) return scaffoldMetalNormalTexture
  scaffoldMetalNormalTexture = loadNormalTexture(
    `${import.meta.env.BASE_URL}textures/booths/brushed-normal.jpg?v=2`,
  )
  return scaffoldMetalNormalTexture
}

/**
 * BoxGeometry 的默认 UV 是每个面 0–1；长条围挡上直接贴法线会被横向拉伸。
 * 这里按米制尺寸缩放 UV，让纹理按世界尺度平铺。
 */
function scaleBoxUv(geo: THREE.BufferGeometry, w: number, h: number, tile = 5) {
  const uv = geo.attributes.uv
  if (!uv) return
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) * w) / tile, (uv.getY(i) * h) / tile)
  }
  uv.needsUpdate = true
}

function floorMesh(pts: Pt[], mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.ShapeGeometry(new THREE.Shape(toShapePoints(pts)))
  geo.rotateX(-Math.PI / 2)
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.y = 0.012
  mesh.receiveShadow = true
  mesh.name = 'floor'
  return mesh
}

function mats(opts: MassingOptions, transparent: boolean, opacity: number) {
  const wall = new THREE.MeshStandardMaterial({
    color: opts.wallColor ?? 0xffffff,
    roughness: opts.wallRoughness ?? 0.9,
    metalness: opts.wallMetalness ?? 0,
    transparent,
    opacity,
    depthWrite: !transparent,
    side: transparent ? THREE.DoubleSide : THREE.FrontSide,
  })
  if (opts.wallNormalMap) {
    wall.normalMap = opts.wallNormalMap
    const scale = opts.wallNormalScale ?? 0.35
    wall.normalScale = new THREE.Vector2(scale, scale)
  }
  const floor = new THREE.MeshStandardMaterial({
    color: opts.floorColor ?? 0xf0ede5,
    roughness: 1,
    metalness: 0,
    transparent,
    opacity: transparent ? opacity * 0.7 : 1,
    depthWrite: !transparent,
    side: THREE.DoubleSide,
  })
  if (opts.floorNormalMap) {
    floor.normalMap = opts.floorNormalMap
    const scale = opts.floorNormalScale ?? 0.25
    floor.normalScale = new THREE.Vector2(scale, scale)
  }
  const edge = new THREE.LineBasicMaterial({
    color: opts.edgeColor ?? 0x9a958a,
    transparent: true,
    opacity: transparent ? 0.45 : 0.5,
  })
  return { wall, floor, edge }
}

/**
 * 按墙段构建带门洞的墙体：每段沿墙方向切成墙垛 + 过梁，
 * 转角用方柱补齐段与段之间的缺口。
 */
function buildWallsWithOpenings(
  pts: Pt[],
  thickness: number,
  height: number,
  openings: MassingOpening[],
  wallMat: THREE.Material,
  edgeMat: THREE.Material,
  withEdges: boolean,
  castShadow: boolean,
): THREE.Group {
  const group = new THREE.Group()
  group.name = 'walls'

  const addBlock = (
    origin: Pt,
    ux: number,
    uz: number,
    nx: number,
    nz: number,
    rotation: number,
    u0: number,
    u1: number,
    y0: number,
    y1: number,
  ) => {
    const len = u1 - u0
    const h = y1 - y0
    if (len < 0.02 || h < 0.02) return

    const geo = new THREE.BoxGeometry(len, h, thickness)
    const cu = (u0 + u1) / 2
    const mesh = new THREE.Mesh(geo, wallMat)
    mesh.name = 'wall'
    mesh.position.set(
      origin.x + ux * cu + nx * (thickness / 2),
      y0 + h / 2,
      origin.z + uz * cu + nz * (thickness / 2),
    )
    mesh.rotation.y = rotation
    mesh.castShadow = castShadow
    mesh.receiveShadow = true
    group.add(mesh)

    if (withEdges) {
      const line = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), edgeMat)
      line.position.copy(mesh.position)
      line.rotation.y = rotation
      group.add(line)
    }
  }

  const n = pts.length
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len = Math.hypot(dx, dz)
    if (len < 1e-4) continue

    const ux = dx / len
    const uz = dz / len
    // CCW 多边形，内侧在左法线方向
    const nx = -uz
    const nz = ux
    const rotation = Math.atan2(-uz, ux)

    const cuts: { u0: number; u1: number; h: number }[] = []
    for (const o of openings) {
      const ox = o.x - a.x
      const oz = o.z - a.z
      const u = ox * ux + oz * uz
      const dist = Math.abs(ox * nx + oz * nz)
      if (dist > thickness + 0.4) continue
      const u0 = Math.max(0, u - o.width / 2)
      const u1 = Math.min(len, u + o.width / 2)
      if (u1 - u0 < 0.2) continue
      cuts.push({ u0, u1, h: Math.min(height - 0.05, Math.max(0.6, o.height)) })
    }
    cuts.sort((p, q) => p.u0 - q.u0)

    let cursor = 0
    for (const cut of cuts) {
      if (cut.u0 > cursor + 0.02) addBlock(a, ux, uz, nx, nz, rotation, cursor, cut.u0, 0, height)
      if (cut.h < height - 0.02) {
        addBlock(a, ux, uz, nx, nz, rotation, cut.u0, cut.u1, cut.h, height)
      }
      cursor = Math.max(cursor, cut.u1)
    }
    if (cursor < len - 0.02) {
      addBlock(a, ux, uz, nx, nz, rotation, cursor, len, 0, height)
    }
  }

  // 转角柱：填补相邻墙段在顶点处的缺口
  for (const p of pts) {
    const geo = new THREE.BoxGeometry(thickness, height, thickness)
    const mesh = new THREE.Mesh(geo, wallMat)
    mesh.name = 'wall-corner'
    mesh.position.set(p.x, height / 2, p.z)
    mesh.castShadow = castShadow
    mesh.receiveShadow = true
    group.add(mesh)

    if (withEdges) {
      const line = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), edgeMat)
      line.position.copy(mesh.position)
      group.add(line)
    }
  }

  return group
}

/**
 * 场馆白膜：地面板 + 一圈有厚度的墙体，顶部敞开，便于观察内部
 */
export function buildMassing(points: Pt[], opts: MassingOptions): THREE.Group {
  const group = new THREE.Group()
  if (points.length < 3) return group

  const pts = ccw(points)
  const height = Math.max(0.2, opts.height)
  const transparent = opts.transparent ?? false
  const { wall, floor, edge } = mats(opts, transparent, opts.opacity ?? 1)

  const openings = (opts.openings ?? []).filter((o) => o.width > 0.2 && o.height > 0.2)
  let wallGeo: THREE.BufferGeometry | null = null
  if (openings.length) {
    group.add(
      buildWallsWithOpenings(
        pts,
        opts.thickness,
        height,
        openings,
        wall,
        edge,
        opts.edges !== false,
        !transparent,
      ),
    )
  } else {
    wallGeo = extrudeBetween(ringShape(pts, opts.thickness), 0, height)
    const walls = new THREE.Mesh(wallGeo, wall)
    walls.castShadow = !transparent
    walls.receiveShadow = true
    walls.name = 'walls'
    group.add(walls)
  }

  group.add(floorMesh(pts, floor))

  let capGeo: THREE.BufferGeometry | null = null
  if (opts.ceiling) {
    const capT = Math.min(0.16, height * 0.3)
    capGeo = extrudeBetween(new THREE.Shape(toShapePoints(pts)), height - capT, height)
    const cap = new THREE.Mesh(capGeo, wall)
    cap.castShadow = !transparent
    cap.receiveShadow = true
    cap.name = 'ceiling'
    group.add(cap)
  }

  if (opts.edges !== false) {
    if (wallGeo) {
      group.add(new THREE.LineSegments(new THREE.EdgesGeometry(wallGeo, 24), edge))
    }
    if (capGeo) {
      group.add(new THREE.LineSegments(new THREE.EdgesGeometry(capGeo, 24), edge))
    }
  }

  group.userData = { height, area: Math.abs(signedArea(pts)) }
  return group
}

/**
 * 展台白膜：顶面可闭合或去除；下部为四周空心围挡，每面居中留 2m 漫游入口。
 * 去除顶部时立柱一并隐藏，仅保留围挡。
 */
export function buildBooth(points: Pt[], opts: MassingOptions): THREE.Group {
  const group = new THREE.Group()
  if (points.length < 3) return group

  const pts = ccw(points)
  const height = Math.max(0.3, opts.height)
  const transparent = opts.transparent ?? false
  const noTop = opts.noTop === true
  const { wall, edge } = mats(opts, transparent, opts.opacity ?? 1)

  const topT = Math.min(BOOTH_TOP, height * 0.4)
  const skirtH = noTop
    ? Math.min(BOOTH_SKIRT, Math.max(0.06, height))
    : Math.min(BOOTH_SKIRT, Math.max(0.06, height - topT))
  const postH = height - topT
  const postKeys = new Set<string>()

  /** 立柱统一从地面到顶板底，截面与围挡同厚；去掉顶部时立柱一并隐藏 */
  const addPost = (x: number, z: number) => {
    if (noTop || opts.columns === false || postH <= 0.04) return
    const key = `${x.toFixed(3)},${z.toFixed(3)}`
    if (postKeys.has(key)) return
    postKeys.add(key)

    const postGeo = new THREE.BoxGeometry(POST, postH, POST)
    scaleBoxUv(postGeo, POST, postH)
    const post = new THREE.Mesh(postGeo, wall)
    post.position.set(x, postH / 2, z)
    post.castShadow = !transparent
    post.receiveShadow = true
    post.name = 'post'
    group.add(post)
  }

  // 转角立柱：沿内角平分线内收，完全落在展台轮廓内
  for (const c of corners(pts)) {
    const n1x = -c.dz
    const n1z = c.dx
    const n2x = -c.ez
    const n2z = c.ex
    let mx = n1x + n2x
    let mz = n1z + n2z
    const ml = Math.hypot(mx, mz)
    if (ml < 1e-6) continue
    mx /= ml
    mz /= ml

    const cosTheta = Math.max(-1, Math.min(1, c.dx * c.ex + c.dz * c.ez))
    const sinHalf = Math.sin(Math.acos(cosTheta) / 2)
    const inset = sinHalf > 0.2 ? POST / 2 / sinHalf : POST / 2
    addPost(c.x + mx * inset, c.z + mz * inset)
  }

  // 下部围挡：沿每面居中留 2m 缺口，中间保持空心，可步行进入
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len = Math.hypot(dx, dz)
    if (len < 0.1) continue

    const gap = boothGapLength(len)
    const gapStart = (len - gap) / 2
    const gapEnd = (len + gap) / 2
    const segments: [number, number][] = [
      [0, gapStart],
      [gapEnd, len],
    ]
    const ux = dx / len
    const uz = dz / len
    for (const [s0, s1] of segments) {
      const segLen = s1 - s0
      if (segLen < 0.04) continue
      const mid = (s0 + s1) / 2
      const panelGeo = new THREE.BoxGeometry(segLen, skirtH, BOOTH_WALL)
      scaleBoxUv(panelGeo, segLen, skirtH)
      const panel = new THREE.Mesh(panelGeo, wall)
      panel.position.set(a.x + ux * mid, skirtH / 2, a.z + uz * mid)
      panel.rotation.y = -Math.atan2(dz, dx)
      panel.castShadow = !transparent
      panel.receiveShadow = true
      panel.name = 'skirt-panel'
      group.add(panel)
    }

    // 开口两侧立柱
    addPost(a.x + ux * gapStart, a.z + uz * gapStart)
    addPost(a.x + ux * gapEnd, a.z + uz * gapEnd)
  }

  // 闭合顶板：独立材质，摆放家具时可单独切换为半透明
  if (!noTop) {
    const topGeo = extrudeBetween(new THREE.Shape(toShapePoints(pts)), height - topT, height)
    const topMat = wall.clone()
    const top = new THREE.Mesh(topGeo, topMat)
    top.castShadow = !transparent
    top.receiveShadow = true
    top.name = 'top'
    group.add(top)

    if (opts.edges !== false) {
      group.add(new THREE.LineSegments(new THREE.EdgesGeometry(topGeo, 24), edge))
    }
  }

  group.userData = { height, area: Math.abs(signedArea(pts)) }
  return group
}

/**
 * 脚手架展台：底部为微微凸起的台板，上部架空；
 * 四角立柱 + 顶部一圈横梁，顶棚可选。
 */
export function buildScaffoldBooth(points: Pt[], opts: MassingOptions): THREE.Group {
  const group = new THREE.Group()
  if (points.length < 3) return group

  const pts = ccw(points)
  const height = Math.max(0.6, opts.height)
  const transparent = opts.transparent ?? false
  const { wall, floor, edge } = mats(opts, transparent, opts.opacity ?? 1)
  const canopy = opts.canopy !== false
  const topT = canopy ? Math.min(0.12, height * 0.22) : 0
  // 加粗立柱 / 横梁，避免远看像细线
  const postT = Math.min(0.28, Math.max(0.18, height * 0.05))
  const beamT = Math.min(0.2, Math.max(0.12, height * 0.035))
  const postTop = Math.max(0.2, height - topT)
  const baseH = Math.min(OPEN_FLOOR_HEIGHT, Math.max(0.06, height * 0.25))
  const castShadow = !transparent

  // 立柱 / 横梁使用单独的金属材质与拉丝法线；台板、顶棚仍用板材材质
  const frame =
    opts.metalNormalMap && !transparent
      ? (() => {
          const mat = new THREE.MeshStandardMaterial({
            color: opts.wallColor ?? 0xc7cbd0,
            roughness: opts.metalRoughness ?? 0.55,
            metalness: opts.metalMetalness ?? 0.22,
          })
          mat.normalMap = opts.metalNormalMap
          const scale = opts.metalNormalScale ?? 1
          mat.normalScale = new THREE.Vector2(scale, scale)
          return mat
        })()
      : wall

  const addBox = (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    rotY: number,
    name: string,
    mat: THREE.Material = wall,
  ) => {
    if (w < 0.02 || h < 0.02 || d < 0.02) return
    const geo = new THREE.BoxGeometry(w, h, d)
    scaleBoxUv(geo, w, h)
    const mesh = new THREE.Mesh(geo, mat)
    mesh.name = name
    mesh.position.set(x, y, z)
    mesh.rotation.y = rotY
    mesh.castShadow = castShadow
    mesh.receiveShadow = true
    group.add(mesh)

    if (opts.edges !== false) {
      const line = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), edge)
      line.position.copy(mesh.position)
      line.rotation.y = rotY
      group.add(line)
    }
  }

  // 底部微凸台板：上部仍为架空结构
  const baseGeo = extrudeBetween(new THREE.Shape(toShapePoints(pts)), 0, baseH)
  const baseSlab = new THREE.Mesh(baseGeo, wall)
  baseSlab.name = 'scaffold-base'
  baseSlab.castShadow = castShadow
  baseSlab.receiveShadow = true
  group.add(baseSlab)

  const baseTopGeo = new THREE.ShapeGeometry(new THREE.Shape(toShapePoints(pts)))
  baseTopGeo.rotateX(-Math.PI / 2)
  const baseTop = new THREE.Mesh(baseTopGeo, floor)
  baseTop.name = 'scaffold-base-top'
  baseTop.position.y = baseH + 0.004
  baseTop.receiveShadow = true
  group.add(baseTop)

  if (opts.edges !== false) {
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo, 24), edge))
  }

  // 按面积估算柱距：目标约 10 个柱跨，避免大展台柱网过密
  const area = Math.abs(signedArea(pts))
  const spacing = Math.min(10, Math.max(4, Math.sqrt(area / 10)))
  const postH = Math.max(0.1, postTop - baseH)
  const postPositions: Pt[] = []
  const postKeys = new Set<string>()

  const addPost = (x: number, z: number) => {
    const key = `${x.toFixed(2)},${z.toFixed(2)}`
    if (postKeys.has(key)) return
    // 边界采样与内部网格可能靠近，避免重复立柱
    if (postPositions.some((p) => Math.hypot(p.x - x, p.z - z) < postT * 0.7)) return
    postKeys.add(key)
    postPositions.push({ x, z })
    addBox(postT, postH, postT, x, baseH + postH / 2, z, 0, 'scaffold-post', frame)
  }

  const beamKeys = new Set<string>()
  const addBeam = (a: Pt, b: Pt) => {
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len = Math.hypot(dx, dz)
    if (len < 0.1) return
    const ka = `${a.x.toFixed(2)},${a.z.toFixed(2)}`
    const kb = `${b.x.toFixed(2)},${b.z.toFixed(2)}`
    const beamKey = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
    if (beamKeys.has(beamKey)) return
    beamKeys.add(beamKey)
    addBox(
      len,
      beamT,
      beamT,
      (a.x + b.x) / 2,
      postTop - beamT / 2,
      (a.z + b.z) / 2,
      -Math.atan2(dz, dx),
      'scaffold-beam',
      frame,
    )
  }

  // 沿轮廓按柱距布置边界柱，并连接成一圈顶部边梁
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len = Math.hypot(dx, dz)
    if (len < 0.1) continue
    const count = Math.max(1, Math.ceil(len / spacing))
    let prev: Pt | null = null
    for (let j = 0; j <= count; j++) {
      const t = j / count
      const p = { x: a.x + dx * t, z: a.z + dz * t }
      addPost(p.x, p.z)
      if (prev) addBeam(prev, p)
      prev = p
    }
  }

  // 用边界柱的坐标作为网格线，内部柱网才能和外围边梁对齐
  const uniqueSorted = (values: number[]) => {
    const out: number[] = []
    for (const v of [...values].sort((a, b) => a - b)) {
      if (!out.length || Math.abs(out[out.length - 1] - v) > 0.01) out.push(v)
    }
    return out
  }
  const xLines = uniqueSorted(postPositions.map((p) => p.x))
  const zLines = uniqueSorted(postPositions.map((p) => p.z))
  const inner = insetPolygon(pts, postT / 2 + 0.15) ?? pts

  for (const x of xLines) {
    for (const z of zLines) {
      if (!pointInPolygon({ x, z }, inner)) continue
      addPost(x, z)
    }
  }

  // 所有柱（含边界柱）按 x / z 分组，连接成贯通的双向顶部桁架
  const key = (v: number) => v.toFixed(2)
  const rows = new Map<string, Pt[]>()
  const cols = new Map<string, Pt[]>()
  for (const p of postPositions) {
    if (!rows.has(key(p.z))) rows.set(key(p.z), [])
    if (!cols.has(key(p.x))) cols.set(key(p.x), [])
    rows.get(key(p.z))!.push(p)
    cols.get(key(p.x))!.push(p)
  }

  const maxSpan = Math.max(spacing * 1.6, 2.5)
  const connect = (list: Pt[], horizontal: boolean) => {
    list.sort((a, b) => (horizontal ? a.x - b.x : a.z - b.z))
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i]
      const b = list[i + 1]
      if (Math.hypot(b.x - a.x, b.z - a.z) > maxSpan) continue
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }
      if (!pointInPolygon(mid, pts)) continue
      addBeam(a, b)
    }
  }
  for (const row of rows.values()) connect(row, true)
  for (const col of cols.values()) connect(col, false)

  if (canopy) {
    const geo = extrudeBetween(new THREE.Shape(toShapePoints(pts)), height - topT, height)
    const slab = new THREE.Mesh(geo, wall.clone())
    slab.name = 'scaffold-top'
    slab.castShadow = castShadow
    slab.receiveShadow = true
    group.add(slab)
    if (opts.edges !== false) {
      group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 24), edge))
    }
  }

  group.userData = { height, area: Math.abs(signedArea(pts)) }
  return group
}

/**
 * 光地展台：仅微微凸起于地面的台板，没有围挡与顶盖。
 */
export function buildOpenFloorBooth(points: Pt[], opts: MassingOptions): THREE.Group {
  const group = new THREE.Group()
  if (points.length < 3) return group

  const pts = ccw(points)
  const height = Math.min(0.4, Math.max(0.06, opts.height))
  const transparent = opts.transparent ?? false
  const { wall, floor, edge } = mats(opts, transparent, opts.opacity ?? 1)
  const castShadow = !transparent

  const geo = extrudeBetween(new THREE.Shape(toShapePoints(pts)), 0, height)
  const slab = new THREE.Mesh(geo, wall)
  slab.name = 'openfloor-slab'
  slab.castShadow = castShadow
  slab.receiveShadow = true
  group.add(slab)

  const topGeo = new THREE.ShapeGeometry(new THREE.Shape(toShapePoints(pts)))
  topGeo.rotateX(-Math.PI / 2)
  const top = new THREE.Mesh(topGeo, floor)
  top.name = 'openfloor-top'
  top.position.y = height + 0.004
  top.receiveShadow = true
  group.add(top)

  if (opts.edges !== false) {
    group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 24), edge))
  }

  group.userData = { height, area: Math.abs(signedArea(pts)) }
  return group
}

// ---------- 基础设施 ----------

/** 基础设施材质：ghost 为放置预览（半透明蓝调） */
function infraMats(ghost: boolean) {
  const wall = new THREE.MeshStandardMaterial({
    color: ghost ? 0xdbe4ff : 0xf4f0e6,
    roughness: 0.92,
    metalness: 0,
    transparent: ghost,
    opacity: ghost ? 0.5 : 1,
    depthWrite: !ghost,
    side: ghost ? THREE.DoubleSide : THREE.FrontSide,
  })
  const edge = new THREE.LineBasicMaterial({
    color: ghost ? 0x2f5fe0 : 0x8d887b,
    transparent: true,
    opacity: ghost ? 0.8 : 0.55,
  })
  return { wall, edge }
}

// ---------- 家具 ----------

type FurnitureMapKey = 'fabric' | 'graphite' | 'metal'

const furnitureTextureLoader = new THREE.TextureLoader()
const furnitureTextureCache = new Map<FurnitureMapKey, THREE.Texture>()

/** 共享家具贴图：只在首次用到家具时加载，所有家具共用同一份 GPU 纹理 */
function furnitureMap(key: FurnitureMapKey): THREE.Texture {
  const cached = furnitureTextureCache.get(key)
  if (cached) return cached

  const file =
    key === 'fabric'
      ? 'fabric-light-grey.jpg'
      : key === 'graphite'
        ? 'fabric-graphite.jpg'
        : 'metal-satin-grey.jpg'
  const texture = furnitureTextureLoader.load(
    `${import.meta.env.BASE_URL}textures/furniture/${file}`,
  )
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 4
  texture.needsUpdate = true
  furnitureTextureCache.set(key, texture)
  return texture
}

/**
 * 家具材质：软包 / 深色点缀 / 金属框架。
 * ghost 预览保持原来的半透明蓝调，不贴图。
 */
function furnitureMats(ghost: boolean) {
  const { wall, edge } = infraMats(ghost)
  if (ghost) {
    return { wall, edge, fabric: wall, fabricDark: wall, metal: wall }
  }

  const fabric = new THREE.MeshStandardMaterial({
    map: furnitureMap('fabric'),
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0,
  })
  const fabricDark = new THREE.MeshStandardMaterial({
    map: furnitureMap('graphite'),
    color: 0xffffff,
    roughness: 0.8,
    metalness: 0.04,
  })
  const metal = new THREE.MeshStandardMaterial({
    map: furnitureMap('metal'),
    color: 0xffffff,
    // 无环境贴图时高 metalness 会显黑，这里按喷砂钛灰处理
    roughness: 0.55,
    metalness: 0.12,
  })
  return { wall, edge, fabric, fabricDark, metal }
}

/** 家具通用盒体：带描边，ghost 预览不投影 */
function furnitureBox(
  group: THREE.Group,
  wall: THREE.Material,
  edge: THREE.LineBasicMaterial,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  rotX: number,
  name: string,
) {
  if (w < 0.01 || h < 0.01 || d < 0.01) return
  const geo = new THREE.BoxGeometry(w, h, d)
  const mesh = new THREE.Mesh(geo, wall)
  mesh.name = name
  mesh.position.set(x, y, z)
  mesh.rotation.x = rotX
  mesh.castShadow = !(wall as THREE.MeshStandardMaterial).transparent
  mesh.receiveShadow = true
  group.add(mesh)

  const line = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), edge)
  line.position.copy(mesh.position)
  line.rotation.x = rotX
  group.add(line)
  return mesh
}

/** 家具通用圆柱：带描边，ghost 预览不投影 */
function furnitureCylinder(
  group: THREE.Group,
  wall: THREE.Material,
  edge: THREE.LineBasicMaterial,
  rTop: number,
  rBottom: number,
  h: number,
  y: number,
  segments: number,
  name: string,
) {
  if (h < 0.01) return null
  const geo = new THREE.CylinderGeometry(rTop, rBottom, h, segments)
  const mesh = new THREE.Mesh(geo, wall)
  mesh.name = name
  mesh.position.y = y
  mesh.castShadow = !(wall as THREE.MeshStandardMaterial).transparent
  mesh.receiveShadow = true
  group.add(mesh)

  const line = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 24), edge)
  line.position.y = y
  group.add(line)
  return mesh
}

/** 圆座椅：细圆柱支撑 + 更宽的圆盘底座，外形尺寸 0.6 × 0.6 × 0.5m */
function chairGroup(width: number, depth: number, height: number, ghost: boolean): THREE.Group {
  const group = new THREE.Group()
  const { edge, fabric, metal } = furnitureMats(ghost)
  const h = Math.max(0.3, height)
  const radius = Math.max(0.3, Math.min(width, depth) / 2)
  const seatT = Math.min(0.1, h * 0.08)
  const seatR = Math.max(0.22, radius * 0.9)
  const baseH = Math.min(0.07, h * 0.06)
  const baseR = Math.max(0.18, radius * 0.62)
  const stemR = Math.max(0.04, radius * 0.085)
  const stemTop = h - seatT

  furnitureCylinder(group, metal, edge, baseR, baseR * 1.05, baseH, baseH / 2, 28, 'chair-base')
  furnitureCylinder(
    group,
    metal,
    edge,
    stemR,
    stemR * 1.1,
    Math.max(0.1, stemTop - baseH),
    baseH + (stemTop - baseH) / 2,
    16,
    'chair-stem',
  )
  furnitureCylinder(group, fabric, edge, seatR, seatR * 0.94, seatT, h - seatT / 2, 32, 'chair-seat')
  return group
}

/** 扶手椅：方形座面 + 四条腿 + 略微后仰的靠背 + 两侧扶手，1 × 1 × 1.0m（座高 0.5m） */
function armchairGroup(width: number, depth: number, height: number, ghost: boolean): THREE.Group {
  const group = new THREE.Group()
  const { edge, fabric, fabricDark, metal } = furnitureMats(ghost)
  const w = Math.max(0.6, width)
  const d = Math.max(0.6, depth)
  const h = Math.max(0.7, height)
  const seatT = Math.min(0.16, h * 0.12)
  // 座面高度固定 0.5m，靠背继续升高到整体高度
  const seatTop = Math.min(h - 0.3, Math.max(seatT + 0.1, 0.5))
  const legH = Math.max(0.1, seatTop - seatT)
  const inset = Math.min(0.1, w * 0.1)
  const legT = Math.min(0.08, w * 0.08)
  const backT = Math.min(0.12, d * 0.14)
  const backH = Math.max(0.3, h - seatTop)
  const armT = Math.min(0.1, w * 0.1)
  const armH = Math.min(0.14, h * 0.12)

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      furnitureBox(
        group,
        metal,
        edge,
        legT,
        legH,
        legT,
        sx * (w / 2 - inset - legT / 2),
        legH / 2,
        sz * (d / 2 - inset - legT / 2),
        0,
        'armchair-leg',
      )
    }
  }

  furnitureBox(
    group,
    fabric,
    edge,
    w - inset * 2,
    seatT,
    d - inset * 2,
    0,
    legH + seatT / 2,
    0,
    0,
    'armchair-seat',
  )

  furnitureBox(
    group,
    fabricDark,
    edge,
    w - inset * 2,
    backH,
    backT,
    0,
    seatTop + backH / 2,
    -d / 2 + backT / 2 + inset * 0.4,
    -0.07,
    'armchair-back',
  )

  for (const sx of [-1, 1]) {
    furnitureBox(
      group,
      fabric,
      edge,
      armT,
      armH,
      d - inset - 0.04,
      sx * (w / 2 - armT / 2),
      seatTop + armH / 2 - 0.02,
      0,
      0,
      'armchair-arm',
    )
  }

  return group
}

/** 沙发：可自定义长宽，靠背顶到 1.2m */
function sofaGroup(width: number, depth: number, height: number, ghost: boolean): THREE.Group {
  const group = new THREE.Group()
  const { edge, fabric, fabricDark } = furnitureMats(ghost)
  const w = Math.max(0.8, width)
  const d = Math.max(0.5, depth)
  const h = Math.max(0.6, height)
  const baseH = Math.min(0.3, h * 0.3)
  const seatT = Math.min(0.16, h * 0.14)
  const backT = Math.min(0.2, d * 0.22)
  const armT = Math.min(0.2, Math.max(0.12, w * 0.11))
  const armH = Math.min(0.34, h * 0.3)

  furnitureBox(group, fabric, edge, w, baseH, d, 0, baseH / 2, 0, 0, 'sofa-base')

  const backH = Math.max(0.3, h - baseH)
  furnitureBox(
    group,
    fabricDark,
    edge,
    w,
    backH,
    backT,
    0,
    baseH + backH / 2,
    -d / 2 + backT / 2,
    -0.04,
    'sofa-back',
  )

  for (const sx of [-1, 1]) {
    furnitureBox(
      group,
      fabric,
      edge,
      armT,
      armH,
      d,
      sx * (w / 2 - armT / 2),
      baseH + armH / 2,
      0,
      0,
      'sofa-arm',
    )
  }

  const innerW = Math.max(0.3, w - armT * 2 - 0.04)
  const cushionD = Math.max(0.2, d - backT - 0.04)
  const count = innerW > 1.5 ? 3 : 2
  const gap = 0.03
  const cushionW = Math.max(0.1, (innerW - gap * (count - 1)) / count)
  for (let i = 0; i < count; i++) {
    const x = -innerW / 2 + cushionW / 2 + i * (cushionW + gap)
    furnitureBox(
      group,
      fabric,
      edge,
      cushionW,
      seatT,
      cushionD,
      x,
      baseH + seatT / 2,
      (backT - 0.04) / 2,
      0,
      'sofa-cushion',
    )
  }

  return group
}

/** 圆茶几：椭圆台面 + 中柱 + 圆盘底座，高度固定 1m */
function tableRoundGroup(width: number, depth: number, height: number, ghost: boolean): THREE.Group {
  const group = new THREE.Group()
  const { edge, fabricDark, metal } = furnitureMats(ghost)
  const w = Math.max(0.4, width)
  const d = Math.max(0.4, depth)
  const h = Math.max(0.5, height)
  const topT = Math.min(0.06, h * 0.08)
  const baseH = Math.min(0.05, h * 0.05)
  const baseR = Math.max(0.14, Math.min(w, d) * 0.3)
  const stemR = Math.max(0.04, Math.min(w, d) * 0.06)
  const stemH = Math.max(0.1, h - topT - baseH)

  furnitureCylinder(group, metal, edge, baseR, baseR * 1.05, baseH, baseH / 2, 28, 'table-base')
  furnitureCylinder(
    group,
    metal,
    edge,
    stemR,
    stemR,
    stemH,
    baseH + stemH / 2,
    16,
    'table-stem',
  )

  const topGeo = new THREE.CylinderGeometry(1, 1, topT, 40)
  const top = new THREE.Mesh(topGeo, fabricDark)
  top.name = 'table-top'
  top.scale.set(w / 2, 1, d / 2)
  top.position.y = h - topT / 2
  top.castShadow = !(fabricDark as THREE.MeshStandardMaterial).transparent
  top.receiveShadow = true
  group.add(top)

  const line = new THREE.LineSegments(new THREE.EdgesGeometry(topGeo, 24), edge)
  top.add(line)
  return group
}

/** 方茶几：方形台面 + 四条腿，高度固定 0.5m */
function tableSquareGroup(width: number, depth: number, height: number, ghost: boolean): THREE.Group {
  const group = new THREE.Group()
  const { edge, fabricDark, metal } = furnitureMats(ghost)
  const w = Math.max(0.4, width)
  const d = Math.max(0.4, depth)
  const h = Math.max(0.3, height)
  const topT = Math.min(0.06, h * 0.08)
  const legT = Math.min(0.08, Math.min(w, d) * 0.1)
  const inset = Math.min(0.1, Math.min(w, d) * 0.12)
  const legH = Math.max(0.1, h - topT)

  furnitureBox(group, fabricDark, edge, w, topT, d, 0, h - topT / 2, 0, 0, 'table-top')

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      furnitureBox(
        group,
        metal,
        edge,
        legT,
        legH,
        legT,
        sx * (w / 2 - inset - legT / 2),
        legH / 2,
        sz * (d / 2 - inset - legT / 2),
        0,
        'table-leg',
      )
    }
  }

  if (h > 0.7) {
    furnitureBox(
      group,
      metal,
      edge,
      Math.max(0.2, w * 0.74),
      0.04,
      Math.max(0.2, d * 0.74),
      0,
      Math.min(0.32, legH * 0.45),
      0,
      0,
      'table-shelf',
    )
  }

  return group
}

/** 半截楼梯：实心阶梯剖面沿宽度挤出，从地面升至设定高度后截断 */
function stairsGroup(width: number, depth: number, height: number, ghost: boolean): THREE.Group {
  const group = new THREE.Group()
  const w = Math.max(0.4, width)
  const d = Math.max(0.8, depth)
  const h = Math.max(0.2, height)
  const steps = Math.max(3, Math.min(24, Math.round(h / 0.18)))
  const rise = h / steps
  const run = d / steps

  // 侧剖面：地面 → 每级踏面 → 踢面 → 顶部 → 背面回到地面
  const shape = new THREE.Shape()
  shape.moveTo(-d / 2, 0)
  for (let i = 0; i < steps; i++) {
    const z = -d / 2 + run * (i + 1)
    shape.lineTo(z, rise * i)
    shape.lineTo(z, rise * (i + 1))
  }
  shape.lineTo(d / 2, 0)
  shape.closePath()

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: w,
    bevelEnabled: false,
    steps: 1,
    curveSegments: 1,
  })
  // 剖面 x 映射到世界 z，挤出方向映射到世界 x 并居中
  geo.rotateY(-Math.PI / 2)
  geo.translate(w / 2, 0, 0)
  geo.computeVertexNormals()

  const { wall, edge } = infraMats(ghost)
  const mesh = new THREE.Mesh(geo, wall)
  mesh.name = 'stairs'
  mesh.castShadow = !ghost
  mesh.receiveShadow = true
  group.add(mesh)
  group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), edge))
  return group
}

let wcSignTexture: THREE.Texture | null = null

/** 洗手间门牌纹理：蓝底白字，单例复用 */
function wcSignMap(): THREE.Texture {
  if (wcSignTexture) return wcSignTexture
  const canvas = document.createElement('canvas')
  canvas.width = 160
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#2f5fe0'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#ffffff'
    ctx.font = '600 58px Inter, "PingFang SC", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('WC', canvas.width / 2, canvas.height / 2 + 2)
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  wcSignTexture = tex
  return tex
}

/** 洗手间：封闭体块 + 深色门扇 + 门右上侧门牌 */
function restroomGroup(width: number, depth: number, height: number, ghost: boolean): THREE.Group {
  const group = new THREE.Group()
  const w = Math.max(0.8, width)
  const d = Math.max(0.8, depth)
  const h = Math.max(1.2, height)
  const { wall, edge } = infraMats(ghost)

  const bodyGeo = new THREE.BoxGeometry(w, h, d)
  const body = new THREE.Mesh(bodyGeo, wall)
  body.name = 'restroom'
  body.position.y = h / 2
  body.castShadow = !ghost
  body.receiveShadow = true
  group.add(body)

  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeo, 20), edge)
  edges.position.copy(body.position)
  group.add(edges)

  const doorW = Math.min(0.9, Math.max(0.5, w * 0.55))
  const doorH = Math.max(0.8, Math.min(2, h - 0.4))
  const doorMat = new THREE.MeshStandardMaterial({
    color: ghost ? 0x2f5fe0 : 0x5d626b,
    roughness: 0.9,
    metalness: 0,
    transparent: ghost,
    opacity: ghost ? 0.55 : 1,
  })
  const door = new THREE.Mesh(new THREE.PlaneGeometry(doorW, doorH), doorMat)
  door.name = 'door'
  door.position.set(0, doorH / 2, d / 2 + 0.008)
  group.add(door)

  // 门牌：贴在门洞右上方
  const signW = Math.min(0.34, Math.max(0.2, w * 0.12))
  const signH = signW * 0.8
  const signX = Math.min(w / 2 - signW / 2 - 0.05, doorW / 2 + 0.14 + signW / 2)
  const signY = Math.min(h - signH / 2 - 0.06, doorH + 0.1 + signH / 2)
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(signW, signH),
    new THREE.MeshBasicMaterial({
      map: wcSignMap(),
      transparent: true,
      opacity: ghost ? 0.6 : 1,
    }),
  )
  sign.name = 'wc-sign'
  sign.position.set(signX, Math.max(signH / 2 + 0.1, signY), d / 2 + 0.014)
  group.add(sign)
  return group
}

/** 展馆出入口：嵌在墙上的门框 + 可开合的双开门扇 */
function gateGroup(
  width: number,
  height: number,
  depth: number,
  ghost: boolean,
  open: boolean,
): THREE.Group {
  const group = new THREE.Group()
  const w = Math.max(0.8, width)
  const h = Math.max(0.8, height)
  const d = Math.max(0.3, depth)
  const { wall, edge } = infraMats(ghost)
  const postT = Math.min(0.24, Math.max(0.1, w * 0.06))
  const beamT = Math.min(0.24, Math.max(0.12, h * 0.06))

  const postGeo = new THREE.BoxGeometry(postT, h, d)
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, wall)
    post.name = 'gate-post'
    post.position.set(side * (w / 2 - postT / 2), h / 2, 0)
    post.castShadow = !ghost
    post.receiveShadow = true
    group.add(post)

    const postEdges = new THREE.LineSegments(new THREE.EdgesGeometry(postGeo, 20), edge)
    postEdges.position.copy(post.position)
    group.add(postEdges)
  }

  const beamGeo = new THREE.BoxGeometry(w, beamT, d)
  const beam = new THREE.Mesh(beamGeo, wall)
  beam.name = 'gate-beam'
  beam.position.y = h - beamT / 2
  beam.castShadow = !ghost
  beam.receiveShadow = true
  group.add(beam)

  const beamEdges = new THREE.LineSegments(new THREE.EdgesGeometry(beamGeo, 20), edge)
  beamEdges.position.copy(beam.position)
  group.add(beamEdges)

  const openingW = Math.max(0.1, w - postT * 2)
  const openingH = Math.max(0.1, h - beamT)
  const leafW = openingW / 2
  const leafT = Math.min(0.08, Math.max(0.04, d * 0.12))
  const leafMat = new THREE.MeshStandardMaterial({
    color: ghost ? 0x2f5fe0 : 0x7d8794,
    roughness: 0.6,
    metalness: 0.08,
    transparent: ghost,
    opacity: ghost ? 0.45 : 0.95,
    side: THREE.DoubleSide,
  })

  // 双开门：关闭时闭合，打开时绕两侧铰链向 +Z 展开
  const leaves = [
    { hingeX: -openingW / 2, dir: 1, angle: open ? -1.78 : 0 },
    { hingeX: openingW / 2, dir: -1, angle: open ? 1.78 : 0 },
  ]
  for (const leaf of leaves) {
    const hinge = new THREE.Group()
    hinge.name = 'gate-leaf'
    hinge.position.set(leaf.hingeX, 0, 0)
    hinge.rotation.y = leaf.angle

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(leafW, openingH, leafT), leafMat)
    mesh.name = 'gate-leaf-panel'
    mesh.position.set((leaf.dir * leafW) / 2, openingH / 2, 0)
    mesh.castShadow = !ghost
    mesh.receiveShadow = true
    hinge.add(mesh)
    group.add(hinge)
  }
  return group
}

/** 电梯间：封闭体块 + 正面等距排列的电梯门 */
function elevatorGroup(
  width: number,
  depth: number,
  height: number,
  count: number,
  ghost: boolean,
): THREE.Group {
  const group = new THREE.Group()
  const w = Math.max(1.6, width)
  const d = Math.max(1.4, depth)
  const h = Math.max(2, height)
  const n = Math.max(1, Math.min(6, Math.round(count)))
  const { wall, edge } = infraMats(ghost)

  const bodyGeo = new THREE.BoxGeometry(w, h, d)
  const body = new THREE.Mesh(bodyGeo, wall)
  body.name = 'elevator'
  body.position.y = h / 2
  body.castShadow = !ghost
  body.receiveShadow = true
  group.add(body)

  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(bodyGeo, 20), edge)
  edges.position.copy(body.position)
  group.add(edges)

  const slot = w / n
  const doorW = Math.min(1.05, slot * 0.7)
  const doorH = Math.min(2.2, h - 0.35)
  const doorMat = new THREE.MeshStandardMaterial({
    color: ghost ? 0x2f5fe0 : 0x66707e,
    roughness: 0.55,
    metalness: 0.15,
    transparent: ghost,
    opacity: ghost ? 0.45 : 1,
  })
  const seamMat = new THREE.LineBasicMaterial({
    color: ghost ? 0x2f5fe0 : 0x2f3540,
    transparent: true,
    opacity: 0.6,
  })

  for (let i = 0; i < n; i++) {
    const x = -w / 2 + slot * (i + 0.5)
    const door = new THREE.Mesh(new THREE.PlaneGeometry(doorW, doorH), doorMat)
    door.name = 'elevator-door'
    door.position.set(x, doorH / 2, d / 2 + 0.008)
    group.add(door)

    const seam = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, 0.08, d / 2 + 0.012),
        new THREE.Vector3(x, doorH - 0.06, d / 2 + 0.012),
      ]),
      seamMat,
    )
    group.add(seam)

    const lintel = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x - doorW / 2, doorH, d / 2 + 0.012),
        new THREE.Vector3(x + doorW / 2, doorH, d / 2 + 0.012),
      ]),
      seamMat,
    )
    group.add(lintel)
  }
  return group
}

/** 墙面门洞：u 为沿墙长方向的中心（相对墙中心） */
export interface InfraOpening {
  u: number
  width: number
  height: number
}

/** 墙面：薄墙板，按门洞拆分为墙垛与过梁 */
function wallGroup(
  width: number,
  depth: number,
  height: number,
  openings: InfraOpening[],
  ghost: boolean,
): THREE.Group {
  const group = new THREE.Group()
  const w = Math.max(0.5, width)
  const d = Math.max(0.08, depth)
  const h = Math.max(0.5, height)
  const { wall, edge } = infraMats(ghost)

  const addBlock = (x0: number, x1: number, y0: number, y1: number) => {
    const bw = x1 - x0
    const bh = y1 - y0
    if (bw < 0.02 || bh < 0.02) return

    const geo = new THREE.BoxGeometry(bw, bh, d)
    const mesh = new THREE.Mesh(geo, wall)
    mesh.name = 'wall-panel'
    mesh.position.set((x0 + x1) / 2, y0 + bh / 2, 0)
    mesh.castShadow = !ghost
    mesh.receiveShadow = true
    group.add(mesh)

    const line = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), edge)
    line.position.copy(mesh.position)
    group.add(line)
  }

  const cuts = openings
    .map((o) => ({
      u0: Math.max(-w / 2, o.u - o.width / 2),
      u1: Math.min(w / 2, o.u + o.width / 2),
      h: Math.min(h - 0.05, Math.max(0.2, o.height)),
    }))
    .filter((c) => c.u1 - c.u0 > 0.1)
    .sort((a, b) => a.u0 - b.u0)

  let cursor = -w / 2
  for (const cut of cuts) {
    const u0 = Math.max(cursor, cut.u0)
    const u1 = Math.max(u0, cut.u1)
    if (u0 > cursor + 0.02) addBlock(cursor, u0, 0, h)
    if (u1 > u0 + 0.02) {
      if (cut.h < h - 0.02) addBlock(u0, u1, cut.h, h)
      cursor = u1
    }
  }
  if (cursor < w / 2 - 0.02) addBlock(cursor, w / 2, 0, h)
  return group
}

/** 基础设施体块：位置/朝向在外层统一应用 */
export function buildInfra(
  infra: Infra,
  ghost = false,
  openings: InfraOpening[] = [],
): THREE.Group {
  const { width, depth, height, kind } = infra
  let group: THREE.Group
  switch (kind) {
    case 'stairs':
      group = stairsGroup(width, depth, height, ghost)
      break
    case 'restroom':
      group = restroomGroup(width, depth, height, ghost)
      break
    case 'gate':
      group = gateGroup(width, height, depth, ghost, !!infra.open)
      break
    case 'elevator':
      group = elevatorGroup(width, depth, height, infra.count ?? ELEVATOR_DEFAULT_COUNT, ghost)
      break
    case 'chair':
      group = chairGroup(width, depth, height, ghost)
      break
    case 'armchair':
      group = armchairGroup(width, depth, height, ghost)
      break
    case 'sofa':
      group = sofaGroup(width, depth, height, ghost)
      break
    case 'table-round':
      group = tableRoundGroup(width, depth, height, ghost)
      break
    case 'table-square':
      group = tableSquareGroup(width, depth, height, ghost)
      break
    default:
      group = wallGroup(width, depth, height, openings, ghost)
  }
  group.name = `infra:${infra.id}`
  group.userData = { infraId: infra.id, kind }
  group.position.set(infra.x, 0, infra.z)
  group.rotation.y = infra.rotation
  return group
}
