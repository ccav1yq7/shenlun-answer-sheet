import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { AnnotatedText } from '../components/AnnotatedText'
import type { ImportedQuestion } from '../components/QuestionImport'
import type { ReadingMarkSet } from '../document/practiceStore'
import { defaultMarkPresets, readReadingPreferences } from '../document/readingMarks'
import { materialSections, orderReadingMarks, questionReadingSources } from '../document/readingOrder'
import { toCanvas } from 'html-to-image'
import { pdfRasterBreak } from './pdfRasterBreak'

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
      label: '作答要求', source: `prompt-${promptIndex}`,
      text: question.paper?.questions[promptIndex]?.prompt ?? question.prompt,
    }] : []),
    ...(content.materials && question.materials ? sections.length
      ? sections.map(({ label, text }) => ({ label, text, source: `material-${label}` }))
      : [{ label: '材料', text: question.materials, source: 'material-all' }] : []),
  ].reverse()
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
        {content.materials && question.materials && <h2 className="pdf-materials-title">给定材料</h2>}
        {sources.map((source) => <section key={source.source} className={source.source.startsWith('material-') ? 'pdf-material-section' : undefined}>
          <AnnotatedText {...source} heading={source.label} indentParagraphs={source.source.startsWith('material-')}
            marks={marks} noteNumbers={noteNumbers} presets={defaultMarkPresets} notePreferences={readReadingPreferences().note}
            onSave={() => undefined} onRemove={() => undefined} />
        </section>)}
      </>))
      await document.fonts.ready
      const raster = await toCanvas(reading, { pixelRatio: 2, backgroundColor: '#fff' })
      const rasterContext = raster.getContext('2d')
      if (!rasterContext) throw new Error('无法读取标记页面')
      const pixelsPerCssPixel = raster.width / reading.offsetWidth
      const pageCapacity = Math.floor((height - 2 * margin) * pixelsPerCssPixel)
      const page = document.createElement('canvas')
      page.width = width * 2
      page.height = height * 2
      const context = page.getContext('2d')
      if (!context) throw new Error('无法生成标记页面')
      for (let start = 0; start < raster.height;) {
        const end = pdfRasterBreak(rasterContext, start, Math.min(raster.height, start + pageCapacity))
        const slice = end - start
        context.fillStyle = '#fff'
        context.fillRect(0, 0, page.width, page.height)
        context.drawImage(raster, 0, start, raster.width, slice,
          margin * 2, margin * 2, (width - 2 * margin) * 2, slice * 2 / pixelsPerCssPixel)
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
