import { useId, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { defaultMarkPresets, markStyles, noteKinds, validMarkPreset } from '../document/readingMarks'
import type { MarkPreset, NoteKind, NotePreferences } from '../document/readingMarks'
import { anchorReadingMark } from '../document/readingOrder'
import { ReadingPopover } from './ReadingPopover'

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
  showParagraphNumbers?: boolean
  indentParagraphs?: boolean
  marks: ReadingMark[]
  noteNumbers: ReadonlyMap<string, number>
  presets: MarkPreset[]
  notePreferences: NotePreferences
  onSave: (mark: ReadingMark) => void
  onRemove: (id: string) => void
}

export function AnnotatedText({ text, source, label, heading, indentParagraphs = false, showParagraphNumbers = false, marks, noteNumbers, presets, notePreferences, onSave, onRemove }: AnnotatedTextProps) {
  const passage = useRef<HTMLDivElement>(null)
  const markElements = useRef(new Map<string, HTMLElement>())
  const noteInput = useId()
  const inlineNotes = useRef(new Map<string, HTMLElement>())
  const [focusedNote, setFocusedNote] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [kind, setKind] = useState<NoteKind>(notePreferences.kind)
  const [note, setNote] = useState('')
  const ownMarks = marks.filter((mark) => mark.source === source)
  const activeMark = overlay?.type === 'note' || overlay?.type === 'edit' ? overlay.mark : null
  const draftMark = activeMark && overlay?.type === 'edit' && !ownMarks.some((mark) => mark.id === activeMark.id)
    ? activeMark : null
  const visibleMarks = draftMark ? [...ownMarks, draftMark] : ownMarks
  const activePreset = validMarkPreset(activeMark?.preset) ? activeMark.preset : defaultMarkPresets[0]
  const activeNumber = activeMark ? noteNumbers.get(activeMark.id) : undefined
  const anchored = visibleMarks.map((mark) => anchorReadingMark(mark, text))
    .filter((mark): mark is ReadingMark => mark !== undefined)
    .sort((a, b) => a.start - b.start)

  const activeSourceExists = activeMark && anchored.some((mark) => mark.id === activeMark.id)

  function sourceText(range: Range) {
    const fragment = range.cloneContents()
    fragment.querySelectorAll('[data-inline-note]').forEach((element) => element.remove())
    return fragment.textContent ?? ''
  }

  function readSelection() {
    const root = passage.current
    const selected = window.getSelection()
    if (!root || !selected || selected.isCollapsed || selected.rangeCount === 0) return
    const range = selected.getRangeAt(0)
    if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return
    const insideNote = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest('[data-inline-note]')
    if (insideNote(range.startContainer) || insideNote(range.endContainer)) return
    const prefix = range.cloneRange()
    prefix.selectNodeContents(root)
    prefix.setEnd(range.startContainer, range.startOffset)
    const raw = sourceText(range)
    const quote = raw.trim()
    if (!quote) return
    const start = sourceText(prefix).length + raw.length - raw.trimStart().length
    setOverlay({ type: 'selection', anchor: range.cloneRange(), selection: { start, end: start + quote.length, quote } })
  }

  function markSelection(selection: Selection, preset?: MarkPreset) {
    const existing = anchored.find((mark) => mark.start === selection.start && mark.end === selection.end)
    if (existing && (!preset || existing.preset?.id === preset.id)) return existing
    return { ...selection, id: crypto.randomUUID(), source, label, preset: preset ?? presets.find((item) => item.id === notePreferences.presetId) ?? presets[0] }
  }

  function close() {
    setOverlay(null)
  }

  function beginNote(mark: ReadingMark, anchor: Element | Range) {
    setOverlay({ type: 'edit', anchor, mark })
    setNote(mark.note?.text ?? '')
    setKind(mark.note?.kind ?? notePreferences.kind)
    window.getSelection()?.removeAllRanges()
  }

  function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (overlay?.type !== 'edit' || !note.trim()) return
    const mark = { ...overlay.mark, note: { kind, text: note.trim() } }
    onSave(mark)
    setFocusedNote(mark.id)
    close()
  }

  let paragraphStart = true
  let indentIndex = 0
  function renderedText(value: string): ReactNode {
    if (!indentParagraphs || !value) return value
    const segments: ReactNode[] = []
    for (const text of value.split(/(\n)/)) {
      if (!text) continue
      if (text === '\n') {
        paragraphStart = true
      } else if (paragraphStart && text.trim()) {
        indentIndex++
        segments.push(<span className="reading-paragraph-indent" aria-hidden="true"
          data-paragraph={showParagraphNumbers ? `P${indentIndex}` : undefined} key={indentIndex} />)
        paragraphStart = false
      }
      segments.push(text)
    }
    return segments
  }

  const notesByOffset = new Map<number, ReadingMark[]>()
  for (const mark of anchored) {
    if (!mark.note) continue
    const nextBreak = text.indexOf('\n', mark.end)
    let offset = nextBreak < 0 ? text.length : nextBreak
    // If the paragraph boundary falls inside another marked selection, keep that selection intact.
    for (const neighbor of anchored) {
      if (neighbor.start < offset && neighbor.end > offset) offset = neighbor.end
    }
    const notes = notesByOffset.get(offset) ?? []
    notes.push(mark)
    notesByOffset.set(offset, notes)
  }

  const fragments: ReactNode[] = []
  const appendNotes = (offset: number) => {
    const notes = notesByOffset.get(offset)
    if (!notes) return
    notesByOffset.delete(offset)
    fragments.push(<span className="reading-inline-notes" data-inline-note key={`notes-${offset}`}>
      {notes.map((mark) => (
        <span key={mark.id} id={`${noteInput}-note-${mark.id}`}
          ref={(element) => {
            if (element) inlineNotes.current.set(mark.id, element)
            else inlineNotes.current.delete(mark.id)
          }}
          tabIndex={-1}
          className={`reading-inline-note${focusedNote === mark.id ? ' reading-inline-note--active' : ''}`}
          onMouseEnter={() => setFocusedNote(mark.id)} onMouseLeave={() => setFocusedNote(null)}
          style={{ '--mark-color': mark.preset?.color ?? defaultMarkPresets[0].color } as CSSProperties}>
          <span className="reading-inline-note-header">
            <button className="reading-inline-source" type="button" title="定位原文"
              onClick={() => {
                setFocusedNote(mark.id)
                const anchor = markElements.current.get(mark.id)
                anchor?.focus({ preventScroll: true })
                anchor?.scrollIntoView({ block: 'nearest' })
              }}><span className="reading-number">{noteNumbers.get(mark.id)}</span>{mark.note?.kind}</button>
            <button type="button" className="reading-icon-button" onClick={(event) => beginNote(mark, event.currentTarget)}
              aria-label={`编辑批注 ${noteNumbers.get(mark.id)}`}>编辑</button>
          </span>
          <span className="reading-inline-note-text">{mark.note?.text}</span>
        </span>
      ))}
    </span>)
  }

  const appendSource = (from: number, to: number) => {
    for (const offset of [...notesByOffset.keys()].sort((a, b) => a - b)) {
      if (offset < from || offset > to) continue
      fragments.push(renderedText(text.slice(from, offset)))
      appendNotes(offset)
      from = offset
    }
    fragments.push(renderedText(text.slice(from, to)))
  }

  function openMark(mark: ReadingMark, anchor: HTMLElement) {
    const inlineNote = inlineNotes.current.get(mark.id)
    if (inlineNote) {
      close()
      setFocusedNote(mark.id)
      inlineNote.focus({ preventScroll: true })
      inlineNote.scrollIntoView({ block: 'nearest' })
    } else {
      setOverlay({ type: 'note', anchor, mark })
    }
  }

  const boundaries = [...new Set(anchored.flatMap((mark) => [mark.start, mark.end]))].sort((a, b) => a - b)
  let cursor = 0
  for (let index = 0; index < boundaries.length - 1; index++) {
    const start = boundaries[index]
    const end = boundaries[index + 1]
    const covering = anchored.filter((mark) => mark.start <= start && end <= mark.end)
    if (!covering.length) continue
    appendSource(cursor, start)
    const content = covering.reduceRight<ReactNode>((child, mark) => {
      const preset = validMarkPreset(mark.preset) ? mark.preset : defaultMarkPresets[0]
      const first = start === mark.start
      const last = end === mark.end
      const number = last ? noteNumbers.get(mark.id) : undefined
      const active = activeMark?.id === mark.id || focusedNote === mark.id
      return <mark key={`${mark.id}-${start}`} ref={first ? (element) => {
        if (element) markElements.current.set(mark.id, element)
        else markElements.current.delete(mark.id)
      } : undefined}
        className={`reading-mark mark-${preset.style}${number ? ' reading-mark--note' : ''}${active ? ' reading-mark--active' : ''}`}
        data-meaning={first ? preset.label : undefined} data-note-number={number}
        style={{ '--mark-color': preset.color } as CSSProperties}
        tabIndex={first ? 0 : undefined} role={first ? 'button' : undefined}
        aria-label={first ? `${mark.note ? '查看批注' : '查看标记'}：${mark.quote}` : undefined}
        onClick={(event) => {
          if (!window.getSelection()?.isCollapsed) return
          event.stopPropagation()
          openMark(mark, markElements.current.get(mark.id) ?? event.currentTarget)
        }}
        onKeyDown={(event) => {
          if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            openMark(mark, event.currentTarget)
          }
        }}>{child}{last && preset.style === 'transition' && <span className="reading-transition-symbol" aria-hidden="true" />}</mark>
    }, renderedText(text.slice(start, end)))
    fragments.push(content)
    cursor = end
  }
  appendSource(cursor, text.length)

  return <div className="reading-text">
    <header className="reading-heading">
      <h2>{heading}</h2>
      {ownMarks.length > 0 && <button type="button" className="reading-index-button"
        onClick={(event) => setOverlay({ type: 'index', anchor: event.currentTarget })}>标记与批注 <b>{ownMarks.length}</b></button>}
    </header>
    <div ref={passage} className="reading-passage" tabIndex={0}
      onMouseUp={readSelection} onKeyUp={readSelection} onTouchEnd={readSelection}>{fragments}</div>
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
                style={{ '--mark-color': preset.color } as CSSProperties}>{preset.label}{preset.style === 'transition' && <span className="reading-transition-symbol" aria-hidden="true" />}</span>
            </button>
          ))}
        </div>
        <button type="button" className="reading-popover-primary" onClick={() => {
          const mark = markSelection(overlay.selection)
          if (mark) beginNote(mark, overlay.anchor)
        }}>写批注</button>
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
        {overlay.mark.note && <label className="reading-note-kind">标记样式
          <select value={overlay.mark.preset?.id ?? ''} onChange={(event) => {
            const preset = presets.find((item) => item.id === event.target.value)
            if (preset) setOverlay({ ...overlay, mark: { ...overlay.mark, preset } })
          }}>
            <option value="" disabled>请选择</option>
            {overlay.mark.preset && !presets.some((item) => item.id === overlay.mark.preset?.id)
              && <option value={overlay.mark.preset.id}>{overlay.mark.preset.label}</option>}
            {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
          </select>
        </label>}
        <label className="reading-sr-only" htmlFor={noteInput}>笔记内容</label>
        <textarea id={noteInput} value={note} rows={3} autoFocus
          placeholder="写下要点或改写这段话" onChange={(event) => setNote(event.target.value)} />
        <div className="reading-card-actions">
          <button type="submit" className="reading-popover-primary" disabled={!note.trim()}>保存批注</button>
          {overlay.mark.note && <button type="button" className="btn" onClick={() => {
            onSave({ ...overlay.mark, note: undefined })
            close()
          }}>删除批注</button>}
          {overlay.mark.note && <button type="button" className="btn"
            onClick={() => { onRemove(overlay.mark.id); close() }}>删除标记</button>}
        </div>
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
          {[...anchored.filter((mark) => mark.id !== draftMark?.id),
            ...ownMarks.filter((mark) => !anchored.some((anchor) => anchor.id === mark.id))].map((mark) => (
            <button type="button" key={mark.id} onClick={() => {
              const anchor = markElements.current.get(mark.id)
              anchor?.scrollIntoView({ block: 'nearest' })
              if (anchor) openMark(mark, anchor)
              else setOverlay({ type: 'note', anchor: overlay.anchor, mark })
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
