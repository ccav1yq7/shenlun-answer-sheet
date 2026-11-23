import { useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { AnnotatedText } from './AnnotatedText'
import type { MarkPreset, NotePreferences } from '../document/readingMarks'
import { materialSections, orderReadingMarks, questionReadingSources } from '../document/readingOrder'
import type { ReadingMark } from './AnnotatedText'
import type { ReadingMarkSet } from '../document/practiceStore'
import type { ImportedQuestion } from './QuestionImport'

interface QuestionPaneProps {
  question: ImportedQuestion
  onQuestionChange: (index: number) => void
  zoomOffset: number
  widthPercent: number
  onWidthChange: (percent: number) => void
  marks: ReadingMark[]
  markSets: ReadingMarkSet[]
  activeMarkSet: ReadingMarkSet
  onMarkSetChange: (id: string) => void
  onSaveMarkSet: (name: string, create: boolean) => void
  presets: MarkPreset[]
  notePreferences: NotePreferences
  onSaveMark: (mark: ReadingMark) => void
  onRemoveMark: (id: string) => void
}

function Tabs({ label, items, value, onChange, panel }: {
  label: string
  items: string[]
  value: number
  onChange: (index: number) => void
  panel: string
}) {
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : event.key === 'ArrowLeft' ? (index + items.length - 1) % items.length
      : event.key === 'ArrowRight' ? (index + 1) % items.length : null
    if (next === null) return
    event.preventDefault()
    onChange(next)
    event.currentTarget.parentElement?.querySelectorAll('button')[next]?.focus()
  }

  return <div className="question-tabs" role="tablist" aria-label={label}>
    {items.map((item, index) => (
      <button type="button" role="tab" id={`${panel}-tab-${index}`} key={index}
        aria-selected={value === index} aria-controls={panel} tabIndex={value === index ? 0 : -1}
        onClick={() => onChange(index)} onKeyDown={(event) => onKeyDown(event, index)}>
        {item}
      </button>
    ))}
  </div>
}

const readingDisplayKey = 'shenlun-reading-display-v1'
const readingOptions = {
  fontSize: [14, 16, 18, 20, 22, 24],
  lineHeight: [1.4, 1.6, 1.75, 2, 2.2],
  paragraphGap: [0, 4, 8, 12, 16, 24],
}
const promptColors = {
  '#f6f8fb': '浅蓝灰',
  '#ffffff': '白色',
  '#f9f3e7': '米色',
  '#edf5ef': '浅绿',
  '#f3eff9': '浅紫',
}
const readingDefaults = { fontSize: 16, lineHeight: 1.75, paragraphGap: 8, promptColor: '#f6f8fb', paragraphNumbers: false }

function readDisplaySettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(readingDisplayKey) ?? '{}') ?? {}
    return {
      fontSize: readingOptions.fontSize.includes(saved.fontSize) ? Number(saved.fontSize) : readingDefaults.fontSize,
      lineHeight: readingOptions.lineHeight.includes(saved.lineHeight) ? Number(saved.lineHeight) : readingDefaults.lineHeight,
      paragraphGap: readingOptions.paragraphGap.includes(saved.paragraphGap) ? Number(saved.paragraphGap) : readingDefaults.paragraphGap,
      promptColor: Object.prototype.hasOwnProperty.call(promptColors, saved.promptColor) ? String(saved.promptColor) : readingDefaults.promptColor,
      paragraphNumbers: typeof saved.paragraphNumbers === 'boolean'
        ? saved.paragraphNumbers : localStorage.getItem('shenlun-paragraph-numbers') === '1',
    }
  } catch {
    return readingDefaults
  }
}

export function QuestionPane({ question, onQuestionChange, zoomOffset, widthPercent, onWidthChange, marks, markSets, activeMarkSet, onMarkSetChange, onSaveMarkSet, presets, notePreferences, onSaveMark, onRemoveMark }: QuestionPaneProps) {
  const [markSetEdit, setMarkSetEdit] = useState<{ create: boolean; name: string } | null>(null)
  const [display, setDisplay] = useState(readDisplaySettings)
  function updateDisplay(patch: Partial<typeof readingDefaults>) {
    const next = { ...display, ...patch }
    setDisplay(next)
    try { localStorage.setItem(readingDisplayKey, JSON.stringify(next)) } catch { /* Session only. */ }
  }
  const sections = useMemo(() => materialSections(question.materials), [question.materials])
  const questions = question.paper?.questions ?? []
  const questionIndex = question.questionIndex ?? 0
  const [selectedMaterial, setSelectedMaterial] = useState<{ question: number; index: number } | null>(null)
  const materialReference = question.prompt.match(/(?:资料|材料)\s*([一二三四五六七八九十\d]+)/)?.[1]
  const ordinal = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  const matchingMaterial = sections.findIndex(({ label }) => {
    const id = label.replace('材料', '')
    return id === materialReference
      || (materialReference !== undefined && (ordinal[Number(id)] === materialReference || String(ordinal.indexOf(id)) === materialReference))
  })
  const materialIndex = selectedMaterial?.question === questionIndex
    ? Math.min(selectedMaterial.index, sections.length - 1) : Math.max(0, matchingMaterial)
  const pane = useRef<HTMLElement>(null)
  const drag = useRef<{ pointer: number; x: number; width: number; available: number } | null>(null)

  function resize(width: number, available: number) {
    const bounded = Math.min(available * 0.72, Math.max(Math.min(240, available * 0.3), width))
    onWidthChange((bounded - zoomOffset) * 100 / available)
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    const available = pane.current?.parentElement?.clientWidth
    if (!available || !pane.current || event.button !== 0) return
    event.preventDefault()
    drag.current = { pointer: event.pointerId, x: event.clientX, width: pane.current.offsetWidth, available }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const orderedMarks = useMemo(() => orderReadingMarks(marks, questionReadingSources(question)), [marks, question])
  const noteNumbers = useMemo(() => new Map(orderedMarks.filter((mark) => mark.note)
    .map((mark, index) => [mark.id, index + 1])), [orderedMarks])

  const prompt = questions.length > 1 ? questions[questionIndex]?.prompt ?? question.prompt : question.prompt

  return <>
    <aside ref={pane} className="question-pane" aria-label="题目与材料" tabIndex={0}
      style={{
        '--question-width': `calc(${widthPercent}% + ${zoomOffset}px)`,
        '--reading-font-size': `${display.fontSize}px`,
        '--reading-line-height': display.lineHeight,
        '--reading-paragraph-gap': `${display.paragraphGap}px`,
        '--reading-prompt-color': display.promptColor,
      } as CSSProperties}>
      <div className="question-pane-tabs">
        {questions.length > 1 && <Tabs label="切换题目" items={questions.map((item) => item.label)}
          value={questionIndex} onChange={onQuestionChange} panel="question-prompt-panel" />}
        {sections.length > 0 && <Tabs label="切换材料" items={sections.map((item) => item.label)}
          value={materialIndex} onChange={(index) => setSelectedMaterial({ question: questionIndex, index })}
          panel="question-material-panel" />}
      </div>
      <div className="reading-mark-sets">
        <label>标记方案
          <select aria-label="切换标记方案" value={activeMarkSet.id} onChange={(event) => {
            onMarkSetChange(event.target.value)
            setMarkSetEdit(null)
          }}>
            {markSets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}
          </select>
        </label>
        <button className="btn" type="button" onClick={() => {
          let number = markSets.length + 1
          while (markSets.some((set) => set.name === `第 ${number} 套标记`)) number++
          setMarkSetEdit({ create: true, name: `第 ${number} 套标记` })
        }}>新增标记方案</button>
        <button className="btn" type="button" onClick={() => setMarkSetEdit({
          create: false, name: activeMarkSet.name,
        })}>重命名</button>
      </div>
      {markSetEdit && <form className="reading-mark-sets" onSubmit={(event) => {
        event.preventDefault()
        const name = markSetEdit.name.trim()
        if (!name) return
        onSaveMarkSet(name, markSetEdit.create)
        setMarkSetEdit(null)
      }}>
        <label>方案名称
          <input autoFocus required maxLength={40} value={markSetEdit.name}
            onChange={(event) => setMarkSetEdit({ ...markSetEdit, name: event.target.value })} />
        </label>
        <button type="submit" className="btn btn--primary">保存方案</button>
        <button type="button" className="btn" onClick={() => setMarkSetEdit(null)}>取消</button>
      </form>}
      <div className="reading-options">
        <p className="reading-hint">选中文字可标记或写笔记</p>
        <details className="reading-display-settings">
          <summary className="btn">显示设置</summary>
          <div className="reading-display-fields">
            <label>字号
              <select value={display.fontSize} onChange={(event) => updateDisplay({ fontSize: Number(event.target.value) })}>
                {readingOptions.fontSize.map((size) => <option key={size} value={size}>{size} px</option>)}
              </select>
            </label>
            <label>段内行距
              <select value={display.lineHeight} onChange={(event) => updateDisplay({ lineHeight: Number(event.target.value) })}>
                {readingOptions.lineHeight.map((height) => <option key={height} value={height}>{height} 倍</option>)}
              </select>
            </label>
            <label>段间距
              <select value={display.paragraphGap} onChange={(event) => updateDisplay({ paragraphGap: Number(event.target.value) })}>
                {readingOptions.paragraphGap.map((gap) => <option key={gap} value={gap}>{gap} px</option>)}
              </select>
            </label>
            <label>题干底色
              <select value={display.promptColor} onChange={(event) => updateDisplay({ promptColor: event.target.value })}>
                {Object.entries(promptColors).map(([color, name]) => <option key={color} value={color}>{name}</option>)}
              </select>
            </label>
            <label><input type="checkbox" checked={display.paragraphNumbers}
              onChange={(event) => updateDisplay({ paragraphNumbers: event.target.checked })} />材料段落编号</label>
          </div>
        </details>
      </div>
      <div className="question-prompt-content" id="question-prompt-panel"
        role={questions.length > 1 ? 'tabpanel' : undefined}
        aria-labelledby={questions.length > 1 ? `question-prompt-panel-tab-${questionIndex}` : undefined}>
        <AnnotatedText key={`${activeMarkSet.id}-prompt-${questionIndex}`} text={prompt} source={`prompt-${questionIndex}`}
          heading="题干" label={questions[questionIndex]?.label ?? '题干'} marks={marks} noteNumbers={noteNumbers} presets={presets} notePreferences={notePreferences} onSave={onSaveMark} onRemove={onRemoveMark} />
      </div>
      {(sections[materialIndex] || question.materials) && (
        <div className="question-material-content" id="question-material-panel" key={materialIndex}
          role={sections.length > 0 ? 'tabpanel' : undefined}
          aria-labelledby={sections.length > 0 ? `question-material-panel-tab-${materialIndex}` : undefined}
          tabIndex={0}>
          <AnnotatedText key={activeMarkSet.id} indentParagraphs showParagraphNumbers={display.paragraphNumbers} text={sections[materialIndex]?.text ?? question.materials}
            source={`material-${sections[materialIndex]?.label ?? 'all'}`}
            heading={sections[materialIndex]?.label ?? '材料'}
            label={sections[materialIndex]?.label ?? '材料'} marks={marks} noteNumbers={noteNumbers} presets={presets} notePreferences={notePreferences} onSave={onSaveMark} onRemove={onRemoveMark} />
        </div>
      )}
    </aside>
    <div className="question-divider" role="separator" aria-label="调整题目栏宽度" aria-orientation="vertical"
      tabIndex={0} onPointerDown={startDrag}
      onPointerMove={(event) => {
        const current = drag.current
        if (current && current.pointer === event.pointerId) {
          resize(current.width + event.clientX - current.x, current.available)
        }
      }}
      onLostPointerCapture={() => { drag.current = null }}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        const available = pane.current?.parentElement?.clientWidth
        if (!available || !pane.current) return
        event.preventDefault()
        resize(pane.current.offsetWidth + (event.key === 'ArrowLeft' ? -24 : 24), available)
      }} />
  </>
}
