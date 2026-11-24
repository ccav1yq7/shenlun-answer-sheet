import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { AnnotatedText } from '../components/AnnotatedText'
import type { ImportedQuestion } from '../components/QuestionImport'
import type { ReadingMarkSet } from '../document/practiceStore'
import { defaultMarkPresets, readReadingPreferences } from '../document/readingMarks'
import { materialSections, orderReadingMarks, questionReadingSources } from '../document/readingOrder'
import { toCanvas } from 'html-to-image'

export async function* pdfReadingPages(
  host: HTMLElement,
  question: ImportedQuestion,
  content: { prompt: boolean; materials: boolean },
  sets: ReadingMarkSet[],
): AsyncGenerator<Blob> {
  const promptIndex = question.questionIndex ?? 0
  const sections = materialSections(question.materials)
  const sources = [
    ...(content.prompt && question.prompt ? [{
      label: '题干', source: `prompt-${promptIndex}`,
      text: question.paper?.questions[promptIndex]?.prompt ?? question.prompt,
    }] : []),
    ...(content.materials && question.materials ? sections.length
      ? sections.map(({ label, text }) => ({ label, text, source: `material-${label}` }))
      : [{ label: '材料', text: question.materials, source: 'material-all' }] : []),
  ]
  const width = 794
  const height = 1123
  const margin = 56
  const staging = document.createElement('div')
  staging.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;'
  const reading = document.createElement('div')
  reading.className = 'pdf-reading-source'
  reading.style.cssText = `width:${width - margin * 2}px;color:#151515;background:white;`
  staging.setAttribute('aria-hidden', 'true')
  staging.append(reading)
  host.append(staging)
  const root = createRoot(reading)
  try {
    for (const set of sets) {
      const marks = orderReadingMarks(set.marks, questionReadingSources(question))
      const noteNumbers = new Map(marks.filter((mark) => mark.note).map((mark, index) => [mark.id, index + 1]))
      flushSync(() => root.render(<>
        <h1>{set.name}</h1>
        {sources.map((source) => <section key={source.source}>
          <AnnotatedText {...source} heading={source.label} indentParagraphs={source.source.startsWith('material-')}
            marks={marks} noteNumbers={noteNumbers} presets={defaultMarkPresets} notePreferences={readReadingPreferences().note}
            onSave={() => undefined} onRemove={() => undefined} />
        </section>)}
      </>))
      await document.fonts.ready
      const origin = reading.getBoundingClientRect().top
      const occupied: { top: number; bottom: number }[] = []
      const walker = document.createTreeWalker(reading, NodeFilter.SHOW_TEXT)
      const range = document.createRange()
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim() || node.parentElement?.closest('button.reading-icon-button, button.reading-index-button')) continue
        range.selectNodeContents(node)
        for (const rect of range.getClientRects()) {
          if (rect.height && rect.width) occupied.push({ top: rect.top - origin, bottom: rect.bottom - origin })
        }
      }
      reading.querySelectorAll('mark').forEach((mark) => {
        for (const rect of mark.getClientRects()) {
          occupied.push({ top: rect.top - origin - 10, bottom: rect.bottom - origin + 4 })
        }
      })
      const total = reading.scrollHeight
      const contentWidth = reading.offsetWidth
      const raster = await toCanvas(reading, { pixelRatio: 2, backgroundColor: '#fff' })
      const scaleX = raster.width / contentWidth
      const scaleY = raster.height / total
      const page = document.createElement('canvas')
      page.width = width * 2
      page.height = height * 2
      const context = page.getContext('2d')
      if (!context) throw new Error('无法生成标记页面')
      for (let start = 0; start < total;) {
        let end = Math.min(total, start + height - 2 * margin)
        let crossing = occupied.find(({ top, bottom }) => top < end && bottom > end)
        while (crossing && crossing.top > start + 16) {
          end = Math.floor(crossing.top)
          crossing = occupied.find(({ top, bottom }) => top < end && bottom > end)
        }
        const slice = end - start
        context.fillStyle = '#fff'
        context.fillRect(0, 0, page.width, page.height)
        context.drawImage(raster, 0, start * scaleY, contentWidth * scaleX, slice * scaleY,
          margin * 2, margin * 2, contentWidth * 2, slice * 2)
        yield await new Promise<Blob>((resolve, reject) => page.toBlob((blob) => {
          if (blob) resolve(blob)
          else reject(new Error('无法生成标记页面'))
        }))
        start = end
      }
    }
  } finally {
    root.unmount()
    staging.remove()
  }
}
