import { rgb, StandardFonts } from 'pdf-lib'
import type { PDFDocument } from 'pdf-lib'

export interface PdfPacket {
  title: string
  cover: boolean
}

const accent = rgb(0.17, 0.34, 0.57)
const rule = rgb(0.83, 0.87, 0.93)

async function titleImage(pdf: PDFDocument, title: string, cover: boolean) {
  const canvas = document.createElement('canvas')
  canvas.width = 1400
  canvas.height = cover ? 480 : 42
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  ctx.font = cover ? '600 58px sans-serif' : '25px sans-serif'
  ctx.fillStyle = cover ? '#182b46' : '#2b5791'
  ctx.textBaseline = 'top'
  const lines: string[] = []
  let line = ''
  for (const character of title) {
    if (line && ctx.measureText(line + character).width > 1320) {
      lines.push(line)
      line = ''
    }
    line += character
  }
  if (line) lines.push(line)
  if (cover) {
    ctx.textAlign = 'center'
    const visible = lines.slice(0, 5)
    visible.forEach((text, index) => ctx.fillText(index === 4 && lines.length > 5 ? text.slice(0, -1) + '…' : text,
      700, 210 - (visible.length - 1) * 36 + index * 74))
  } else {
    ctx.fillText(lines.length > 1 ? lines[0].slice(0, -1) + '…' : lines[0] ?? '', 0, 4)
  }
  return pdf.embedPng(canvas.toDataURL('image/png'))
}

export async function decoratePdfPacket(pdf: PDFDocument, packet: PdfPacket, readingPageCount: number) {
  pdf.setTitle(packet.title)
  if (packet.cover) {
    const coverTitle = await titleImage(pdf, packet.title, true)
    if (coverTitle) {
      const cover = pdf.insertPage(0, [595.28, 841.89])
      cover.drawLine({ start: { x: 254, y: 530 }, end: { x: 342, y: 530 }, thickness: 2, color: accent })
      cover.drawImage(coverTitle, { x: 48, y: 318, width: 499, height: 171 })
      readingPageCount++
    }
  }
  const title = await titleImage(pdf, packet.title, false)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const pages = pdf.getPages()
  pages.forEach((page, index) => {
    const { width, height } = page.getSize()
    if (index < readingPageCount) {
      page.drawLine({ start: { x: 40, y: height - 34 }, end: { x: width - 40, y: height - 34 }, thickness: 0.65, color: rule })
      if (title) page.drawImage(title, { x: 40, y: height - 29, width: 350, height: 10.5 })
      page.drawLine({ start: { x: 40, y: 32 }, end: { x: width - 40, y: 32 }, thickness: 0.65, color: rule })
    }
    const label = `${index + 1} / ${pages.length}`
    page.drawText(label, { x: width / 2 - font.widthOfTextAtSize(label, 8) / 2, y: 15, size: 8, font, color: accent })
  })
}
