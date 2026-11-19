import { createBlock } from '../document/model'
import type { AnswerSheet } from '../document/model'
import type { ReadingMark } from '../components/AnnotatedText'
import type { ImportedQuestion } from '../components/QuestionImport'

export function questionBlocks(question: ImportedQuestion | null, content = { prompt: true, materials: true }) {
  if (!question) return []
  return [
    ...(content.prompt ? [{ ...createBlock('题干', 0, false), text: question.prompt }] : []),
    ...(content.materials && question.materials ? [{ ...createBlock('材料', 0, false), text: question.materials }] : []),
  ]
}

export function readingNotesBlock(marks: ReadingMark[]) {
  const text = marks.map((mark) => {
    const excerpt = `【${mark.label} · ${[mark.preset?.style === 'transition' ? `// ${mark.preset.label}` : mark.preset?.label, mark.note?.kind].filter(Boolean).join(' · ') || '标记'}】\n原文：${mark.quote}`
    return mark.note ? `${excerpt}\n笔记：${mark.note.text}` : excerpt
  }).join('\n\n')
  return { ...createBlock('标记与笔记', 0, false), text }
}

export function includeQuestion(sheet: AnswerSheet, question: ImportedQuestion | null): AnswerSheet {
  return question ? { ...sheet, blocks: [...questionBlocks(question), ...sheet.blocks] } : sheet
}
