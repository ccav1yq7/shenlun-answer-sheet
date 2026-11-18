import { toBlob } from 'html-to-image'
import type { AnswerSheet } from '../document/model'
import type { SheetGeometry } from '../sheet/geometry'
import { downloadBlob, timestamp } from './exportDocx'
import { buildPrintHtml } from './exportPdf'

async function capture(element: HTMLElement): Promise<Blob> {
  const result = await toBlob(element, { pixelRatio: 2, backgroundColor: '#fff' })
  if (!result) throw new Error('无法生成图片')
  return result
}

async function* capturePages(source: HTMLElement, sheet: AnswerSheet, keepFormat: boolean) {
  const staging = document.createElement('div')
  staging.setAttribute('aria-hidden', 'true')
  staging.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;'
  source.parentElement?.append(staging)
  try {
    if (keepFormat) {
      const pages = Array.from(source.querySelectorAll<HTMLElement>('.sheet-page'), (page) => {
        const clone = page.cloneNode(true) as HTMLElement
        clone.style.boxShadow = 'none'
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
    } else {
      const page = document.createElement('div')
      page.className = 'print-root'
      page.style.cssText = 'display:block;width:210mm;padding:20mm;white-space:pre-wrap;overflow-wrap:anywhere;'
      page.innerHTML = buildPrintHtml(sheet, { title: '申论作答', keepIndent: false })
      staging.append(page)
      yield await capture(page)
    }
  } finally {
    staging.remove()
  }
}

export async function exportImages(source: HTMLElement, sheet: AnswerSheet, keepFormat: boolean) {
  const images = []
  for await (const image of capturePages(source, sheet, keepFormat)) images.push(image)
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

export async function exportGridPdf(source: HTMLElement, sheet: AnswerSheet, geometry: SheetGeometry) {
  const { PDFDocument } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const width = geometry.pageWidth * 72 / 25.4
  const height = geometry.pageHeight * 72 / 25.4
  for await (const image of capturePages(source, sheet, true)) {
    const png = await pdf.embedPng(await image.arrayBuffer())
    const page = pdf.addPage([width, height])
    page.drawImage(png, { x: 0, y: 0, width, height })
  }
  const bytes = await pdf.save()
  downloadBlob(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), `申论方格答题卡-${timestamp()}.pdf`)
}
