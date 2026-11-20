import type { ReadingMark } from '../components/AnnotatedText'
import type { ImportedQuestion } from '../components/QuestionImport'

export function materialSections(text: string) {
  const headings = [...text.matchAll(/^\s*(材料\s*[一二三四五六七八九十\d]+)[ \t]*$/gm)]
  if (!headings.length || text.slice(0, headings[0].index).trim()) return []
  return headings.map((heading, index) => ({
    label: heading[1].replace(/\s/g, ''),
    text: text.slice(heading.index + heading[0].length, headings[index + 1]?.index).trim(),
  })).filter((section) => section.text)
}

export function questionReadingSources(question: ImportedQuestion) {
  const questions = question.paper?.questions ?? []
  const prompts: [string, string][] = questions.length > 1
    ? questions.map(({ prompt }, index) => [`prompt-${index}`, prompt])
    : [[`prompt-${question.questionIndex ?? 0}`, question.prompt]]
  const sections = materialSections(question.materials)
  const materials: [string, string][] = sections.length
    ? sections.map(({ label, text }) => [`material-${label}`, text])
    : [['material-all', question.materials]]
  return [...prompts, ...materials]
}

export function anchorReadingMark(mark: ReadingMark, text: string): ReadingMark | undefined {
  if (text.slice(mark.start, mark.end) === mark.quote) return mark
  const start = text.indexOf(mark.quote)
  if (start >= 0 && start === text.lastIndexOf(mark.quote)) {
    return { ...mark, start, end: start + mark.quote.length }
  }
}

export function orderReadingMarks(marks: ReadingMark[], sources: [string, string][]) {
  const positions = new Map(sources.map(([id, text], index) => [id, { index, text }]))
  return marks.map((mark) => {
    const source = positions.get(mark.source)
    const anchor = source ? anchorReadingMark(mark, source.text) : undefined
    return { mark, section: source?.index ?? sources.length, offset: anchor?.start ?? Infinity }
  }).sort((a, b) => a.section - b.section || a.offset - b.offset || a.mark.start - b.mark.start)
    .map(({ mark }) => mark)
}
