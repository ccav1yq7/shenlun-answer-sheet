import { useEffect, useRef, useState } from 'react'
import type { SavedPractice } from '../document/practiceStore'
import { readPractices } from '../document/practiceStore'

interface PracticeDialogProps {
  mode: 'save' | 'list'
  name: string
  canUpdate: boolean
  onSave: (name: string, asCopy: boolean) => boolean
  onOpen: (practice: SavedPractice) => void
  onClose: () => void
}

export function PracticeDialog({ mode, name, canUpdate, onSave, onOpen, onClose }: PracticeDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(name)
  const [saveError, setSaveError] = useState('')

  function save(asCopy: boolean) {
    if (draft.trim() && !onSave(draft.trim(), asCopy)) {
      setSaveError('保存失败，请检查浏览器存储权限或可用空间。')
    }
  }
  const [listing] = useState(() => {
    if (mode === 'save') return { records: [], error: '' }
    try {
      return { records: readPractices(), error: '' }
    } catch {
      return { records: [], error: '无法读取浏览器中的练习记录。' }
    }
  })
  useEffect(() => { dialog.current?.showModal() }, [])

  return (
    <dialog ref={dialog} className="question-import practice-dialog" onClose={onClose} aria-labelledby="practice-heading">
      <h2 id="practice-heading">{mode === 'save' ? '保存练习' : '我的练习'}</h2>
      {mode === 'save' ? (
        <form onSubmit={(event) => {
          event.preventDefault()
          save(false)
        }}>
          <label className="practice-name">练习名称
            <input value={draft} required maxLength={100} onChange={(event) => setDraft(event.target.value)} />
          </label>
          <p className="practice-hint">保存到当前浏览器，包括材料、题干、各题答案和笔记。</p>
          {saveError && <p role="alert">{saveError}</p>}
          <div className="question-import-actions">
            <button type="button" className="btn" onClick={() => dialog.current?.close()}>取消</button>
            {canUpdate && <button type="button" className="btn" disabled={!draft.trim()}
              onClick={() => save(true)}>另存一份</button>}
            <button type="submit" className="btn btn--primary" disabled={!draft.trim()}>保存</button>
          </div>
        </form>
      ) : (
        <>
          {listing.error && <p role="alert">{listing.error}</p>}
          {!listing.error && listing.records.length === 0 && <p>当前浏览器还没有已保存的练习。</p>}
          <ul className="practice-list">
            {listing.records.map((practice) => (
              <li key={practice.id}>
                <div><b>{practice.name}</b><small>{new Date(practice.updatedAt).toLocaleString('zh-CN')}</small></div>
                <button type="button" className="btn" aria-label={`打开 ${practice.name}`}
                  onClick={() => onOpen(practice)}>打开</button>
              </li>
            ))}
          </ul>
          <div className="question-import-actions">
            <button type="button" className="btn" onClick={() => dialog.current?.close()}>关闭</button>
          </div>
        </>
      )}
    </dialog>
  )
}
