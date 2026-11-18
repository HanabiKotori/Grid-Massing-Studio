import type { Cell, Row, Workbook, Worksheet } from 'exceljs'
import { BOOTH_KIND_LABELS, boothKindOf } from './booth'
import { INFRA_LABELS, isFurnitureKind } from './infra'
import { materialPresetById } from './materials'
import { pointInPolygon, polygonArea } from './polygon'
import type { Booth, Infra, InfraKind } from './types'

/** 清单导出输入：场馆名 + 展台与已放置的全部设施 */
export interface InventoryInput {
  venueName: string
  booths: Booth[]
  infras: Infra[]
}

export interface InventorySummary {
  fileName: string
  boothCount: number
  furnitureCount: number
}

type ExcelJsModule = typeof import('exceljs')

interface LogoAsset {
  extension: 'png' | 'jpeg'
  /** 单元格内浮动图片的显示尺寸（px） */
  width: number
  height: number
}

const HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F2430' },
} as const
const HEADER_FONT = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } } as const
const TOTAL_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF1F3F7' },
} as const
const CELL_BORDER = {
  top: { style: 'thin', color: { argb: 'FFD8DCE3' } },
  left: { style: 'thin', color: { argb: 'FFD8DCE3' } },
  bottom: { style: 'thin', color: { argb: 'FFD8DCE3' } },
  right: { style: 'thin', color: { argb: 'FFD8DCE3' } },
} as const

const MARK_LABELS: Record<string, string> = { red: '红', yellow: '黄', gray: '灰' }

/** ExcelJS 在浏览器里走 UMD 互操作，导出时才加载，避免拖慢首屏 */
async function loadExcelJs(): Promise<ExcelJsModule> {
  const mod = (await import('exceljs')) as ExcelJsModule & { default?: ExcelJsModule }
  return mod.default ?? mod
}

function formatSize(value: number): string {
  return Number(value.toFixed(2)).toString()
}

function materialLabelOf(item: Infra): string {
  const preset = materialPresetById(item.material)
  if (preset) return preset.label
  if (item.texture) return '自定义贴图'
  return '默认'
}

/** 兼容纯 base64 与旧版 data URL 两种 Logo 存储 */
function logoDataUrl(logo: string | undefined): string | null {
  if (!logo) return null
  const url = logo.startsWith('data:') ? logo : `data:image/png;base64,${logo}`
  return /^data:image\/(?:png|jpe?g);base64,/i.test(url) ? url : null
}

function logoExtension(url: string): 'png' | 'jpeg' {
  return /^data:image\/png/i.test(url) ? 'png' : 'jpeg'
}

function readImageSize(url: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function styleHeaderRow(row: Row) {
  row.height = 22
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL
    cell.font = HEADER_FONT
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
    cell.border = CELL_BORDER
  })
}

function styleBodyRange(sheet: Worksheet, lastRow: number, lastCol: number) {
  for (let r = 2; r <= lastRow; r++) {
    const row = sheet.getRow(r)
    for (let c = 1; c <= lastCol; c++) {
      const cell: Cell = row.getCell(c)
      cell.border = CELL_BORDER
      cell.alignment = { vertical: 'middle', horizontal: 'left' }
    }
  }
}

/** 家具按「展台 + 类型 + 规格 + 材质」合并数量，清单更接近实际下单表 */
interface FurnitureLine {
  boothName: string
  kind: InfraKind
  spec: string
  count: number
  material: string
}

function collectFurnitureLines(booths: Booth[], infras: Infra[]): FurnitureLine[] {
  const lines = new Map<string, FurnitureLine>()

  for (const item of infras) {
    if (!isFurnitureKind(item.kind)) continue
    const host = booths.find((b) => b.points.length >= 3 && pointInPolygon(item, b.points))
    const boothName = host?.name ?? '公共区域'
    const spec = `${formatSize(item.width)} × ${formatSize(item.depth)} × ${formatSize(item.height)}`
    const material = materialLabelOf(item)
    const key = `${host?.id ?? 'public'}|${item.kind}|${spec}|${material}`
    const line = lines.get(key)
    if (line) {
      line.count += 1
    } else {
      lines.set(key, { boothName, kind: item.kind, spec, count: 1, material })
    }
  }

  const kindOrder = new Map<InfraKind, number>(
    Object.keys(INFRA_LABELS).map((kind, index) => [kind as InfraKind, index]),
  )
  const boothOrder = new Map(booths.map((booth, index) => [booth.name, index]))
  return [...lines.values()].sort(
    (a, b) =>
      (boothOrder.get(a.boothName) ?? Number.MAX_SAFE_INTEGER) -
        (boothOrder.get(b.boothName) ?? Number.MAX_SAFE_INTEGER) ||
      (kindOrder.get(a.kind) ?? 0) - (kindOrder.get(b.kind) ?? 0) ||
      a.spec.localeCompare(b.spec),
  )
}

function buildBoothSheet(
  workbook: Workbook,
  booths: Booth[],
  imageIds: Map<string, number>,
  logoAssets: Map<string, LogoAsset>,
) {
  const sheet = workbook.addWorksheet('展位清单', {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  sheet.columns = [
    { header: '编号', key: 'no', width: 20 },
    { header: '名称', key: 'name', width: 20 },
    { header: '类型', key: 'kind', width: 12 },
    { header: '面积(m²)', key: 'area', width: 11 },
    { header: '高度(m)', key: 'height', width: 10 },
    { header: '展商', key: 'exhibitor', width: 26 },
    { header: '标记', key: 'mark', width: 8 },
    { header: 'Logo', key: 'logo', width: 17 },
  ]
  styleHeaderRow(sheet.getRow(1))

  booths.forEach((booth) => {
    const row = sheet.addRow({
      no: booth.name,
      name: booth.name,
      kind: BOOTH_KIND_LABELS[boothKindOf(booth)] ?? '标准',
      area: Number(polygonArea(booth.points).toFixed(1)),
      height: Number(booth.height.toFixed(2)),
      exhibitor: booth.exhibitor ?? '',
      mark: MARK_LABELS[booth.mark ?? (booth.marked ? 'red' : '')] ?? '',
      logo: booth.logo && !logoDataUrl(booth.logo) ? '已上传' : '',
    })
    row.height = 30
    row.getCell(4).numFmt = '0.0'
    row.getCell(5).numFmt = '0.00'
  })

  const lastRow = booths.length + 1
  styleBodyRange(sheet, lastRow, 8)
  sheet.autoFilter = { from: 'A1', to: `H${lastRow}` }

  booths.forEach((booth, index) => {
    const url = logoDataUrl(booth.logo)
    if (!url) return
    const imageId = imageIds.get(url)
    const asset = logoAssets.get(url)
    if (imageId === undefined || !asset) return
    sheet.addImage(imageId, {
      tl: { col: 7.08, row: index + 1 + 0.06 },
      ext: { width: asset.width, height: asset.height },
      editAs: 'oneCell',
    })
  })

  return sheet
}

function buildFurnitureSheet(workbook: Workbook, lines: FurnitureLine[]) {
  const sheet = workbook.addWorksheet('家具清单', {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })

  sheet.columns = [
    { header: '展台编号', key: 'no', width: 20 },
    { header: '展台名称', key: 'name', width: 20 },
    { header: '家具类型', key: 'kind', width: 14 },
    { header: '规格 宽 × 深 × 高 (m)', key: 'spec', width: 24 },
    { header: '数量', key: 'count', width: 9 },
    { header: '材质', key: 'material', width: 18 },
  ]
  styleHeaderRow(sheet.getRow(1))

  if (!lines.length) {
    sheet.mergeCells('A2:F2')
    const cell = sheet.getCell('A2')
    cell.value = '暂无家具，在展台内放置家具后重新导出即可生成清单。'
    cell.font = { italic: true, color: { argb: 'FF8A9099' } }
    cell.alignment = { vertical: 'middle', horizontal: 'left' }
    sheet.getRow(2).height = 24
    return sheet
  }

  lines.forEach((line) => {
    const row = sheet.addRow({
      no: line.boothName,
      name: line.boothName,
      kind: INFRA_LABELS[line.kind],
      spec: line.spec,
      count: line.count,
      material: line.material,
    })
    row.height = 20
    const countCell = row.getCell(5)
    countCell.numFmt = '0'
    countCell.alignment = { vertical: 'middle', horizontal: 'center' }
  })

  const totalCount = lines.reduce((sum, line) => sum + line.count, 0)
  const totalRow = sheet.addRow(['合计', '', '', '', totalCount, ''])
  totalRow.height = 22
  totalRow.font = { bold: true }
  totalRow.fill = TOTAL_FILL
  for (let c = 1; c <= 6; c++) {
    const cell = totalRow.getCell(c)
    cell.border = CELL_BORDER
    cell.alignment = {
      vertical: 'middle',
      horizontal: c === 5 ? 'center' : 'left',
    }
  }
  totalRow.getCell(5).numFmt = '0'

  styleBodyRange(sheet, lines.length + 1, 6)
  sheet.autoFilter = { from: 'A1', to: `F${lines.length + 1}` }

  return sheet
}

/** 生成「展位清单 + 家具清单」双 Sheet 的 XLSX 并触发下载 */
export async function exportInventoryXlsx(input: InventoryInput): Promise<InventorySummary> {
  const ExcelJS = await loadExcelJs()
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'GRID MASSING STUDIO'
  workbook.created = new Date()

  // 同一 Logo 可能被阵列复制到多个展台，按图片去重后并行读取尺寸
  const logoUrls = new Set<string>()
  for (const booth of input.booths) {
    const url = logoDataUrl(booth.logo)
    if (url) logoUrls.add(url)
  }
  const logoAssets = new Map<string, LogoAsset>()
  await Promise.all(
    [...logoUrls].map(async (url) => {
      const size = await readImageSize(url)
      // Logo 统一约束在 96 × 32 的格子内，保持原图比例
      const scale = size ? Math.min(96 / size.width, 32 / size.height) : 0
      logoAssets.set(url, {
        extension: logoExtension(url),
        width: size ? Math.max(12, Math.round(size.width * scale)) : 96,
        height: size ? Math.max(12, Math.round(size.height * scale)) : 32,
      })
    }),
  )

  const imageIds = new Map<string, number>()
  for (const [url, asset] of logoAssets) {
    imageIds.set(
      url,
      workbook.addImage({ base64: url, extension: asset.extension }),
    )
  }

  buildBoothSheet(workbook, input.booths, imageIds, logoAssets)
  const furnitureLines = collectFurnitureLines(input.booths, input.infras)
  buildFurnitureSheet(workbook, furnitureLines)

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([new Uint8Array(buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const fileName = `${(input.venueName || '场馆').replace(/[\\/:*?"<>|]/g, '_')}-清单.xlsx`
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)

  return {
    fileName,
    boothCount: input.booths.length,
    furnitureCount: furnitureLines.reduce((sum, line) => sum + line.count, 0),
  }
}
