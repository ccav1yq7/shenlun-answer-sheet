import type { ReadingMark } from '../components/AnnotatedText'
import type { ImportedQuestion } from '../components/QuestionImport'
import type { AnswerSheet } from './model'

export interface ExportContent {
  prompt: boolean
  materials: boolean
  notes: boolean
  answer: boolean
}

export interface PracticePreferences {
  capacity: number
  columns: number
  profileKey: AnswerSheet['profileKey']
  showTemplate: boolean
  readerWidth: number
  zoom: 'fit' | number
  zoomBase: number
  exportContent: ExportContent
  keepExportFormat: boolean
}

export interface SavedAnswer {
  sheet: AnswerSheet
  activeBlockId: string
}

export interface PracticeSnapshot extends SavedAnswer {
  question: ImportedQuestion | null
  otherAnswers: [number, SavedAnswer][]
  marks: ReadingMark[]
  showQuestion: boolean
  preferences: PracticePreferences
}

export interface SavedPractice {
  id: string
  name: string
  updatedAt: string
  snapshot: PracticeSnapshot
}

const RECORDS = 'shenlun-practices-v1'
const PREFERENCES = 'shenlun-preferences-v1'

export function readPractices(): SavedPractice[] {
  const records: SavedPractice[] = JSON.parse(localStorage.getItem(RECORDS) ?? '[]')
  if (!Array.isArray(records)) throw new Error('练习记录无法读取')
  return records
}

export function writePractice(record: SavedPractice) {
  const records = readPractices()
  localStorage.setItem(RECORDS, JSON.stringify([record, ...records.filter((item) => item.id !== record.id)]))
}

export function readPracticeDefaults(): Partial<PracticePreferences> {
  try {
    return JSON.parse(localStorage.getItem(PREFERENCES) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

export function writePracticeDefaults(preferences: PracticePreferences) {
  localStorage.setItem(PREFERENCES, JSON.stringify(preferences))
}
