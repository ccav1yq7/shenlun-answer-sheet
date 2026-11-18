import { createBlock } from '../document/model'
import type { AnswerSheet } from '../document/model'
import type { ImportedQuestion } from '../components/QuestionImport'

export function questionBlocks(question: ImportedQuestion | null) {
  if (!question) return []
  return [
    { ...createBlock('题干', 0, false), text: question.prompt },
    ...(question.materials ? [{ ...createBlock('材料', 0, false), text: question.materials }] : []),
  ]
}

export function includeQuestion(sheet: AnswerSheet, question: ImportedQuestion | null): AnswerSheet {
  return question ? { ...sheet, blocks: [...questionBlocks(question), ...sheet.blocks] } : sheet
}
