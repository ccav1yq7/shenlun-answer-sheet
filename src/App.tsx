import { ReviewNotes } from './components/ReviewNotes'
import { orderReadingMarks, questionReadingSources } from './document/readingOrder'
import { hasFenbiAssistant, requestFenbiAssistant } from './document/fenbiAssistant'
/**
 * 申论电脑模拟答题卡 —— 应用外壳
 *
 * 职责分工：
 *   逻辑文本 → layout 引擎 → 方格布局      （src/layout）
 *   文档模型 / 段落样式                     （src/document）
 *   导出                                   （src/export）
 *   本文件只做状态编排与事件转发，不含任何排版规则。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { EditorSurface } from './components/EditorSurface'
import type { EditorSurfaceHandle } from './components/EditorSurface'
import { SheetView } from './components/SheetView'
import { MarkPresetDialog } from './components/MarkPresetDialog'
import { readReadingPreferences, syncMarkPresets } from './document/readingMarks'
import type { ReadingMark } from './components/AnnotatedText'
import { AnswerCardDialog } from './components/AnswerCardDialog'
import { PracticeDialog } from './components/PracticeDialog'
import {
  getPracticeDirectory, readPracticeDefaults, readPracticeLocation, reloadPractice,
  rememberPracticeLocation, storePractice, writePracticeDefaults,
} from './document/practiceStore'
import type { DirectoryHandle, PracticeEntry, PracticePreferences, PracticeSnapshot, ReadingMarkSet, SavedPractice } from './document/practiceStore'
import { QuestionPane } from './components/QuestionPane'
import { QuestionImport } from './components/QuestionImport'
import type { ImportedQuestion } from './components/QuestionImport'
import {
  CAPACITY_PRESETS,
  COLUMN_OPTIONS,
  activeAnswerCard,
  appendBlock,
  blockToPlainText,
  createBlock,
  createSheet,
  reconcileParagraphStyles,
  sheetToPlainText,
} from './document/model'
import type { AnswerBlock, AnswerCardDetails, AnswerSheet, ArchivedAnswerCard, ParagraphStyle } from './document/model'
import { includeQuestion, questionBlocks, readingNotesBlock } from './export/questionContent'
import { buildPrintHtml, exportPdfViaPrint } from './export/exportPdf'
import { describeUnsupportedChars, findUnsupportedChars } from './export/pdfFontCharset'
import {
  LAYOUT_PRESETS,
  caretPositionFor,
  createDefaultProfile,
  layoutDocument,
  withProfile,
} from './layout'
import type { LayoutProfile } from './layout'
import { chooseLayout, computeGeometry, geometryToCssVars } from './sheet/geometry'
import './styles/app.css'
import './styles/sheet.css'
import './styles/print.css'

const PAGE_PX_PER_MM = 96 / 25.4

/** 示例答案：一次演示标题居中、数字两两成组、复合标点、省略号、破折号、百分号 */
const DEMO_TEXT = [
  '推动乡村振兴',
  '当前，我国经济社会发展进入新阶段，2026年农村居民人均可支配收入增长5%。',
  '他说：“我们要加快建设宜居宜业和美乡村……”',
  '——这是新时代新征程上的必答题。',
].join('\n')

interface Snapshot {
  blockId: string
  text: string
  caret: number
  styles: ParagraphStyle[]
}

function paragraphIndexAt(text: string, offset: number): number {
  let count = 0
  const limit = Math.min(offset, text.length)
  for (let i = 0; i < limit; i++) if (text[i] === '\n') count += 1
  return count
}

function questionCapacity(prompt: string): number {
  const limit = prompt.match(/(?:不超过|不得超过|不多于|字数[：:]?)[^\d]{0,5}(\d+)(?:\s*[-—至到～~]\s*(\d+))?\s*字/)
  return limit ? Math.max(1, Math.min(20000, Number(limit[2] ?? limit[1]))) : 300
}

export default function App() {
  const [defaults, setDefaults] = useState(readPracticeDefaults)
  const [sheet, setSheet] = useState<AnswerSheet>(() => {
    const initial = createSheet('single', defaults.capacity ?? 300)
    return {
      ...initial,
      columns: defaults.columns ?? initial.columns,
      profileKey: defaults.profileKey ?? initial.profileKey,
      showTemplate: defaults.showTemplate ?? initial.showTemplate,
    }
  })
  const [practiceDialog, setPracticeDialog] = useState<'save' | 'list' | null>(() =>
    new URLSearchParams(window.location.search).get('practice') === '1' ? 'list' : null)
  const resumeLocation = useRef(
    new URLSearchParams(window.location.search).get('practice') === '1'
    || new URLSearchParams(window.location.hash.slice(1)).has('fenbi-question')
      ? undefined : readPracticeLocation(),
  )
  const [currentPractice, setCurrentPractice] = useState<PracticeEntry | null>(null)
  const practiceDirectory = useRef<DirectoryHandle>()
  const saveJob = useRef<Promise<void> | null>(null)
  const previousAutosave = useRef<PracticeEntry>()
  const [autosaveState, setAutosaveState] = useState<'idle' | 'saving' | 'failed'>('idle')
  const [autosaveError, setAutosaveError] = useState('')
  const [activeBlockId, setActiveBlockId] = useState<string>(() => sheet.blocks[0].id)
  const [readingPreferences, setReadingPreferences] = useState(readReadingPreferences)
  const { presets: markPresets, note: notePreferences } = readingPreferences
  const [showMarkSettings, setShowMarkSettings] = useState(false)
  const [markSets, setMarkSets] = useState<ReadingMarkSet[]>(() => [{ id: 'original', name: '第 1 套标记', marks: [] }])
  const [markSetId, setMarkSetId] = useState('original')
  const activeMarkSet = markSets.find((set) => set.id === markSetId) ?? markSets[0]
  const marks = activeMarkSet.marks

  function updateReadingMarks(update: (marks: ReadingMark[]) => ReadingMark[]) {
    setMarkSets((sets) => sets.map((set) => set.id === activeMarkSet.id
      ? { ...set, marks: update(set.marks) }
      : set))
  }

  function saveMarkSet(name: string, create: boolean) {
    if (create) {
      const id = crypto.randomUUID()
      setMarkSets((sets) => [...sets, { id, name, marks: [] }])
      setMarkSetId(id)
    } else {
      setMarkSets((sets) => sets.map((set) => set.id === activeMarkSet.id ? { ...set, name } : set))
    }
  }
  const [question, setQuestion] = useState<ImportedQuestion | null>(null)
  const questionRef = useRef(question)
  questionRef.current = question
  const [showQuestion, setShowQuestion] = useState(true)
  const [importingQuestion, setImportingQuestion] = useState(false)
  const [selection, setSelection] = useState({ start: 0, end: 0 })
  const [zoomMode, setZoomMode] = useState<'fit' | number>(defaults.zoom ?? 'fit')
  const [autoScale, setAutoScale] = useState(1)
  const [readerWidth, setReaderWidth] = useState(defaults.readerWidth ?? 38)
  const zoomBase = useRef(defaults.zoomBase ?? 1)
  const questionAnswers = useRef(new Map<number, { sheet: AnswerSheet; activeBlockId: string }>())
  const [toast, setToast] = useState<string | null>(null)
  const [assistantAvailable, setAssistantAvailable] = useState(hasFenbiAssistant)
  const [openWebdav, setOpenWebdav] = useState(false)
  const [returningAnswer, setReturningAnswer] = useState(false)

  useEffect(() => {
    const observer = new MutationObserver(() => setAssistantAvailable(hasFenbiAssistant()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-fenbi-assistant'] })
    setAssistantAvailable(hasFenbiAssistant())
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1))
    const payload = params.get('fenbi-question')
    if (payload === null) return
    params.delete('fenbi-question')
    rememberPracticeLocation(null)
    const hash = params.toString()
    window.history.replaceState(null, '', window.location.pathname + window.location.search + (hash ? `#${hash}` : ''))
    try {
      const data = JSON.parse(payload)
      if (typeof data?.prompt !== 'string' || !data.prompt.trim() || typeof data.materials !== 'string') {
        throw new Error('invalid question')
      }
      setQuestion({
        prompt: data.prompt, materials: data.materials,
        assistantLink: typeof data.assistantLink === 'string' ? data.assistantLink : undefined,
      })
      if (Number.isInteger(data.capacity) && data.capacity > 0 && data.capacity <= 10000) {
        setSheet((current) => ({
          ...current,
          blocks: current.blocks.map((block) => ({ ...block, capacity: data.capacity })),
        }))
      }
    } catch {
      setImportingQuestion(true)
    }
  }, [])

  const sheetRef = useRef(sheet)
  sheetRef.current = sheet
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const activeBlockIdRef = useRef(activeBlockId)
  activeBlockIdRef.current = activeBlockId

  const editorRef = useRef<EditorSurfaceHandle | null>(null)
  const [exportContent, setExportContent] = useState(defaults.exportContent ?? { prompt: true, materials: true, notes: false, answer: true })
  const [paperSize, setPaperSize] = useState<'auto' | 'a4'>(defaults.paperSize === 'a4' ? 'a4' : 'auto')
  const [keepExportFormat, setKeepExportFormat] = useState(defaults.keepExportFormat ?? true)
  const [exporting, setExporting] = useState(false)
  const [cardDialog, setCardDialog] = useState<'add' | 'edit' | null>(null)
  const exportSourceRef = useRef<HTMLDivElement | null>(null)
  const printRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)

  const undoStack = useRef<Snapshot[]>([])
  const redoStack = useRef<Snapshot[]>([])
  const lastPush = useRef({ time: 0, blockId: '' })

  const showToast = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast((cur) => (cur === message ? null : cur)), 2200)
  }, [])

  // -------------------------------------------------------------------------
  // 排版配置与布局
  // -------------------------------------------------------------------------

  const profile: LayoutProfile = useMemo(() => {
    const build = LAYOUT_PRESETS[sheet.profileKey]?.build ?? createDefaultProfile
    return withProfile(build(), { columns: sheet.columns })
  }, [sheet.profileKey, sheet.columns])

  // 只依赖「容量」这个数字，不依赖整个 blocks 数组 ——
  // 否则每敲一个字都会新建 blocks 数组、连带重算几何。
  const activeBlock = sheet.blocks.find((b) => b.id === activeBlockId) ?? sheet.blocks[0]
  const activeCapacity = activeBlock.capacity
  const display = activeBlock.card?.display
  // 页头按可见项预留空间，名称允许换行。
  const compactHeaderHeight = display && !display.instructions
    ? 8 + (display.title ? 27 : 0) + (display.identity ? 9 : 0) + (display.name ? 17 : 0)
    : undefined

  // 单题练习时，题目装得进一页 A4 就用 A4 纵向（纸张缩小、格子不变）；装不下才用 A3 左右两栏
  const geometry = useMemo(() => {
    const capacityRows = activeCapacity > 0 ? Math.ceil(activeCapacity / sheet.columns) : 0
    const layout = paperSize === 'a4' ? 'a4-single' : chooseLayout(sheet.columns, capacityRows, sheet.mode, compactHeaderHeight)
    return computeGeometry({ columns: sheet.columns, layout, compactHeaderHeight })
  }, [sheet.columns, sheet.mode, activeCapacity, compactHeaderHeight, paperSize])

  const isSplit = geometry.panelsPerPage > 1
  const paperLabel = geometry.layout === 'a4-single' ? 'A4 纵向' : 'A3 横向'

  const cssVars = useMemo(() => geometryToCssVars(geometry), [geometry]) as React.CSSProperties

  const doc = useMemo(
    () =>
      layoutDocument(
        sheet.blocks.map((b) => ({
          blockId: b.id,
          blockTitle: b.title,
          text: b.text,
          capacity: b.capacity,
          paragraphs: b.paragraphStyles,
        })),
        profile,
        {
          panelsPerPage: geometry.panelsPerPage,
          rowsPerPanelForPage: geometry.rowsForPage,
        },
      ),
    [sheet.blocks, profile, geometry],
  )

  const lastPage = doc.pages[doc.pages.length - 1]
  const lastPanel = lastPage?.panels[lastPage.panels.length - 1]
  const reviewFitsOnLastPage = Boolean(lastPage && lastPanel
    && geometry.panelHeight(lastPage.index) - geometry.panelHeading - lastPanel.rows.length * geometry.cell >= 32)

  const tokensByBlockId = useMemo(
    () => new Map(doc.blocks.map((b) => [b.blockId, new Map(b.tokens.map((t) => [t.id, t]))])),
    [doc],
  )

  const activeLayout = doc.blocks.find((b) => b.blockId === activeBlock.id) ?? doc.blocks[0]

  const caret = useMemo(
    () => caretPositionFor(activeLayout.rows, selection.start),
    [activeLayout, selection.start],
  )

  const stats = useMemo(() => {
    const occupied = activeLayout.occupiedCellCount
    const capacity = activeLayout.capacityCells
    const logical = activeLayout.logicalCharCount
    return {
      logical,
      occupied,
      capacity,
      remaining: capacity - occupied,
      overflow: activeLayout.overflow,
      overflowCells: activeLayout.overflowCells,
      percent: capacity > 0 ? Math.min(100, (occupied / capacity) * 100) : 0,
    }
  }, [activeLayout])

  // -------------------------------------------------------------------------
  // 适应窗口缩放
  // -------------------------------------------------------------------------

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const pageWidthPx = geometry.pageWidth * PAGE_PX_PER_MM
    const measure = () => {
      const available = el.clientWidth - 44
      setAutoScale(Math.max(0.2, Math.min(1, available / pageWidthPx)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [geometry.pageWidth])

  const scale = zoomMode === 'fit' ? autoScale : zoomMode

  const zoomOffset = zoomMode === 'fit' ? 0
    : Math.round((zoomBase.current - zoomMode) * geometry.pageWidth * PAGE_PX_PER_MM)

  function changeZoom(delta: number) {
    if (zoomMode === 'fit') zoomBase.current = scale
    setZoomMode(Math.max(0.2, Math.min(2, scale + delta)))
  }

  function selectImportedQuestion(index: number) {
    if (!question?.paper || index === question.questionIndex) return
    const selected = question.paper.questions[index]
    if (!selected) return
    questionAnswers.current.set(question.questionIndex ?? 0, { sheet, activeBlockId })
    const capacity = questionCapacity(selected.prompt)
    const restored = questionAnswers.current.get(index)
    const fresh = createSheet('single', capacity)
    fresh.blocks[0].title = selected.label
    const next = restored?.sheet ?? { ...fresh, columns: sheet.columns, profileKey: sheet.profileKey, showTemplate: sheet.showTemplate }
    const blockId = restored?.activeBlockId ?? next.blocks[0].id
    const block = next.blocks.find((item) => item.id === blockId) ?? next.blocks[0]
    undoStack.current = []
    redoStack.current = []
    lastPush.current = { time: 0, blockId: '' }
    setSheet(next)
    setActiveBlockId(block.id)
    setSelection({ start: 0, end: 0 })
    editorRef.current?.setValue(block.text, 0)
    setQuestion({ ...question, questionIndex: index, prompt: `${selected.label}\n${selected.prompt}` })
  }

  const practicePreferences = useCallback((capacity: number): PracticePreferences => {
    return {
      capacity,
      columns: sheet.columns,
      profileKey: sheet.profileKey,
      showTemplate: sheet.showTemplate,
      readerWidth,
      zoom: zoomMode,
      zoomBase: zoomBase.current,
      exportContent,
      keepExportFormat,
      ...(paperSize === 'a4' ? { paperSize } : {}),
    }
  }, [sheet.columns, sheet.profileKey, sheet.showTemplate, readerWidth, zoomMode, exportContent, keepExportFormat, paperSize])

  const snapshot = useMemo((): PracticeSnapshot => ({
    sheet,
    activeBlockId,
    question,
    marks,
    ...(markSets.length > 1 || activeMarkSet.name !== '第 1 套标记' ? {
      activeMarkSet: { id: activeMarkSet.id, name: activeMarkSet.name, index: markSets.indexOf(activeMarkSet) },
      otherMarkSets: markSets.filter((set) => set.id !== activeMarkSet.id),
    } : {}),
    showQuestion,
    preferences: practicePreferences(activeCapacity),
    otherAnswers: [...questionAnswers.current.entries()]
      .filter(([index]) => index !== (question?.questionIndex ?? 0))
      .sort(([a], [b]) => a - b),
  }), [sheet, activeBlockId, question, marks, markSets, activeMarkSet, showQuestion, practicePreferences, activeCapacity])

  const unsaved = useMemo(() => currentPractice !== null
    && JSON.stringify(snapshot) !== JSON.stringify(currentPractice.snapshot), [snapshot, currentPractice])

  const flushAutosave = useCallback((record: PracticeEntry, pending: PracticeSnapshot) => {
    if (saveJob.current || previousAutosave.current === record) return saveJob.current
    const updated = { ...record, snapshot: pending, updatedAt: new Date().toISOString() }
    const directory = practiceDirectory.current
    setAutosaveState('saving')
    const job = (async () => {
      try {
        await storePractice(updated, directory, record)
        previousAutosave.current = record
        setCurrentPractice((current) => current === record ? updated : current)
        setAutosaveState('idle')
        setAutosaveError('')
      } catch (error) {
        setAutosaveState('failed')
        setAutosaveError(error instanceof Error ? error.message : '无法写入练习记录')
      } finally {
        saveJob.current = null
      }
    })()
    saveJob.current = job
    return job
  }, [])

  useEffect(() => {
    if (!currentPractice || !unsaved || practiceDialog) return
    const save = () => void flushAutosave(currentPractice, snapshot)
    const timer = window.setTimeout(save, 650)
    const visibility = () => { if (document.visibilityState === 'hidden') save() }
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [currentPractice, unsaved, snapshot, practiceDialog, flushAutosave])

  useEffect(() => {
    if (!unsaved) return
    const protect = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [unsaved])

  async function showPracticeDialog(mode: 'save' | 'list') {
    if (saveJob.current) await saveJob.current
    setPracticeDialog(mode)
  }

  async function savePractice(name: string, status: NonNullable<SavedPractice['status']>, asCopy: boolean, directory?: DirectoryHandle) {
    const existing = asCopy ? null : currentPractice
    const record: PracticeEntry = {
      id: existing?.id ?? crypto.randomUUID(),
      name,
      status,
      storage: existing?.storage ?? (directory ? 'folder' : 'browser'),
      updatedAt: new Date().toISOString(),
      snapshot,
    }
    await storePractice(record, directory, existing ?? undefined)
    practiceDirectory.current = record.storage === 'folder' ? directory : undefined
    setCurrentPractice(record)
    rememberPracticeLocation(record)
    setAutosaveState('idle')
    setAutosaveError('')
    setPracticeDialog(null)
    showToast(record.storage === 'folder' ? '练习已保存到本地文件夹' : '练习已保存到当前浏览器')
  }

  function openPractice(record: PracticeEntry, directory?: DirectoryHandle) {
    const hasWork = question || marks.length || sheet.blocks.some((block) => block.text.trim())
    if (hasWork && (!currentPractice || unsaved)
      && !window.confirm('当前练习有未保存的内容。继续打开已保存的练习吗？')) return
    applyPractice(record, directory)
  }

  function applyPractice(record: PracticeEntry, directory?: DirectoryHandle) {
    const saved = record.snapshot
    const block = saved.sheet.blocks.find((item) => item.id === saved.activeBlockId) ?? saved.sheet.blocks[0]
    setSheet(saved.sheet)
    setActiveBlockId(block.id)
    setSelection({ start: 0, end: 0 })
    editorRef.current?.setValue(block.text, 0)
    setQuestion(saved.question)
    const savedMarkSet = saved.activeMarkSet ?? { id: 'original', name: '第 1 套标记' }
    const restoredMarkSets = [...(saved.otherMarkSets ?? [])]
    const index = saved.activeMarkSet?.index
    restoredMarkSets.splice(typeof index === 'number' && Number.isInteger(index) && index >= 0 ? index : 0, 0, {
      id: savedMarkSet.id, name: savedMarkSet.name, marks: saved.marks,
    })
    setMarkSets(restoredMarkSets.map((set) => ({ ...set, marks: syncMarkPresets(set.marks, markPresets) })))
    setMarkSetId(savedMarkSet.id)
    setShowQuestion(saved.showQuestion)
    questionAnswers.current = new Map(saved.otherAnswers)
    undoStack.current = []
    redoStack.current = []
    lastPush.current = { time: 0, blockId: '' }
    setReaderWidth(saved.preferences.readerWidth)
    setZoomMode(saved.preferences.zoom)
    zoomBase.current = saved.preferences.zoomBase
    setExportContent(saved.preferences.exportContent)
    setKeepExportFormat(saved.preferences.keepExportFormat)
    setPaperSize(saved.preferences.paperSize === 'a4' ? 'a4' : 'auto')
    practiceDirectory.current = record.storage === 'folder' ? directory : undefined
    setAutosaveState('idle')
    setAutosaveError('')
    setCurrentPractice(record)
    setPracticeDialog(null)
    rememberPracticeLocation(record)
    showToast('已打开「' + record.name + '」')
  }

  useEffect(() => {
    const location = resumeLocation.current
    if (!location) return
    let cancelled = false
    const cancelRestore = () => { cancelled = true }
    window.addEventListener('pointerdown', cancelRestore, true)
    window.addEventListener('keydown', cancelRestore, true)
    const stopListening = () => {
      window.removeEventListener('pointerdown', cancelRestore, true)
      window.removeEventListener('keydown', cancelRestore, true)
    }
    void (async () => {
      try {
        const directory = location.storage === 'folder' ? await getPracticeDirectory() : undefined
        const record = await reloadPractice(location, directory)
        if (!cancelled) applyPractice(record, directory)
      } catch (error) {
        if (cancelled) return
        if (location.storage === 'browser' || (error instanceof DOMException && error.name === 'NotFoundError')) {
          rememberPracticeLocation(null)
        }
        setPracticeDialog('list')
        showToast(location.storage === 'folder'
          ? '无法恢复上次练习，请在「我的练习」检查本地文件夹权限'
          : '上次的练习无法打开，请从列表选择')
      } finally {
        stopListening()
      }
    })()
    return () => {
      cancelRestore()
      stopListening()
    }
    // The saved location is captured before handling a fresh Fenbi import.
  }, [])

  function saveDefaults() {
    const preferences = practicePreferences(activeCapacity)
    try {
      writePracticeDefaults(preferences)
      setDefaults(preferences)
      showToast('已保存当前版式和导出选项为默认设置')
    } catch {
      showToast('无法保存默认设置，请检查浏览器存储权限')
    }
  }

  // 打印容器（.print-root）平时是空的，只有「导出兜底」那条路会往里写一次 ——
  // 于是用户直接按 Cmd+P 时，@media print 会把整个应用藏起来、只剩一个空容器：
  // 打出白纸；如果之前触发过兜底导出，打出的还会是那一次留下的旧答案，用户拿到作废内容。
  // 所以在系统真正开始打印之前，用当前内容刷新它。
  useEffect(() => {
    const container = printRef.current
    if (!container) return
    const refresh = () => {
      if (!container.dataset.exporting) {
        container.innerHTML = buildPrintHtml(includeQuestion(sheetRef.current, questionRef.current), { keepIndent: true })
      }
    }
    window.addEventListener('beforeprint', refresh)
    return () => window.removeEventListener('beforeprint', refresh)
  }, [])

  // -------------------------------------------------------------------------
  // 编辑
  // -------------------------------------------------------------------------

  /**
   * 记一步历史。
   *
   * merge = true（默认，打字）时，600ms 内的连续输入合并成一步 —— 不然撤销一次只退一个字。
   * merge = false（工具栏动作）时**必须自己占一格**：原来不管什么动作都会刷新突发窗口，
   * 于是「打完字 600ms 内点一下工具栏」，那一格的「动作前状态」被吃掉，
   * 撤销会把打字和动作一起撤掉，而打字后的状态从没入栈，再也找不回来。
   */
  const pushHistory = useCallback((snapshot: Snapshot, merge = true) => {
    const now = Date.now()
    const bursting = merge && lastPush.current.blockId === snapshot.blockId && now - lastPush.current.time < 600
    if (!bursting) {
      undoStack.current.push(snapshot)
      if (undoStack.current.length > 300) undoStack.current.shift()
    }
    // 只有打字才续突发窗口；工具栏动作之后打字要另起一次突发
    lastPush.current = merge ? { time: now, blockId: snapshot.blockId } : { time: 0, blockId: '' }
    redoStack.current = []
  }, [])

  const handleCommit = useCallback(
    (blockId: string, nextText: string, caretOffset: number) => {
      const prev = sheetRef.current
      const block = prev.blocks.find((b) => b.id === blockId)
      if (!block || block.text === nextText) {
        setSelection({ start: caretOffset, end: caretOffset })
        return
      }
      pushHistory({
        blockId,
        text: block.text,
        caret: selectionRef.current.start,
        styles: block.paragraphStyles,
      })
      const styles = reconcileParagraphStyles(block.text, block.paragraphStyles, nextText, block.indentFirstLine)
      setSheet({
        ...prev,
        blocks: prev.blocks.map((b) => (b.id === blockId ? { ...b, text: nextText, paragraphStyles: styles } : b)),
      })
      setSelection({ start: caretOffset, end: caretOffset })
    },
    [pushHistory],
  )

  const applySnapshot = useCallback((snapshot: Snapshot) => {
    // 兜底：题目可能已经被删掉了。这时快照既恢复不了模型，也不该写进输入层 ——
    // 写进去之后随便按一个键，那段「别人的文本」就会被提交给当前这道题。
    // 正常路径在删题时已经把这道题的历史清掉了，这里是第二道防线。
    if (!sheetRef.current.blocks.some((b) => b.id === snapshot.blockId)) return
    setActiveBlockId(snapshot.blockId)
    setSheet((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) =>
        b.id === snapshot.blockId ? { ...b, text: snapshot.text, paragraphStyles: snapshot.styles } : b,
      ),
    }))
    setSelection({ start: snapshot.caret, end: snapshot.caret })
    editorRef.current?.setValue(snapshot.text, snapshot.caret)
  }, [])

  const currentSnapshot = useCallback((): Snapshot => {
    const id = activeBlockIdRef.current
    const block = sheetRef.current.blocks.find((b) => b.id === id) ?? sheetRef.current.blocks[0]
    return {
      blockId: block.id,
      text: block.text,
      caret: selectionRef.current.start,
      styles: block.paragraphStyles,
    }
  }, [])

  /**
   * 取出一条仍然有效的快照。
   * 被删掉的题目会留下指向它的快照，那些快照既恢复不了模型，又会把已删题目的文本
   * 写进输入层，下一次按键就污染当前这道题 —— 所以直接丢弃，而不是弹出来用。
   */
  const popValidSnapshot = useCallback((stack: Snapshot[]): Snapshot | null => {
    while (stack.length > 0) {
      const entry = stack.pop() as Snapshot
      if (sheetRef.current.blocks.some((b) => b.id === entry.blockId)) return entry
    }
    return null
  }, [])

  const handleUndo = useCallback(() => {
    const entry = popValidSnapshot(undoStack.current)
    if (!entry) {
      showToast('没有可撤销的操作')
      return
    }
    redoStack.current.push(currentSnapshot())
    lastPush.current = { time: 0, blockId: '' }
    applySnapshot(entry)
  }, [applySnapshot, currentSnapshot, popValidSnapshot, showToast])

  const handleRedo = useCallback(() => {
    const entry = popValidSnapshot(redoStack.current)
    if (!entry) {
      showToast('没有可重做的操作')
      return
    }
    undoStack.current.push(currentSnapshot())
    lastPush.current = { time: 0, blockId: '' }
    applySnapshot(entry)
  }, [applySnapshot, currentSnapshot, popValidSnapshot, showToast])

  // -------------------------------------------------------------------------
  // 点击答题格定位光标
  // -------------------------------------------------------------------------

  const handlePointerDown = useCallback(
    (blockId: string, rowIndex: number, column: number, fraction: number, shift: boolean) => {
      const blockDoc = doc.blocks.find((b) => b.blockId === blockId)
      if (!blockDoc) return
      const row = blockDoc.rows[rowIndex]
      if (!row) return
      const cell = row.cells[column]
      if (!cell) return

      const tokenMap = tokensByBlockId.get(blockId)
      const rawOffset = cell.sourceStart + Math.round(fraction * (cell.sourceEnd - cell.sourceStart))
      let offset = rawOffset
      if (tokenMap) {
        const list = blockDoc.tokens
        for (const t of list) {
          if (t.caretAtomic && rawOffset > t.sourceStart && rawOffset < t.sourceEnd) {
            offset = rawOffset - t.sourceStart < t.sourceEnd - rawOffset ? t.sourceStart : t.sourceEnd
            break
          }
        }
      }

      if (blockId !== activeBlockId) {
        setActiveBlockId(blockId)
      }

      const anchor = selectionRef.current.start
      const next = shift ? { start: Math.min(anchor, offset), end: Math.max(anchor, offset) } : { start: offset, end: offset }
      setSelection(next)
      requestAnimationFrame(() => {
        // 点到锚点左边 → 锚点在右端，是反向选区；方向丢了 Shift+← 就会动错端
        editorRef.current?.focusAt(next.start, next.end, offset < anchor)
      })
    },
    [activeBlockId, doc, tokensByBlockId],
  )

  // -------------------------------------------------------------------------
  // 工具栏动作
  // -------------------------------------------------------------------------

  const updateBlock = useCallback((blockId: string, patch: Partial<AnswerBlock>) => {
    setSheet((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)),
    }))
  }, [])

  const currentCard = activeAnswerCard(activeBlock)
  const otherCards = activeBlock.otherCards ?? []

  function swapAnswerCard(card: ArchivedAnswerCard, remaining: ArchivedAnswerCard[]) {
    const { text, paragraphStyles, indentFirstLine, ...details } = card
    const archive = {
      ...currentCard, text: activeBlock.text,
      paragraphStyles: activeBlock.paragraphStyles, indentFirstLine: activeBlock.indentFirstLine,
    }
    updateBlock(activeBlock.id, { text, paragraphStyles, indentFirstLine, card: details, otherCards: [...remaining, archive] })
    undoStack.current = []
    redoStack.current = []
    lastPush.current = { time: 0, blockId: '' }
    setSelection({ start: 0, end: 0 })
    editorRef.current?.setValue(text, 0)
  }

  function saveAnswerCard(details: AnswerCardDetails) {
    if (cardDialog === 'add') {
      swapAnswerCard({
        ...details,
        id: crypto.randomUUID(),
        text: '',
        paragraphStyles: [{ kind: 'normal', align: 'left', indentCells: activeBlock.indentFirstLine ? 2 : 0 }],
        indentFirstLine: activeBlock.indentFirstLine,
      }, otherCards)
    } else {
      updateBlock(activeBlock.id, { card: details })
    }
    setCardDialog(null)
  }

  const handleCapacity = useCallback(
    (capacity: number) => {
      const value = Math.max(1, Math.min(20000, Math.floor(capacity)))
      updateBlock(activeBlock.id, { capacity: value })
    },
    [activeBlock.id, updateBlock],
  )

  const handleModeChange = useCallback(
    (mode: AnswerSheet['mode']) => {
      if (mode === sheet.mode) return
      const hasContent = sheet.blocks.some((b) => b.text.trim().length > 0)
      if (hasContent && !window.confirm('切换模式会新建答题卡，当前所有作答内容将丢失。确定继续吗？')) return
      const next = createSheet(mode, activeBlock.capacity)
      undoStack.current = []
      redoStack.current = []
      setSheet(next)
      setActiveBlockId(next.blocks[0].id)
      setSelection({ start: 0, end: 0 })
      editorRef.current?.setValue('', 0)
    },
    [activeBlock.capacity, sheet.blocks, sheet.mode],
  )

  const handleReset = useCallback(() => {
    if (!window.confirm('确定要清空当前这道题的作答吗？此操作可以撤销。')) return
    const block = sheetRef.current.blocks.find((b) => b.id === activeBlock.id) ?? activeBlock
    pushHistory(
      { blockId: block.id, text: block.text, caret: selectionRef.current.start, styles: block.paragraphStyles },
      false, // 工具栏动作不并进「打字突发」，否则撤销会把动作前的打字一起撤掉，之后再也拿不回来
    )
    updateBlock(block.id, {
      text: '',
      paragraphStyles: [{ kind: 'normal', align: 'left', indentCells: block.indentFirstLine ? 2 : 0 }],
    })
    setSelection({ start: 0, end: 0 })
    editorRef.current?.setValue('', 0)
    showToast('已清空本题作答')
  }, [activeBlock, pushHistory, showToast, updateBlock])

  const handleFillDemo = useCallback(() => {
    const block = sheetRef.current.blocks.find((b) => b.id === activeBlockIdRef.current) ?? activeBlock
    pushHistory(
      { blockId: block.id, text: block.text, caret: selectionRef.current.start, styles: block.paragraphStyles },
      false, // 工具栏动作不并进「打字突发」，否则撤销会把动作前的打字一起撤掉，之后再也拿不回来
    )
    updateBlock(block.id, {
      text: DEMO_TEXT,
      paragraphStyles: [
        { kind: 'title', align: 'center', indentCells: 0 },
        { kind: 'normal', align: 'left', indentCells: block.indentFirstLine ? 2 : 0 },
        { kind: 'normal', align: 'left', indentCells: block.indentFirstLine ? 2 : 0 },
        { kind: 'normal', align: 'left', indentCells: block.indentFirstLine ? 2 : 0 },
      ],
    })
    setSelection({ start: DEMO_TEXT.length, end: DEMO_TEXT.length })
    requestAnimationFrame(() => editorRef.current?.setValue(DEMO_TEXT, DEMO_TEXT.length))
    showToast('已填入示例答案，可以看到数字、标点、引号、省略号、破折号的排布')
  }, [activeBlock, pushHistory, showToast, updateBlock])

  const handleAddBlock = useCallback(() => {
    const block = appendBlock(sheetRef.current.blocks)
    setSheet((prev) => ({ ...prev, blocks: [...prev.blocks, block] }))
    setActiveBlockId(block.id)
    setSelection({ start: 0, end: 0 })
    requestAnimationFrame(() => editorRef.current?.setValue('', 0))
    showToast(`已添加「${block.title}」`)
  }, [showToast])

  const handleRemoveBlock = useCallback(() => {
    const prev = sheetRef.current
    if (prev.blocks.length <= 1) {
      showToast('至少要保留一道题')
      return
    }
    const id = activeBlockIdRef.current
    const index = prev.blocks.findIndex((b) => b.id === id)
    if (index < 0) return
    if (prev.blocks[index].text.trim().length > 0 && !window.confirm(`「${prev.blocks[index].title}」已有作答，删除后内容会丢失。确定吗？`)) {
      return
    }
    const next = prev.blocks.filter((b) => b.id !== id)
    // 把这道题的历史一并丢掉。留着的话，撤销会弹出一道已经不存在的题目的快照，
    // 把它的文本写进输入层；之后随便按一个键，那段文本就被提交给当前这道题，
    // 覆盖掉它自己的作答。（切模式时也是这么处理整栈的。）
    undoStack.current = undoStack.current.filter((s) => s.blockId !== id)
    redoStack.current = redoStack.current.filter((s) => s.blockId !== id)
    const fallback = next[Math.max(0, index - 1)]
    setSheet({ ...prev, blocks: next })
    setActiveBlockId(fallback.id)
    setSelection({ start: 0, end: 0 })
    requestAnimationFrame(() => editorRef.current?.setValue(fallback.text, fallback.text.length))
    showToast('已删除本题')
  }, [showToast])

  const handleCopy = useCallback(async () => {
    const text = blockToPlainText(activeBlock)
    try {
      await navigator.clipboard.writeText(text)
      showToast('已复制原文（不含方格与自动换行）')
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
      showToast('已复制原文')
    }
  }, [activeBlock, showToast])

  const handleCopyAll = useCallback(async () => {
    const text = sheetToPlainText(sheet)
    try {
      await navigator.clipboard.writeText(text)
      showToast('已复制整卷原文')
    } catch {
      showToast('复制失败，请手动选择文本复制')
    }
  }, [sheet, showToast])

  const handleExportPdf = useCallback(async (exportSheet: AnswerSheet, title?: string) => {
    const container = printRef.current
    const fallbackToPrint = async (reason: string) => {
      if (!container) return
      showToast(`${reason}，改用打印版导出：请在对话框中选择「另存为 PDF」`)
      container.dataset.exporting = 'true'
      try {
        await exportPdfViaPrint(container, exportSheet, { keepIndent: false, title })
      } finally {
        delete container.dataset.exporting
      }
    }

    // 内置字体覆盖不到的生僻字 → 直接换打印版，避免 PDF 里出现空白或豆腐块。
    // 提示里必须带上码点：这些字符常常长得跟普通空格/引号一模一样，
    // 只显示字符本身用户根本看不出要改哪儿。
    const unsupported = findUnsupportedChars(exportSheet.blocks.map((b) => b.text).join(''))
    if (unsupported.length > 0) {
      const more = unsupported.length > 3 ? ` 等 ${unsupported.length} 个` : ''
      await fallbackToPrint(`有 ${describeUnsupportedChars(unsupported)}${more} 内置字体没有字形`)
      return
    }

    try {
      const { exportPdfDirect } = await import('./export/exportPdfDirect')
      await exportPdfDirect(exportSheet, { keepIndent: false, title })
      showToast('已导出 PDF（纯文字，不含方格，可直接下载）')
    } catch (error) {
      await fallbackToPrint(`直接导出失败（${error instanceof Error ? error.message : String(error)}）`)
    }
  }, [showToast])

  const activeMarks = orderReadingMarks(marks, question ? questionReadingSources(question) : [])
    .filter((mark) => !mark.source.startsWith('prompt-') || mark.source === `prompt-${question?.questionIndex ?? 0}`)

  const handleExport = async (format: '图片' | 'Word' | 'PDF') => {
    if (exporting) return
    const frontBlocks = questionBlocks(question, exportContent)
    if (exportContent.notes && activeMarks.length) frontBlocks.push(readingNotesBlock(activeMarks))
    if (exportContent.review && currentCard.review.trim()) {
      frontBlocks.push({ ...createBlock('复盘笔记', 0, false), text: currentCard.review })
    }
    const frontMatter = frontBlocks.length ? { ...sheet, blocks: frontBlocks } : undefined
    const exportSheet = {
      ...sheet,
      blocks: [...frontBlocks, ...(exportContent.answer ? sheet.blocks : [])],
    }
    if (!exportSheet.blocks.length) {
      showToast('请至少勾选一项可导出的内容')
      return
    }
    const withGrid = exportContent.answer && keepExportFormat
    const title = !exportContent.answer && exportSheet.blocks.length === 1 ? exportSheet.blocks[0].title : undefined
    setExporting(true)
    try {
      if (format === 'Word') {
        if (withGrid) {
          const { exportGridDocx } = await import('./export/exportGridDocx')
          await exportGridDocx(doc, geometry, frontMatter, activeBlock.card)
        } else {
          const { exportDocx } = await import('./export/exportDocx')
          await exportDocx(exportSheet, { keepIndent: false, title })
        }
      } else if (format === 'PDF' && !withGrid) {
        await handleExportPdf(exportSheet, title)
        return
      } else {
        const source = exportSourceRef.current
        if (!source) throw new Error('答题卡尚未就绪')
        const { exportImages, exportGridPdf } = await import('./export/exportImages')
        if (format === '图片') await exportImages(source, exportSheet, withGrid, frontMatter)
        else await exportGridPdf(source, geometry, frontMatter)
      }
      showToast(`已导出${format}`)
    } catch (error) {
      showToast(`导出${format}失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setExporting(false)
    }
  }

  const applyParagraphStyle = useCallback(
    (patch: Partial<ParagraphStyle>) => {
      const block = sheetRef.current.blocks.find((b) => b.id === activeBlock.id) ?? activeBlock
      pushHistory(
      { blockId: block.id, text: block.text, caret: selectionRef.current.start, styles: block.paragraphStyles },
      false, // 工具栏动作不并进「打字突发」，否则撤销会把动作前的打字一起撤掉，之后再也拿不回来
    )
      const index = paragraphIndexAt(block.text, selectionRef.current.start)
      const styles = block.paragraphStyles.map((s, i) => {
        if (i !== index) return s
        const merged = { ...s, ...patch }
        if (patch.kind === 'title' || patch.kind === 'subtitle') {
          merged.align = 'center'
          merged.indentCells = 0
        }
        if (patch.kind === 'normal' && merged.align === 'center') {
          merged.align = 'left'
          merged.indentCells = block.indentFirstLine ? 2 : 0
        }
        return merged
      })
      updateBlock(block.id, { paragraphStyles: styles })
    },
    [activeBlock, pushHistory, updateBlock],
  )

  const toggleIndent = useCallback(() => {
    const block = sheetRef.current.blocks.find((b) => b.id === activeBlock.id) ?? activeBlock
    const enabled = !block.indentFirstLine
    pushHistory(
      { blockId: block.id, text: block.text, caret: selectionRef.current.start, styles: block.paragraphStyles },
      false, // 工具栏动作不并进「打字突发」，否则撤销会把动作前的打字一起撤掉，之后再也拿不回来
    )
    updateBlock(block.id, {
      indentFirstLine: enabled,
      paragraphStyles: block.paragraphStyles.map((s) =>
        s.kind === 'normal' && s.align === 'left' ? { ...s, indentCells: enabled ? 2 : 0 } : s,
      ),
    })
  }, [activeBlock, pushHistory, updateBlock])

  const currentParagraphStyle = useMemo(() => {
    const index = paragraphIndexAt(activeBlock.text, selection.start)
    return activeBlock.paragraphStyles[index] ?? { kind: 'normal' as const, align: 'left' as const, indentCells: 0 }
  }, [activeBlock, selection.start])

  // 组件挂载后把焦点交给输入层，用户打开页面就能直接打字。
  // 但只在这 60ms 里用户没先动过手的前提下执行 ——
  // 否则「打开页面立刻点一格」会被这个定时器把光标拽回开头（实测 t+20ms 光标已在第 10 格，t+60ms 被打回 0）。
  useEffect(() => {
    let interacted = false
    const markInteracted = () => {
      interacted = true
    }
    window.addEventListener('pointerdown', markInteracted, true)
    window.addEventListener('keydown', markInteracted, true)
    const timer = window.setTimeout(() => {
      if (!interacted) editorRef.current?.focusAt(0)
    }, 60)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('pointerdown', markInteracted, true)
      window.removeEventListener('keydown', markInteracted, true)
    }
  }, [])

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------

  return (
    <>
      <div className="app" style={cssVars}>
        {/* 按钮在 mousedown 时阻止默认行为，避免抢走答题区的输入焦点
          （只拦 button，下拉框和复选框要保持可点） */}
      <div
        className="toolbar"
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('button')) e.preventDefault()
        }}
      >
          <div className="toolbar-row">
            <button type="button" className="btn" onClick={() => setImportingQuestion(true)}>
              {question ? '编辑题目' : '导入题目'}
            </button>
            {question && (
              <button type="button" className="btn" aria-expanded={showQuestion}
                onClick={() => setShowQuestion((visible) => !visible)}>
                {showQuestion ? '收起题目' : '展开题目'}
              </button>
            )}
            <span className="toolbar-sep" />
            <button type="button" className="btn" onClick={() => void showPracticeDialog('save')}>保存练习</button>
            <button type="button" className="btn" onClick={() => void showPracticeDialog('list')}>我的练习</button>
            {currentPractice && (
              <span className={`practice-autosave${autosaveState === 'failed' && unsaved ? ' practice-autosave--failed' : ''}`}>
                <span role="status" title={autosaveError || undefined}>
                  {autosaveState === 'failed' && unsaved ? `自动保存失败：${autosaveError}`
                    : unsaved || autosaveState === 'saving' ? '正在自动保存…' : '已自动保存'}
                </span>
                {autosaveState === 'failed' && unsaved && (
                  <button type="button" className="btn" onClick={() => void flushAutosave(currentPractice, snapshot)}>重试</button>
                )}
              </span>
            )}
            <button type="button" className="btn" onClick={saveDefaults}
              title="保存当前字数、列数、版式、缩放、阅读栏宽度和导出选项">保存为默认设置</button>
            <span className="toolbar-sep" />
            <button type="button" className="btn" onClick={() => setShowMarkSettings(true)}>标记与批注偏好</button>
            <span className="toolbar-label">模式</span>
            <div className="chip-group">
              <button
                type="button"
                className={`chip${sheet.mode === 'single' ? ' chip--active' : ''}`}
                onClick={() => handleModeChange('single')}
              >
                单题练习
              </button>
              <button
                type="button"
                className={`chip${sheet.mode === 'full' ? ' chip--active' : ''}`}
                onClick={() => handleModeChange('full')}
              >
                整卷模式
              </button>
            </div>

            <span className="toolbar-sep" />
            <span className="toolbar-label">本题字数</span>
            <div className="chip-group">
              {CAPACITY_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`chip${activeBlock.capacity === preset ? ' chip--active' : ''}`}
                  onClick={() => handleCapacity(preset)}
                >
                  {preset}
                </button>
              ))}
              <input
                className="input-num"
                type="number"
                min={1}
                max={20000}
                placeholder="自定义"
                key={`${activeBlock.id}:${activeBlock.capacity}`}
                defaultValue={CAPACITY_PRESETS.includes(activeBlock.capacity) ? '' : activeBlock.capacity}
                onBlur={(event) => {
                  const input = event.currentTarget
                  const value = input.valueAsNumber
                  if (Number.isFinite(value) && value > 0 && Math.floor(value) !== activeBlock.capacity) {
                    handleCapacity(value)
                  } else {
                    input.value = input.defaultValue
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    event.currentTarget.blur()
                  }
                }}
              />
            </div>
          </div>

          {sheet.mode === 'full' && (
            <div className="toolbar-row">
              <span className="toolbar-label">题目</span>
              <div className="block-tabs">
                {sheet.blocks.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    className={`chip${b.id === activeBlock.id ? ' chip--active' : ''}`}
                    onClick={() => {
                      setActiveBlockId(b.id)
                      requestAnimationFrame(() => editorRef.current?.focusAt(0))
                    }}
                  >
                    {b.title}
                    <span style={{ opacity: 0.65, marginLeft: 4 }}>{b.capacity}字</span>
                  </button>
                ))}
                <button
                  type="button"
                  className="chip chip--ghost"
                  onClick={handleAddBlock}
                  title="在最后追加一道题"
                >
                  ＋ 添加题目
                </button>
                <button
                  type="button"
                  className="chip chip--ghost"
                  onClick={handleRemoveBlock}
                  title="删除当前正在作答的这一题"
                >
                  － 删除本题
                </button>
              </div>
            </div>
          )}

          <div className="toolbar-row">
            <button type="button" className="btn" onClick={handleUndo}>
              撤销
            </button>
            <button type="button" className="btn" onClick={handleRedo}>
              重做
            </button>
            <button type="button" className="btn" onClick={handleReset}>
              重置本题
            </button>
            <button type="button" className="btn" onClick={handleFillDemo} title="填入一段示例答案，用来快速查看各类排版规则">
              填入示例
            </button>

            <span className="toolbar-sep" />
            <span className="toolbar-label">段落</span>
            <div className="chip-group">
              <button
                type="button"
                className={`chip${currentParagraphStyle.kind === 'normal' ? ' chip--active' : ''}`}
                onClick={() => applyParagraphStyle({ kind: 'normal' })}
              >
                正文
              </button>
              <button
                type="button"
                className={`chip${currentParagraphStyle.kind === 'title' ? ' chip--active' : ''}`}
                onClick={() => applyParagraphStyle({ kind: 'title' })}
              >
                标题（居中）
              </button>
              <button
                type="button"
                className={`chip${currentParagraphStyle.kind === 'subtitle' ? ' chip--active' : ''}`}
                onClick={() => applyParagraphStyle({ kind: 'subtitle' })}
              >
                副标题
              </button>
              <button
                type="button"
                className={`chip${activeBlock.indentFirstLine ? ' chip--active' : ''}`}
                onClick={toggleIndent}
                title="申论大作文、应用文正文每段空两格；归纳概括等小题通常顶格"
              >
                段首缩进2格
              </button>
            </div>

            <span className="toolbar-sep" />
            <button type="button" className="btn" onClick={handleCopy}>
              复制文本
            </button>
            <span
              className="toolbar-hint"
              title="复制出来的是原始文字。段首缩进属于排版格式而不是空格字符，粘贴到 Word 等外部程序时不会带过去；需要保留答题卡缩进请勾选「保留方格格式」后导出。"
            >
              缩进不随复制带出
            </span>
            {sheet.mode === 'full' && (
              <button type="button" className="btn" onClick={handleCopyAll}>
                复制整卷
              </button>
            )}
            <details className="export-content">
              <summary className="btn">导出内容</summary>
              <div className="export-content-menu" role="group" aria-label="导出内容">
                {([
                  ['prompt', '题干', Boolean(question?.prompt)],
                  ['materials', '材料', Boolean(question?.materials)],
                  ['notes', '标记与笔记', activeMarks.length > 0],
                  ['review', '复盘笔记', Boolean(currentCard.review.trim())],
                  ['answer', '作答', true],
                ] as const).map(([key, label, available]) => (
                  <label key={key}>
                    <input type="checkbox" checked={available && Boolean(exportContent[key])} disabled={exporting || !available}
                      onChange={(event) => {
                        const checked = event.target.checked
                        setExportContent((current) => ({ ...current, [key]: checked }))
                      }} />
                    {label}
                  </label>
                ))}
              </div>
            </details>
            {(['图片', 'Word', 'PDF'] as const).map((format) => (
              <button type="button" className="btn btn--primary" key={format}
                disabled={exporting} onClick={() => void handleExport(format)}>
                导出{format === '图片' ? '' : ' '}{format}
              </button>
            ))}
            <label className="toolbar-label">
              <input type="checkbox" checked={exportContent.answer && keepExportFormat} disabled={exporting || !exportContent.answer}
                onChange={(event) => setKeepExportFormat(event.target.checked)} />
              保留方格格式
            </label>

            <span className="toolbar-sep" />
            <label className="toolbar-label">
              每行格数
              <select
                className="input-num"
                style={{ width: 70, marginLeft: 6 }}
                value={sheet.columns}
                onChange={(e) => setSheet((prev) => ({ ...prev, columns: Number(e.target.value) }))}
              >
                {COLUMN_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label className="toolbar-label">
              纸张
              <select aria-label="纸张" className="input-num" style={{ width: 'auto', marginLeft: 6 }} value={paperSize}
                onChange={(event) => setPaperSize(event.target.value === 'a4' ? 'a4' : 'auto')}>
                <option value="a4">固定 A4</option>
                <option value="auto">自动扩展为 A3</option>
              </select>
            </label>
            <label className="toolbar-label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <input
                type="checkbox"
                checked={!sheet.showTemplate}
                onChange={(e) => setSheet((prev) => ({ ...prev, showTemplate: !e.target.checked }))}
              />
              隐藏模板装饰
            </label>
          </div>

          <div className="toolbar-row answer-card-toolbar">
            <label className="toolbar-label">本题答题卡
              <select aria-label="本题答题卡" value={currentCard.id} onChange={(event) => {
                const selected = otherCards.find((card) => card.id === event.target.value)
                if (selected) swapAnswerCard(selected, otherCards.filter((card) => card.id !== selected.id))
              }}>
                {[currentCard, ...otherCards].slice().sort((a, b) =>
                  (a.sequence ?? 1) - (b.sequence ?? 1))
                  .map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}
              </select>
            </label>
            <button type="button" className="btn" onClick={() => setCardDialog('add')}>＋ 新增答题卡</button>
            <button type="button" className="btn" onClick={() => setCardDialog('edit')}>答题卡设置</button>
          </div>
          <div className="toolbar-row stats">
            <span className="stat">
              已输入 <b>{stats.logical}</b> 字
            </span>
            <span className="stat">
              已占 <b>{stats.occupied}</b> 格
            </span>
            <span className={`stat${stats.remaining < 0 ? ' stat--overflow' : ''}`}>
              剩余 <b>{stats.remaining}</b> 格
            </span>
            <span className="stat">
              目标 <b>{stats.capacity}</b> 格
            </span>
            <div className="progress">
              <div
                className={`progress-fill${stats.overflow ? ' progress-fill--over' : stats.percent > 85 ? ' progress-fill--warn' : ''}`}
                style={{ width: `${stats.percent}%` }}
              />
            </div>
            {stats.overflow && (
              <span className="banner banner--over">
                已超出设定容量 {stats.overflowCells} 格（超出部分已用红色斜纹标记，内容不会被截断）
              </span>
            )}
          </div>
        </div>

        <div className="answer-workspace">
          {question && showQuestion && (
            <QuestionPane question={question} onQuestionChange={selectImportedQuestion}
              zoomOffset={zoomOffset} widthPercent={readerWidth} onWidthChange={setReaderWidth}
              marks={marks} presets={markPresets} notePreferences={notePreferences} markSets={markSets} activeMarkSet={activeMarkSet}
              onMarkSetChange={setMarkSetId} onSaveMarkSet={saveMarkSet}
              onSaveMark={(mark) => updateReadingMarks((current) => current.some((item) => item.id === mark.id)
                ? current.map((item) => item.id === mark.id ? mark : item)
                : [...current, mark])}
              onRemoveMark={(id) => updateReadingMarks((current) => current.filter((mark) => mark.id !== id))} />
          )}
          <div className="sheet-viewport" ref={viewportRef}>
            <div className="sheet-scaler" ref={exportSourceRef} style={{ zoom: scale } as React.CSSProperties}>
              <SheetView
                doc={doc}
                columns={geometry.columns}
                activeBlockId={activeBlock.id}
                tokensByBlockId={tokensByBlockId}
                compoundRules={profile.compoundRules}
                selStart={selection.start}
                selEnd={selection.end}
                caretRow={caret.rowIndex}
                caretColumn={caret.column}
                caretFraction={caret.fraction}
                reviewFitsOnLastPage={reviewFitsOnLastPage}
                review={currentCard.display.review && (
                  <ReviewNotes key={`${activeBlock.id}-${currentCard.id}`} value={currentCard.review}
                    onChange={(review) => updateBlock(activeBlock.id, { card: { ...currentCard, review } })} />
                )}
                card={activeBlock.card}
                onIdentityChange={(field, value) => updateBlock(activeBlock.id, { card: { ...currentCard, [field]: value } })}
                showTemplate={sheet.showTemplate}
                split={isSplit}
                paperLabel={paperLabel}
                interactive
                onPointerDown={handlePointerDown}
              />
            </div>
          </div>
        </div>

        {assistantAvailable && <details className="assistant-settings">
          <summary className="btn">粉笔助手</summary>
          <div className="assistant-settings-panel">
            <button type="button" className="btn" onClick={() => {
              setOpenWebdav(true)
              void showPracticeDialog('list')
            }}>WebDAV 同步</button>
            <button type="button" className="btn" onClick={() => setShowMarkSettings(true)}>标记与批注偏好</button>
            <button type="button" className="btn" onClick={saveDefaults}>保存答题偏好</button>
            {question?.assistantLink && sheet.mode === 'single' && (
              <button type="button" className="btn" disabled={returningAnswer || !activeBlock.text.trim()}
                onClick={async () => {
                  if (!window.confirm('将当前答题卡的答案填入对应粉笔原题，并尝试提交单题批改。继续吗？')) return
                  setReturningAnswer(true)
                  try {
                    await requestFenbiAssistant({
                      action: 'return-answer', link: question.assistantLink, answer: activeBlock.text, submit: true,
                    })
                    setToast('已请求打开粉笔原题，请在粉笔页查看批改提交结果。')
                  } catch (error) {
                    setToast(error instanceof Error ? error.message : '回填请求失败。')
                  } finally {
                    setReturningAnswer(false)
                  }
                }}>提交粉笔批改</button>
            )}
          </div>
        </details>}

        <div className="zoom-bar">
          <button type="button" onClick={() => changeZoom(-0.1)} title="缩小">
            −
          </button>
          <span>{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => changeZoom(0.1)} title="放大">
            ＋
          </button>
          <button type="button" onClick={() => setZoomMode('fit')} title="适应窗口">
            ⤢
          </button>
        </div>

        <EditorSurface
          ref={editorRef}
          text={activeBlock.text}
          tokens={activeLayout.tokens}
          rows={activeLayout.rows}
          blockId={activeBlock.id}
          anchor={{ row: caret.rowIndex, column: caret.column, fraction: caret.fraction }}
          caretOffset={selection.start}
          layoutKey={JSON.stringify([geometry.layout, geometry.cell,
            currentCard.display.instructions ? 'standard' : [
              currentCard.display.title, currentCard.display.identity,
              activeBlock.card && currentCard.display.name ? currentCard.name : '',
            ],
          ])}
          enabled
          onCommit={(text, caretOffset) => handleCommit(activeBlock.id, text, caretOffset)}
          onSelectionChange={(start, end) => setSelection({ start, end })}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onFocusRequest={() => undefined}
        />

          {cardDialog && (
            <AnswerCardDialog adding={cardDialog === 'add'} card={cardDialog === 'add' ? {
              ...currentCard,
              sequence: otherCards.length + 2,
              name: `第 ${otherCards.length + 2} 次练习`,
              review: '',
              display: { ...currentCard.display, name: true, instructions: false },
            } : currentCard} onSave={saveAnswerCard} onClose={() => setCardDialog(null)} />
          )}
          {showMarkSettings && (
            <MarkPresetDialog presets={markPresets} notePreferences={notePreferences}
              onSave={(presets, note) => {
                setReadingPreferences({ presets, note })
                setMarkSets((sets) => sets.map((set) => ({ ...set, marks: syncMarkPresets(set.marks, presets) })))
                setShowMarkSettings(false)
              }}
              onClose={() => setShowMarkSettings(false)} />
          )}
          {practiceDialog && (
            <PracticeDialog mode={practiceDialog} openWebdav={openWebdav}
              name={currentPractice?.name ?? question?.paper?.title ?? '申论练习'}
              current={currentPractice}
              onSave={savePractice} onOpen={openPractice}
              onUpdate={(previous, updated) => {
                if (currentPractice?.id === previous.id && currentPractice.storage === previous.storage) {
                  setCurrentPractice(updated)
                  rememberPracticeLocation(updated)
                }
              }}
              onClose={() => { setPracticeDialog(null); setOpenWebdav(false) }} />
          )}
          {importingQuestion && (
            <QuestionImport
              question={question}
              onSave={(imported) => {
                const samePaper = Boolean(question?.paper && question.paper.sections === imported.paper?.sections)
                if (samePaper && question?.questionIndex !== imported.questionIndex) {
                  selectImportedQuestion(imported.questionIndex ?? 0)
                } else if (!samePaper) {
                  questionAnswers.current.clear()
                  if (imported.paper || !question) {
                    setMarkSets([{ id: 'original', name: '第 1 套标记', marks: [] }])
                    setMarkSetId('original')
                  }
                  if (imported.paper && question) {
                    setCurrentPractice(null)
                    rememberPracticeLocation(null)
                  }
                  const selected = imported.paper?.questions[imported.questionIndex ?? 0]
                  if (selected) updateBlock(activeBlock.id, {
                    capacity: questionCapacity(selected.prompt),
                    title: selected.label,
                  })
                }
                setQuestion(imported)
                setShowQuestion(true)
                setImportingQuestion(false)
              }}
              onClose={() => setImportingQuestion(false)}
            />
          )}
          {toast && <div className="toast">{toast}</div>}
      </div>

      {/*
        打印容器必须放在 .app 之外 —— 打印时整个 .app 会被 display:none 隐藏，
        放在里面会连导出内容一起被隐藏掉。
      */}
      <div className="print-root" ref={printRef} aria-hidden="true" />
    </>
  )
}
