import { useId, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { defaultMarkPresets, markStyles, validMarkPreset } from '../document/readingMarks'
import type { MarkPreset } from '../document/readingMarks'
import { ReadingPopover } from './ReadingPopover'

export const noteKinds = ['提炼', '改写', '随记'] as const
export type NoteKind = typeof noteKinds[number]

export interface ReadingMark {
  id: string
  source: string
  label: string
  start: number
  end: number
  quote: string
  preset?: MarkPreset
  note?: { kind: NoteKind; text: string }
}

type Selection = Pick<ReadingMark, 'start' | 'end' | 'quote'>
type Overlay =
  | { type: 'selection'; anchor: Range; selection: Selection }
  | { type: 'note' | 'edit'; anchor: Element | Range; mark: ReadingMark }
  | { type: 'index'; anchor: Element }

interface AnnotatedTextProps {
  text: string
  source: string
  label: string
  heading: string
  marks: ReadingMark[]
  presets: MarkPreset[]
  onSave: (mark: ReadingMark) => void
  onRemove: (id: string) => void
}

export function AnnotatedText({ text, source, label, heading, marks, presets, onSave, onRemove }: AnnotatedTextProps) {
  const passage = useRef<HTMLParagraphElement>(null)
  const markElements = useRef(new Map<string, HTMLElement>())
  const noteInput = useId()
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [kind, setKind] = useState<NoteKind>('提炼')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const ownMarks = marks.filter((mark) => mark.source === source)
  const activeMark = overlay?.type === 'note' || overlay?.type === 'edit' ? overlay.mark : null
  const draftMark = activeMark && overlay?.type === 'edit' && !ownMarks.some((mark) => mark.id === activeMark.id)
    ? activeMark : null
  const visibleMarks = draftMark ? [...ownMarks, draftMark] : ownMarks
  const noteNumbers = new Map((draftMark ? [...marks, draftMark] : marks)
    .filter((mark) => mark.note || (overlay?.type === 'edit' && mark.id === activeMark?.id))
    .map((mark, index) => [mark.id, index + 1]))
  const activePreset = validMarkPreset(activeMark?.preset) ? activeMark.preset : defaultMarkPresets[0]
  const activeNumber = activeMark ? noteNumbers.get(activeMark.id) : undefined
  const anchored = visibleMarks.flatMap((mark) => {
    if (text.slice(mark.start, mark.end) === mark.quote) return [mark]
    const start = text.indexOf(mark.quote)
    return start >= 0 && start === text.lastIndexOf(mark.quote)
      ? [{ ...mark, start, end: start + mark.quote.length }] : []
  }).sort((a, b) => a.start - b.start)

  const activeSourceExists = activeMark && anchored.some((mark) => mark.id === activeMark.id)

  function readSelection() {
    const root = passage.current
    const selected = window.getSelection()
    if (!root || !selected || selected.isCollapsed || selected.rangeCount === 0) return
    const range = selected.getRangeAt(0)
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return
    const prefix = range.cloneRange()
    prefix.selectNodeContents(root)
    prefix.setEnd(range.startContainer, range.startOffset)
    const raw = range.toString()
    const quote = raw.trim()
    if (!quote) return
    const start = prefix.toString().length + raw.length - raw.trimStart().length
    setOverlay({ type: 'selection', anchor: range.cloneRange(), selection: { start, end: start + quote.length, quote } })
    setMessage('')
  }

  function markSelection(selection: Selection, preset?: MarkPreset) {
    const existing = anchored.find((mark) => mark.start === selection.start && mark.end === selection.end)
    if (existing) return preset ? { ...existing, preset } : existing
    if (anchored.some((mark) => mark.start < selection.end && mark.end > selection.start)) {
      setMessage('这段文字与已有标记重叠，可点原标记编辑。')
      return null
    }
    return { ...selection, id: crypto.randomUUID(), source, label, preset: preset ?? presets[0] }
  }

  function close() {
    setOverlay(null)
    setMessage('')
  }

  function beginNote(mark: ReadingMark, anchor: Element | Range) {
    setOverlay({ type: 'edit', anchor, mark })
    setNote(mark.note?.text ?? '')
    setKind(mark.note?.kind ?? '提炼')
    window.getSelection()?.removeAllRanges()
  }

  function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (overlay?.type !== 'edit' || !note.trim()) return
    const mark = { ...overlay.mark, note: { kind, text: note.trim() } }
    onSave(mark)
    setOverlay({ ...overlay, type: 'note', mark })
  }

  const fragments: ReactNode[] = []
  let cursor = 0
  for (const mark of anchored) {
    if (mark.start < cursor) continue
    const preset = validMarkPreset(mark.preset) ? mark.preset : defaultMarkPresets[0]
    const number = noteNumbers.get(mark.id)
    const active = activeMark?.id === mark.id
    fragments.push(text.slice(cursor, mark.start))
    fragments.push(
      <mark key={mark.id} ref={(element) => {
        if (element) markElements.current.set(mark.id, element)
        else markElements.current.delete(mark.id)
      }} className={`reading-mark mark-${preset.style}${number ? ' reading-mark--note' : ''}${active ? ' reading-mark--active' : ''}`}
        data-meaning={preset.label} data-note-number={number} style={{ '--mark-color': preset.color } as CSSProperties}
        tabIndex={0} role="button" aria-expanded={active} aria-label={`${mark.note ? '查看批注' : '查看标记'}：${mark.quote}`}
        onClick={(event) => {
          if (window.getSelection()?.isCollapsed) setOverlay({ type: 'note', anchor: event.currentTarget, mark })
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setOverlay({ type: 'note', anchor: event.currentTarget, mark })
          }
        }}>{mark.quote}</mark>,
    )
    cursor = mark.end
  }
  fragments.push(text.slice(cursor))

  return <div className="reading-text">
    <header className="reading-heading">
      <h2>{heading}</h2>
      {ownMarks.length > 0 && <button type="button" className="reading-index-button"
        onClick={(event) => setOverlay({ type: 'index', anchor: event.currentTarget })}>标记与批注 <b>{ownMarks.length}</b></button>}
    </header>
    <p ref={passage} className="reading-passage" tabIndex={0}
      onMouseUp={readSelection} onKeyUp={readSelection} onTouchEnd={readSelection}>{fragments}</p>
    {overlay && <ReadingPopover anchor={overlay.anchor} onClose={close}
      compact={overlay.type === 'selection'}
      connection={activeMark && activeSourceExists ? {
        color: activePreset.color,
        resolveSource: () => markElements.current.get(activeMark.id),
      } : undefined}
      label={overlay.type === 'selection' ? '选中文字操作' : overlay.type === 'index' ? '本节标记与批注' : '原文批注'}>
      {overlay.type === 'selection' && <>
        <div className="reading-preset-palette">
          {presets.map((preset) => (
            <button type="button" className="reading-preset-chip" key={preset.id}
              title={markStyles[preset.style]} aria-label={`标记：${preset.label}`}
              onClick={() => {
                const mark = markSelection(overlay.selection, preset)
                if (mark) {
                  onSave(mark)
                  window.getSelection()?.removeAllRanges()
                  close()
                }
              }}>
              <span className={`reading-mark mark-${preset.style}`}
                style={{ '--mark-color': preset.color } as CSSProperties}>{preset.label}</span>
            </button>
          ))}
        </div>
        <button type="button" className="reading-popover-primary" onClick={() => {
          const mark = markSelection(overlay.selection)
          if (mark) beginNote(mark, overlay.anchor)
        }}>写批注</button>
        {message && <p className="reading-message" role="status">{message}</p>}
      </>}
      {overlay.type === 'edit' && <form className="reading-note-editor" onSubmit={saveNote}>
        <div className="reading-card-header">
          <div className="reading-card-title">
            {activeNumber && <span className="reading-number">{activeNumber}</span>}
            <strong>{overlay.mark.note ? '编辑批注' : '新建批注'}</strong>
          </div>
          <button type="button" className="reading-icon-button" aria-label="关闭批注" onClick={close}>×</button>
        </div>
        <blockquote>{overlay.mark.quote}</blockquote>
        <label className="reading-note-kind">笔记类型
          <select value={kind} onChange={(event) => setKind(event.target.value as NoteKind)}>
            {noteKinds.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="reading-sr-only" htmlFor={noteInput}>笔记内容</label>
        <textarea id={noteInput} value={note} rows={3} autoFocus
          placeholder="写下要点或改写这段话" onChange={(event) => setNote(event.target.value)} />
        <button type="submit" className="reading-popover-primary" disabled={!note.trim()}>保存批注</button>
      </form>}
      {overlay.type === 'note' && <>
        <div className="reading-card-header">
          <div className="reading-card-title">
            {activeNumber && <span className="reading-number">{activeNumber}</span>}
            <strong>{overlay.mark.note?.kind ?? '原文标记'}</strong>
          </div>
          <div className="reading-card-title">
            {activeSourceExists && <button type="button" className="reading-icon-button"
              onClick={() => markElements.current.get(overlay.mark.id)?.scrollIntoView({ block: 'nearest' })}>定位原文</button>}
            <button type="button" className="reading-icon-button" aria-label="关闭批注" onClick={close}>×</button>
          </div>
        </div>
        <blockquote>{overlay.mark.quote}</blockquote>
        {!activeSourceExists && <p className="reading-message">这段摘录在当前正文中已找不到。</p>}
        {overlay.mark.note && <div className="reading-annotation">
          <span>批注</span>
          <p className="reading-note-body">{overlay.mark.note.text}</p>
        </div>}
        <div className="reading-card-actions">
          <label>标记样式
            <select value={overlay.mark.preset?.id ?? ''} onChange={(event) => {
              const chosen = presets.find((item) => item.id === event.target.value)
              if (!chosen) return
              const mark = { ...overlay.mark, preset: chosen }
              onSave(mark)
              setOverlay({ ...overlay, mark })
            }}>
              <option value="" disabled>请选择</option>
              {overlay.mark.preset && !presets.some((item) => item.id === overlay.mark.preset?.id)
                && <option value={overlay.mark.preset.id}>{overlay.mark.preset.label}</option>}
              {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
            </select>
          </label>
          <button type="button" className="btn" onClick={() => beginNote(overlay.mark, overlay.anchor)}>
            {overlay.mark.note ? '编辑批注' : '写批注'}
          </button>
          {overlay.mark.note && <button type="button" className="btn" onClick={() => {
            const mark = { ...overlay.mark, note: undefined }
            onSave(mark)
            setOverlay({ ...overlay, mark })
          }}>删除批注</button>}
          <button type="button" className="btn" onClick={() => { onRemove(overlay.mark.id); close() }}>删除标记</button>
        </div>
      </>}
      {overlay.type === 'index' && <>
        <div className="reading-card-header">
          <strong>本节标记与批注</strong>
          <button type="button" className="reading-icon-button" aria-label="关闭列表" onClick={close}>×</button>
        </div>
        <div className="reading-index">
          {ownMarks.slice().sort((a, b) => a.start - b.start).map((mark) => (
            <button type="button" key={mark.id} onClick={() => {
              const anchor = markElements.current.get(mark.id)
              anchor?.scrollIntoView({ block: 'nearest' })
              setOverlay({ type: 'note', anchor: anchor ?? overlay.anchor, mark })
            }}>
              <span className="reading-card-title">
                {noteNumbers.has(mark.id) && <span className="reading-number"
                  style={{ '--mark-color': mark.preset?.color ?? defaultMarkPresets[0].color } as CSSProperties}>
                  {noteNumbers.get(mark.id)}
                </span>}
                {mark.note?.kind ?? mark.preset?.label ?? '标记'}
              </span>
              <q>{mark.quote}</q>
              {mark.note && <b>{mark.note.text}</b>}
            </button>
          ))}
        </div>
      </>}
    </ReadingPopover>}
  </div>
}
