import { getDocument, PDFWorker } from 'pdfjs-dist'
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&inline'

interface Line {
  text: string
  x: number
}

export interface FenbiPaper {
  title: string
  materials: string
  sections: { label: string; text: string }[]
  questions: { label: string; prompt: string }[]
}

function joinLines(lines: Line[], material: boolean) {
  const left = Math.min(...lines.map((line) => line.x))
  return lines.reduce((text, line) => {
    if (!text) return line.text
    const paragraph = material
      ? line.x - left > 12
      : /^(?:要求\s*[:：]|[（(]\s*\d+\s*[）)])/u.test(line.text)
    const separator = paragraph ? '\n' : /[a-z]$/i.test(text) && /^[a-z]/i.test(line.text) ? ' ' : ''
    return text + separator + line.text
  }, '')
}

async function readLines(data: Uint8Array): Promise<Line[]> {
  const worker = new PdfWorker()
  const task = getDocument({ data, worker: PDFWorker.create({ port: worker }), useSystemFonts: true })
  try {
    const pdf = await task.promise
    const lines: Line[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const rows: { y: number; items: { x: number; text: string }[] }[] = []
      for (const item of content.items) {
        if (!('str' in item) || !item.str) continue
        const x = item.transform[4]
        const y = item.transform[5]
        let row = rows.find((entry) => Math.abs(entry.y - y) <= 1.5)
        if (!row) {
          row = { y, items: [] }
          rows.push(row)
        }
        row.items.push({ x, text: item.str })
      }
      const pageLines = rows.sort((a, b) => b.y - a.y).flatMap(({ items }) => {
        items.sort((a, b) => a.x - b.x)
        const text = items.map((item) => item.text).join('').trim()
        if (!text || /^(?:[·•]\s*)?本试卷由粉笔用户|^第\s*\d+\s*页\s*[,，]?\s*共\s*\d+\s*页$/.test(text)) return []
        return [{ text, x: items.find((item) => item.text.trim())?.x ?? items[0].x }]
      })
      const answerSheet = pageLines.findIndex((line) => line.text.normalize('NFKC').replace(/\s/g, '') === '答题纸')
      lines.push(...(answerSheet < 0 ? pageLines : pageLines.slice(0, answerSheet)))
      if (answerSheet >= 0) break
    }
    return lines
  } finally {
    try {
      await task.destroy()
    } finally {
      worker.terminate()
    }
  }
}

export async function importFenbiPdf(file: File): Promise<FenbiPaper> {
  const lines = await readLines(new Uint8Array(await file.arrayBuffer()))
  if (!lines.some((line) => /\p{Script=Han}/u.test(line.text))) {
    throw new Error('PDF 中没有可提取的中文文字。扫描件需先转成可复制文字的 PDF。')
  }

  const normalized = lines.map((line) => line.text.normalize('NFKC').replace(/\s/g, ''))
  const firstMaterial = normalized.findIndex((line) => /^材料[一二三四五六七八九十\d]+$/.test(line))
  const questionStart = normalized.findIndex((line, index) => index > firstMaterial && line === '作答要求')
  if (firstMaterial < 0 || questionStart < 0) {
    throw new Error('未找到粉笔整卷 PDF 的「材料」与「作答要求」标题，可复制文字后分别粘贴。')
  }

  const header = new Set(normalized.slice(0, firstMaterial).filter((line) => /《申论》/.test(line)))
  const materials: { label: string; lines: Line[] }[] = []
  for (let i = firstMaterial; i < questionStart; i++) {
    if (header.has(normalized[i])) continue
    if (/^材料[一二三四五六七八九十\d]+$/.test(normalized[i])) {
      materials.push({ label: normalized[i], lines: [] })
    } else {
      materials[materials.length - 1]?.lines.push(lines[i])
    }
  }

  const questions: { label: string; lines: Line[] }[] = []
  for (let i = questionStart + 1; i < lines.length; i++) {
    if (header.has(normalized[i])) continue
    if (/^第[一二三四五六七八九十\d]+题$/.test(normalized[i])) {
      questions.push({ label: normalized[i], lines: [] })
    } else {
      questions[questions.length - 1]?.lines.push(lines[i])
    }
  }

  if (!materials.length || materials.some((section) => !section.lines.length)
    || !questions.length || questions.some((question) => !question.lines.length)) {
    throw new Error('材料或题干解析不完整，可复制文字后分别粘贴。')
  }

  const sections = materials.map((section) => ({ label: section.label, text: joinLines(section.lines, true) }))
  return {
    title: file.name.replace(/\.pdf$/i, ''),
    sections,
    materials: sections.map((section) => `${section.label}\n${section.text}`).join('\n\n'),
    questions: questions.map((question) => ({ label: question.label, prompt: joinLines(question.lines, false) })),
  }
}
