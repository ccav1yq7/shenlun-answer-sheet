import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { markStyles, noteKinds, validMarkPreset, writeReadingPreferences } from '../document/readingMarks'
import type { MarkPreset, NoteKind, NotePreferences } from '../document/readingMarks'

export function MarkPresetDialog({ presets, notePreferences, onSave, onClose }: {
  presets: MarkPreset[]
  notePreferences: NotePreferences
  onSave: (presets: MarkPreset[], note: NotePreferences) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(presets)
  const [note, setNote] = useState(notePreferences)
  const defaultPreset = draft.find((preset) => preset.id === note.presetId) ?? draft[0]
  const [error, setError] = useState('')
  const valid = draft.every(validMarkPreset)
  useEffect(() => { dialog.current?.showModal() }, [])

  function update(id: string, patch: Partial<MarkPreset>) {
    setDraft((current) => current.map((preset) => preset.id === id ? { ...preset, ...patch } : preset))
  }

  return <dialog ref={dialog} className="question-import mark-preset-dialog"
    onClose={onClose} aria-labelledby="mark-preset-title">
    <form onSubmit={(event) => {
      event.preventDefault()
      if (!valid) return
      const cleaned = draft.map((preset) => ({ ...preset, label: preset.label.trim() }))
      try {
        const preferences = { ...note, presetId: defaultPreset.id }
        writeReadingPreferences(cleaned, preferences)
        onSave(cleaned, preferences)
      } catch {
        setError('保存失败，请检查浏览器的存储权限。')
      }
    }}>
      <h2 id="mark-preset-title">标记与批注偏好</h2>
      <fieldset className="note-preferences">
        <legend>新建批注</legend>
        <label>默认批注类型
          <select value={note.kind} onChange={(event) => setNote({ ...note, kind: event.target.value as NoteKind })}>
            {noteKinds.map((kind) => <option key={kind}>{kind}</option>)}
          </select>
        </label>
        <label>默认原文标记
          <select value={defaultPreset.id} onChange={(event) => setNote({ ...note, presetId: event.target.value })}>
            {draft.map((preset, index) => <option key={preset.id} value={preset.id}>{preset.label || `样式 ${index + 1}`}</option>)}
          </select>
        </label>
      </fieldset>
      <p className="mark-preset-intro">为常用标记定义含义，最多 5 个字。设置会用于以后的练习。</p>
      <div className="mark-preset-rows">
        {draft.map((preset, index) => (
          <div className="mark-preset-row" key={preset.id}>
            <label>含义
              <input value={preset.label} required aria-label={`含义 ${index + 1}`}
                onChange={(event) => update(preset.id, { label: Array.from(event.target.value).slice(0, 5).join('') })} />
            </label>
            <label>样式
              <select value={preset.style} aria-label={`样式 ${index + 1}`}
                onChange={(event) => update(preset.id, { style: event.target.value as MarkPreset['style'] })}>
                {Object.entries(markStyles).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
              </select>
            </label>
            <label>颜色
              <input type="color" value={preset.color} aria-label={`颜色 ${index + 1}`}
                onChange={(event) => update(preset.id, { color: event.target.value })} />
            </label>
            <span className="mark-preview">
              <mark className={`reading-mark mark-${preset.style}`} data-meaning={preset.label}
                style={{ '--mark-color': preset.color } as CSSProperties}>范例文字{preset.style === 'transition' && <span className="reading-transition-symbol" aria-hidden="true" />}</mark>
            </span>
            <button type="button" className="btn" disabled={draft.length === 1} aria-label={`删除样式 ${index + 1}`}
              onClick={() => setDraft((current) => current.filter((item) => item.id !== preset.id))}>删除</button>
          </div>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="mark-preset-footer">
        <button type="button" className="btn" onClick={() => setDraft((current) => [...current, {
          id: crypto.randomUUID(), label: '', style: 'highlight', color: '#e5a526',
        }])}>＋ 添加样式</button>
        <div className="question-import-actions">
          <button type="button" className="btn" onClick={() => dialog.current?.close()}>取消</button>
          <button type="submit" className="btn btn--primary" disabled={!valid}>保存偏好</button>
        </div>
      </div>
    </form>
  </dialog>
}
