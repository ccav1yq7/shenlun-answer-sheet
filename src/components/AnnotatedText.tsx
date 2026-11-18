import { useId, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'

export const noteKinds = ['提炼', '改写', '随记'] as const
export type NoteKind = typeof noteKinds[number]

export interface ReadingMark {
  id: string
  source: string
  label: string
  start: number
  end: number
  quote: string
  note?: { kind: NoteKind; text: string }
}

type Selection = Pick<ReadingMark, 'start' | 'end' | 'quote'>

interface AnnotatedTextProps {
  text: string
  source: string
  label: string
  marks: ReadingMark[]
  onSave: (mark: ReadingMark) => void
  onRemove: (id: string) => void
}

export function AnnotatedText({ text, source, label, marks, onSave, onRemove }: AnnotatedTextProps) {
  const passage = useRef<HTMLParagraphElement>(null)
  const noteInput = useId()
  const [selection, setSelection] = useState<Selection | null>(null)
  const [editing, setEditing] = useState<ReadingMark | null>(null)
  const [kind, setKind] = useState<NoteKind>('提炼')
  const [note, setNote] = useState('')
  const [message, setMessage] = useState('')
  const ownMarks = marks.filter((mark) => mark.source === source)
  const anchored = ownMarks.flatMap((mark) => {
    if (text.slice(mark.start, mark.end) === mark.quote) return [mark]
    const start = text.indexOf(mark.quote)
    return start >= 0 && start === text.lastIndexOf(mark.quote)
      ? [{ ...mark, start, end: start + mark.quote.length }] : []
  }).sort((a, b) => a.start - b.start)
  const existing = anchored.find((mark) => selection && mark.start === selection.start && mark.end === selection.end)

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
    setSelection({ start, end: start + quote.length, quote })
    setEditing(null)
    setMessage('')
  }

  function newMark() {
    if (!selection) return null
    if (existing) return existing
    if (anchored.some((mark) => mark.start < selection.end && mark.end > selection.start)) {
      setMessage('这段内容与已有标记重叠，可点按原标记添加笔记。')
      return null
    }
    return { ...selection, id: crypto.randomUUID(), source, label }
  }

  function dismiss() {
    setSelection(null)
    setEditing(null)
    setMessage('')
    window.getSelection()?.removeAllRanges()
  }

  function beginNote(mark: ReadingMark) {
    setSelection(null)
    setEditing(mark)
    setNote(mark.note?.text ?? '')
    setKind(mark.note?.kind ?? '提炼')
    setMessage('')
    window.getSelection()?.removeAllRanges()
  }

  function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing || !note.trim()) return
    onSave({ ...editing, note: { kind, text: note.trim() } })
    dismiss()
  }

  const fragments: ReactNode[] = []
  let cursor = 0
  for (const mark of anchored) {
    if (mark.start < cursor) continue
    fragments.push(text.slice(cursor, mark.start))
    fragments.push(
      <mark key={mark.id} className={mark.note ? 'reading-mark reading-mark--note' : 'reading-mark'}
        tabIndex={0} role="button" aria-label={`${mark.note ? '编辑笔记' : '编辑标记'}：${mark.quote}`}
        onClick={() => { if (window.getSelection()?.isCollapsed) beginNote(mark) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            beginNote(mark)
          }
        }}>{mark.quote}</mark>,
    )
    cursor = mark.end
  }
  fragments.push(text.slice(cursor))

  return (
    <div className="reading-text">
      {(selection || editing) && (
        <div className="reading-tools">
          {editing ? (
            <form className="reading-note-editor" onSubmit={saveNote}>
              <blockquote>{editing.quote}</blockquote>
              <label className="reading-note-kind">笔记类型
                <select value={kind} onChange={(event) => setKind(event.target.value as NoteKind)}>
                  {noteKinds.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label htmlFor={noteInput}>笔记内容</label>
              <textarea id={noteInput} value={note} rows={3} autoFocus
                placeholder="写下这段话的要点或你的改写"
                onChange={(event) => setNote(event.target.value)} />
              <div className="reading-actions">
                {ownMarks.some((mark) => mark.id === editing.id) && <button type="button" className="btn"
                  onClick={() => { onRemove(editing.id); dismiss() }}>删除标记</button>}
                <button type="button" className="btn" onClick={dismiss}>取消</button>
                <button type="submit" className="btn btn--primary" disabled={!note.trim()}>保存笔记</button>
              </div>
            </form>
          ) : (
            <div className="reading-actions" aria-label="选中文字操作">
              <button type="button" className="btn reading-highlight-button" onClick={() => {
                const mark = newMark()
                if (mark) { onSave(mark); dismiss() }
              }}>标记</button>
              <button type="button" className="btn" onClick={() => {
                const mark = newMark()
                if (mark) beginNote(mark)
              }}>写笔记</button>
              <button type="button" className="btn" onClick={dismiss}>取消</button>
            </div>
          )}
          {message && <span className="reading-message" role="status">{message}</span>}
        </div>
      )}
      {ownMarks.length > 0 && <details className="reading-note-list">
        <summary>本节标记与笔记 <span>{ownMarks.length}</span></summary>
        {ownMarks.map((mark) => <div className="reading-note-card" key={mark.id}>
          <div className="reading-note-card-header">
            <b>{mark.note?.kind ?? '标记'}</b>
            <button type="button" className="btn" onClick={() => beginNote(mark)}>编辑</button>
          </div>
          <blockquote>{mark.quote}</blockquote>
          {mark.note && <p>{mark.note.text}</p>}
        </div>)}
      </details>}
      <p ref={passage} className="reading-passage" tabIndex={0}
        onMouseUp={readSelection} onKeyUp={readSelection} onTouchEnd={readSelection}>
        {fragments}
      </p>
    </div>
  )
}
