/* jsPDF 体积较大，改为按需加载，避免拖慢首屏 */

export interface PlanSheetInput {
  /** 场馆名称 */
  projectName: string
  /** 面积 / 展台数 等摘要 */
  summary: string
  /** 规范校验问题数，0 表示通过 */
  issueCount: number
  /** 汇报图（俯视平面图） */
  imageDataUrl: string
  /** 输出文件名（不含扩展名） */
  fileName: string
}

/** A3 横向，1 mm = 10 px */
const PAGE = { w: 420, h: 297 }
const SCALE = 10
const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif'

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = src
  })
}

/** 品牌标记：深色方块 + G */
function drawBrandMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.fillStyle = '#1a1c20'
  ctx.fillRect(x, y, size, size)
  ctx.fillStyle = '#ffffff'
  ctx.font = `600 ${size * 0.62}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('G', x + size / 2, y + size / 2 + size * 0.03)
}

function drawNorthArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save()
  ctx.strokeStyle = '#1a1c20'
  ctx.fillStyle = '#1a1c20'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()
  // 指针
  ctx.beginPath()
  ctx.moveTo(cx, cy - r * 0.72)
  ctx.lineTo(cx + r * 0.3, cy + r * 0.34)
  ctx.lineTo(cx, cy + r * 0.12)
  ctx.lineTo(cx - r * 0.3, cy + r * 0.34)
  ctx.closePath()
  ctx.fill()
  ctx.font = `600 ${r * 0.5}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('N', cx, cy - r * 1.42)
  ctx.restore()
}

/**
 * 生成 A3 横向平面图纸并下载。
 * 文字与标题栏用 Canvas 绘制（保证中文正常），再整页嵌入 PDF。
 */
export async function downloadPlanPdf(input: PlanSheetInput): Promise<void> {
  const cv = document.createElement('canvas')
  cv.width = PAGE.w * SCALE
  cv.height = PAGE.h * SCALE
  const ctx = cv.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')

  // 纸张
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, cv.width, cv.height)

  // 图框
  ctx.strokeStyle = '#1a1c20'
  ctx.lineWidth = 5
  ctx.strokeRect(58, 58, cv.width - 116, cv.height - 116)

  // 平面图
  const img = await loadImage(input.imageDataUrl)
  const padX = 96
  const top = 92
  const bottomBar = 430
  const maxW = cv.width - padX * 2
  const maxH = cv.height - top - 96 - bottomBar
  const ratio = Math.min(maxW / img.width, maxH / img.height)
  const drawW = img.width * ratio
  const drawH = img.height * ratio
  ctx.drawImage(img, (cv.width - drawW) / 2, top, drawW, drawH)

  // 图框内分割线（标题栏上沿）
  const barY = cv.height - 96 - bottomBar + 40
  ctx.strokeStyle = '#c9c6c0'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(58, barY)
  ctx.lineTo(cv.width - 58, barY)
  ctx.stroke()

  // 左侧：图例与说明
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#6a6e75'
  ctx.font = `500 22px ${FONT}`
  ctx.fillText('图例', 96, barY + 24)

  ctx.font = `400 19px ${FONT}`
  ctx.fillStyle = '#3c4048'
  const legend = [
    '实线框：场馆轮廓；填充块：展台',
    '展台编号与名称标注于展台中心，面积随标注显示',
    '上传 Logo 的展台在名称标签左侧显示品牌图标',
    '标记色：红 / 黄 / 灰 用于运营分组',
  ]
  legend.forEach((line, i) => {
    ctx.fillText(line, 96, barY + 62 + i * 30)
  })

  // 右侧：标题栏
  const boxW = 1180
  const boxH = 300
  const boxX = cv.width - 96 - boxW
  const boxY = barY + 24
  ctx.strokeStyle = '#1a1c20'
  ctx.lineWidth = 3
  ctx.strokeRect(boxX, boxY, boxW, boxH)

  // 品牌标记
  drawBrandMark(ctx, boxX + 26, boxY + 26, 62)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#1a1c20'
  ctx.font = `600 22px ${FONT}`
  ctx.fillText('GRID MASSING STUDIO', boxX + 104, boxY + 32)
  ctx.fillStyle = '#8b8f96'
  ctx.font = `400 17px ${FONT}`
  ctx.fillText('场馆白膜 · 平面图', boxX + 104, boxY + 62)

  // 项目名
  ctx.fillStyle = '#1a1c20'
  ctx.font = `600 40px ${FONT}`
  ctx.fillText(input.projectName, boxX + 26, boxY + 128)

  // 摘要
  ctx.fillStyle = '#3c4048'
  ctx.font = `400 20px ${FONT}`
  ctx.fillText(input.summary, boxX + 26, boxY + 186)

  // 规范与日期
  const today = new Date()
  const dateText = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`
  ctx.font = `400 18px ${FONT}`
  ctx.fillStyle = input.issueCount > 0 ? '#b4541e' : '#2f7d5a'
  ctx.fillText(
    input.issueCount > 0 ? `规范校验：${input.issueCount} 项待确认` : '规范校验：通过',
    boxX + 26,
    boxY + 232,
  )
  ctx.fillStyle = '#8b8f96'
  ctx.fillText(`出图日期 ${dateText}`, boxX + 420, boxY + 232)

  // 指北针（图面右上）
  drawNorthArrow(ctx, cv.width - 210, 210, 62)

  const pageData = cv.toDataURL('image/jpeg', 0.92)
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a3' })
  doc.addImage(pageData, 'JPEG', 0, 0, PAGE.w, PAGE.h, undefined, 'FAST')
  doc.save(`${input.fileName}.pdf`)
}
