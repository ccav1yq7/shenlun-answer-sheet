import { decoratePdfPacket } from './pdfPacket'
import type { PdfPacket } from './pdfPacket'
import { PDFDocument } from 'pdf-lib'
import { toBlob } from 'html-to-image'
import type { AnswerSheet } from '../document/model'
import type { SheetGeometry } from '../sheet/geometry'
import { downloadBlob, timestamp } from './download'

async function capture(element: HTMLElement): Promise<Blob> {
  const result = await toBlob(element, { pixelRatio: 2, backgroundColor: '#fff' })
  if (!result) throw new Error('无法生成图片')
  return result
}

async function* captureGridPages(source: HTMLElement) {
  const staging = document.createElement('div')
  staging.setAttribute('aria-hidden', 'true')
  staging.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;'
  const host = source.closest('.app') ?? source.parentElement
  const original = source.querySelector('.sheet-page')
  if (original) {
    const style = getComputedStyle(original)
    for (const name of style) {
      if (name.startsWith('--')) staging.style.setProperty(name, style.getPropertyValue(name))
    }
  }
  host?.append(staging)
  try {
    await document.fonts.ready
    const pages = Array.from(source.querySelectorAll<HTMLElement>('.sheet-page:not(.sheet-page--review-only)'), (page) => {
      const clone = page.cloneNode(true) as HTMLElement
      clone.style.boxShadow = 'none'
      clone.querySelectorAll('.panel--inactive').forEach((panel) => panel.classList.remove('panel--inactive'))
      clone.querySelectorAll<HTMLElement>('.glyph, .attach').forEach((ink) => {
        ink.style.color = '#000'
        ink.style.setProperty('-webkit-text-stroke', '0.55px #000')
      })
      clone.querySelectorAll('.cell--space').forEach((cell) => cell.classList.remove('cell--space'))
      clone.querySelector('.answer-card-review')?.remove()
      const identityFields = page.querySelectorAll<HTMLInputElement>('.sheet-identity-input')
      clone.querySelectorAll<HTMLInputElement>('.sheet-identity-input').forEach((field, index) => {
        const text = document.createElement('span')
        text.className = field.className.replace('sheet-identity-input', '')
        text.textContent = identityFields[index]?.value ?? ''
        field.replaceWith(text)
      })
      clone.querySelectorAll('.caret').forEach((node) => node.remove())
      clone.querySelectorAll('.cell--caret, .cell--selected').forEach((node) => {
        node.classList.remove('cell--caret', 'cell--selected')
      })
      return clone
    })
    for (const page of pages) {
      staging.replaceChildren(page)
      yield await capture(page)
    }
  } finally {
    staging.remove()
  }
}

async function* captureTextPages(sheet: AnswerSheet) {
  await document.fonts.ready
  const canvas = document.createElement('canvas')
  canvas.width = 1588
  canvas.height = 2246
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法生成文字图片')

  const margin = 144
  const lineHeight = 60
  const textWidth = canvas.width - margin * 2
  ctx.font = '38px "PingFang SC", "Microsoft YaHei", sans-serif'
  ctx.textBaseline = 'top'

  const wrap = (text: string) => {
    const lines: string[] = []
    for (const paragraph of text.split(/\r?\n/)) {
      let line = ''
      for (const char of paragraph) {
        if (line && ctx.measureText(line + char).width > textWidth) {
          lines.push(line)
          line = ''
        }
        line += char
      }
      lines.push(line)
    }
    return lines
  }

  const lines = sheet.blocks.flatMap((block) => wrap(`【${block.title}】\n${block.text}\n`))
  const perPage = Math.floor((canvas.height - margin * 2) / lineHeight)
  for (let start = 0; start < lines.length; start += perPage) {
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#111'
    lines.slice(start, start + perPage).forEach((line, index) => {
      ctx.fillText(line, margin, margin + index * lineHeight)
    })
    yield await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('无法生成文字图片'))
    }))
  }
}

export async function exportImages(source: HTMLElement, sheet: AnswerSheet, keepFormat: boolean, frontMatter?: AnswerSheet) {
  const images = []
  if (keepFormat && frontMatter) {
    for await (const image of captureTextPages(frontMatter)) images.push(image)
  }
  for await (const image of keepFormat ? captureGridPages(source) : captureTextPages(sheet)) images.push(image)
  const name = `申论作答-${timestamp()}`
  if (images.length === 1) {
    downloadBlob(images[0], `${name}.png`)
  } else if (images.length > 1) {
    const { default: JSZip } = await import('jszip')
    const zip = new JSZip()
    for (const [index, image] of images.entries()) {
      zip.file(`page-${String(index + 1).padStart(3, '0')}.png`, await image.arrayBuffer())
    }
    downloadBlob(await zip.generateAsync({ type: 'blob' }), `${name}.zip`)
  } else {
    throw new Error('没有可导出的页面')
  }
}

export interface GridPdfSource {
  source: HTMLElement
  geometry: SheetGeometry
}

export async function exportGridPdf(
  sources: AsyncIterable<GridPdfSource> | undefined,
  frontMatter?: AnswerSheet,
  readingPages?: AsyncIterable<Blob>,
  packet?: PdfPacket,
) {
  const pdf = await PDFDocument.create()
  const addPage = async (image: Blob, width: number, height: number) => {
    const png = await pdf.embedPng(await image.arrayBuffer())
    const page = pdf.addPage([width, height])
    page.drawImage(png, { x: 0, y: 0, width, height })
  }
  if (readingPages) {
    for await (const image of readingPages) await addPage(image, 210 * 72 / 25.4, 297 * 72 / 25.4)
  }
  if (frontMatter) {
    for await (const image of captureTextPages(frontMatter)) {
      await addPage(image, 210 * 72 / 25.4, 297 * 72 / 25.4)
    }
  }
  const readingPageCount = pdf.getPageCount()
  for await (const { source, geometry } of sources ?? []) {
    for await (const image of captureGridPages(source)) {
      await addPage(image, geometry.pageWidth * 72 / 25.4, geometry.pageHeight * 72 / 25.4)
    }
  }
  if (!pdf.getPageCount()) throw new Error('没有可导出的页面')
  if (packet) await decoratePdfPacket(pdf, packet, readingPageCount)
  const bytes = await pdf.save()
  downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), `申论方格答题卡-${timestamp()}.pdf`)
}
