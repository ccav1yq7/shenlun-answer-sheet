import { useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { AnnotatedText } from './AnnotatedText'
import type { ReadingMark } from './AnnotatedText'
import type { ImportedQuestion } from './QuestionImport'

interface QuestionPaneProps {
  question: ImportedQuestion
  onQuestionChange: (index: number) => void
  zoomOffset: number
  widthPercent: number
  onWidthChange: (percent: number) => void
  marks: ReadingMark[]
  onSaveMark: (mark: ReadingMark) => void
  onRemoveMark: (id: string) => void
}

function materialSections(text: string) {
  const headings = [...text.matchAll(/^\s*(材料\s*[一二三四五六七八九十\d]+)[ \t]*$/gm)]
  if (!headings.length || text.slice(0, headings[0].index).trim()) return []
  return headings.map((heading, index) => ({
    label: heading[1].replace(/\s/g, ''),
    text: text.slice(heading.index + heading[0].length, headings[index + 1]?.index).trim(),
  })).filter((section) => section.text)
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

export function QuestionPane({ question, onQuestionChange, zoomOffset, widthPercent, onWidthChange, marks, onSaveMark, onRemoveMark }: QuestionPaneProps) {
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

  const prompt = questions.length > 1 ? questions[questionIndex]?.prompt ?? question.prompt : question.prompt

  return <>
    <aside ref={pane} className="question-pane" aria-label="题目与材料" tabIndex={0}
      style={{ '--question-width': `calc(${widthPercent}% + ${zoomOffset}px)` } as CSSProperties}>
      <div className="question-pane-tabs">
        {questions.length > 1 && <Tabs label="切换题目" items={questions.map((item) => item.label)}
          value={questionIndex} onChange={onQuestionChange} panel="question-prompt-panel" />}
        {sections.length > 0 && <Tabs label="切换材料" items={sections.map((item) => item.label)}
          value={materialIndex} onChange={(index) => setSelectedMaterial({ question: questionIndex, index })}
          panel="question-material-panel" />}
      </div>
      <p className="reading-hint">选中文字可标记或写笔记</p>
      <div className="question-prompt-content" id="question-prompt-panel"
        role={questions.length > 1 ? 'tabpanel' : undefined}
        aria-labelledby={questions.length > 1 ? `question-prompt-panel-tab-${questionIndex}` : undefined}>
        <h2>题干</h2>
        <AnnotatedText key={`prompt-${questionIndex}`} text={prompt} source={`prompt-${questionIndex}`}
          label={questions[questionIndex]?.label ?? '题干'} marks={marks} onSave={onSaveMark} onRemove={onRemoveMark} />
      </div>
      {(sections[materialIndex] || question.materials) && (
        <div className="question-material-content" id="question-material-panel" key={materialIndex}
          role={sections.length > 0 ? 'tabpanel' : undefined}
          aria-labelledby={sections.length > 0 ? `question-material-panel-tab-${materialIndex}` : undefined}
          tabIndex={0}>
          <h2>{sections[materialIndex]?.label ?? '材料'}</h2>
          <AnnotatedText text={sections[materialIndex]?.text ?? question.materials}
            source={`material-${sections[materialIndex]?.label ?? 'all'}`}
            label={sections[materialIndex]?.label ?? '材料'} marks={marks} onSave={onSaveMark} onRemove={onRemoveMark} />
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
