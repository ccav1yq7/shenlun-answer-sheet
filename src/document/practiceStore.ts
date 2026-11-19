import type { ReadingMark } from '../components/AnnotatedText'
import type { ImportedQuestion } from '../components/QuestionImport'
import type { AnswerSheet } from './model'

export interface ExportContent {
  prompt: boolean
  materials: boolean
  notes: boolean
  review?: boolean
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
  status?: 'in-progress' | 'completed'
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

export interface DirectoryHandle extends FileSystemDirectoryHandle {
  values(): AsyncIterable<FileSystemHandle>
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
}

type DirectoryPicker = (options: { mode: 'readwrite'; id: string }) => Promise<DirectoryHandle>
const directoryPicker = () => (window as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker

export function supportsPracticeDirectory() {
  return typeof directoryPicker() === 'function'
}

export async function choosePracticeDirectory() {
  const pick = directoryPicker()
  if (!pick) throw new Error('当前浏览器不支持选择本地文件夹')
  const directory = await pick.call(window, { mode: 'readwrite', id: 'shenlun-practices' })
  await directorySetting('write', directory)
  return directory
}

export function getPracticeDirectory() {
  return directorySetting('read')
}

export async function clearPracticeDirectory() {
  await directorySetting('write')
}

async function directorySetting(mode: 'read' | 'write', value?: DirectoryHandle): Promise<DirectoryHandle | undefined> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('shenlun-folders-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('settings')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('settings', mode === 'read' ? 'readonly' : 'readwrite')
      const store = transaction.objectStore('settings')
      const request = mode === 'read' ? store.get('directory')
        : value ? store.put(value, 'directory') : store.delete('directory')
      transaction.oncomplete = () => resolve(mode === 'read' ? request.result as DirectoryHandle | undefined : value)
      transaction.onabort = () => reject(transaction.error)
      transaction.onerror = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

export type PracticeStorage = 'browser' | 'folder'

export interface PracticeEntry extends SavedPractice {
  storage: PracticeStorage
}

const permission = { mode: 'readwrite' } as const

export function getDirectoryPermission(directory: DirectoryHandle) {
  return directory.queryPermission(permission)
}

export function requestDirectoryPermission(directory: DirectoryHandle) {
  return directory.requestPermission(permission)
}

const validId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i

export function practiceFilename(id: string) {
  if (!validId.test(id)) throw new Error('练习文件编号无效')
  return `shenlun-practice-${id}.json`
}

function isAnswer(value: SavedAnswer | undefined): boolean {
  return Boolean(value && typeof value.activeBlockId === 'string' && value.sheet
    && (value.sheet.mode === 'single' || value.sheet.mode === 'full')
    && Number.isInteger(value.sheet.columns) && value.sheet.columns >= 1 && value.sheet.columns <= 100
    && Array.isArray(value.sheet.blocks) && value.sheet.blocks.length > 0
    && value.sheet.blocks.every((block) => block && typeof block.text === 'string'
      && typeof block.id === 'string' && typeof block.title === 'string'
      && Number.isInteger(block.capacity) && block.capacity >= 1 && block.capacity <= 20000
      && Array.isArray(block.paragraphStyles)))
}

async function readPracticeFile(handle: FileSystemFileHandle): Promise<SavedPractice> {
  const record: SavedPractice = JSON.parse(await (await handle.getFile()).text())
  const snapshot = record?.snapshot
  const question = snapshot?.question
  if (!record || typeof record.id !== 'string' || !validId.test(record.id)
    || handle.name !== practiceFilename(record.id) || typeof record.name !== 'string'
    || typeof record.updatedAt !== 'string' || !snapshot || !isAnswer(snapshot)
    || !Array.isArray(snapshot.otherAnswers)
    || !snapshot.otherAnswers.every((entry) => Array.isArray(entry) && Number.isInteger(entry[0]) && isAnswer(entry[1]))
    || !Array.isArray(snapshot.marks) || snapshot.marks.some((mark) =>
      !mark || typeof mark.id !== 'string' || typeof mark.source !== 'string'
      || typeof mark.quote !== 'string' || typeof mark.label !== 'string'
      || !Number.isInteger(mark.start) || !Number.isInteger(mark.end)
      || (mark.note && (typeof mark.note.text !== 'string' || !['提炼', '改写', '随记'].includes(mark.note.kind))))
    || !snapshot.preferences?.exportContent || !Number.isFinite(snapshot.preferences.readerWidth)
    || !Number.isFinite(snapshot.preferences.zoomBase)
    || (snapshot.preferences.zoom !== 'fit' && !Number.isFinite(snapshot.preferences.zoom))
    || (question && (typeof question.prompt !== 'string' || typeof question.materials !== 'string'
      || (question.paper && (!Array.isArray(question.paper.questions)
        || question.paper.questions.some((item) => !item || typeof item.prompt !== 'string' || typeof item.label !== 'string')))))) {
    throw new Error('练习文件格式无效')
  }
  return record
}

export async function listDirectoryPractices(directory: DirectoryHandle) {
  const records: PracticeEntry[] = []
  let unreadable = 0
  for await (const entry of directory.values()) {
    if (entry.kind !== 'file' || !/^shenlun-practice-[0-9a-f-]+\.json$/i.test(entry.name)) continue
    try {
      records.push({ ...await readPracticeFile(entry as FileSystemFileHandle), storage: 'folder' })
    } catch {
      unreadable++
    }
  }
  return { records, unreadable }
}

async function checkedDirectory(directory: DirectoryHandle | undefined) {
  if (!directory || await getDirectoryPermission(directory) !== 'granted') {
    throw new Error('请在「我的练习」重新授权本地文件夹')
  }
  return directory
}

export async function reloadPractice(entry: PracticeEntry, directory?: DirectoryHandle): Promise<PracticeEntry> {
  if (entry.storage === 'browser') {
    const record = readPractices().find(({ id }) => id === entry.id)
    if (!record) throw new Error('这份练习已不存在，请刷新列表')
    return { ...record, storage: 'browser' }
  }
  const folder = await checkedDirectory(directory)
  const handle = await folder.getFileHandle(practiceFilename(entry.id))
  return { ...await readPracticeFile(handle), storage: 'folder' }
}

function samePractice(a: PracticeEntry, b: PracticeEntry) {
  return a.updatedAt === b.updatedAt && a.name === b.name && a.status === b.status
    && JSON.stringify(a.snapshot) === JSON.stringify(b.snapshot)
}

export async function storePractice(entry: PracticeEntry, directory?: DirectoryHandle, expected?: PracticeEntry) {
  if (expected && !samePractice(await reloadPractice(expected, directory), expected)) {
    throw new Error('练习已被其他窗口或工具修改，请重新打开，或另存一份')
  }
  const { storage, ...record } = entry
  if (storage === 'browser') {
    writePractice(record)
    return
  }
  const folder = await checkedDirectory(directory)
  const file = await folder.getFileHandle(practiceFilename(entry.id), { create: true })
  const writer = await file.createWritable()
  try {
    await writer.write(JSON.stringify(record, null, 2) + '\n')
    await writer.close()
  } catch (error) {
    await writer.abort().catch(() => undefined)
    throw error
  }
}

export async function deletePractice(entry: PracticeEntry, directory?: DirectoryHandle) {
  if (!samePractice(await reloadPractice(entry, directory), entry)) {
    throw new Error('练习内容已修改，请刷新列表后再删除')
  }
  if (entry.storage === 'browser') {
    localStorage.setItem(RECORDS, JSON.stringify(readPractices().filter(({ id }) => id !== entry.id)))
    return
  }
  const folder = await checkedDirectory(directory)
  await folder.removeEntry(practiceFilename(entry.id))
}
