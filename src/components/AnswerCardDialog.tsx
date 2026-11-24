import { useEffect, useRef, useState } from 'react'
import type { AnswerCardDetails } from '../document/model'

const displayOptions = {
  name: '答题卡名称',
  title: '申论答题卡标题',
  identity: '姓名与准考证号',
  instructions: '注意事项',
  prompt: '显示题干',
  review: '复盘笔记区域',
} as const

export function AnswerCardDialog({ card, adding, onSave, onClose }: {
  card: AnswerCardDetails
  adding: boolean
  onSave: (card: AnswerCardDetails) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(card)
  useEffect(() => { dialog.current?.showModal() }, [])

  return <dialog className="question-import answer-card-dialog" ref={dialog} onClose={onClose}
    aria-labelledby="answer-card-heading">
    <form onSubmit={(event) => {
      event.preventDefault()
      if (draft.name.trim()) onSave({ ...draft, name: draft.name.trim() })
    }}>
      <h2 id="answer-card-heading">{adding ? '新增答题卡' : '答题卡设置'}</h2>
      <label className="practice-name">答题卡名称
        <input value={draft.name} maxLength={60} required
          onChange={(event) => {
            const name = event.target.value
            setDraft((current) => ({ ...current, name }))
          }} />
      </label>
      <div className="answer-card-identity">
        <label className="practice-name">姓名
          <input value={draft.candidateName ?? ''} maxLength={30} onChange={(event) => {
            const value = event.target.value
            setDraft((current) => ({ ...current, candidateName: value }))
          }} />
        </label>
        <label className="practice-name">准考证号
          <input value={draft.admissionNumber ?? ''} maxLength={40} onChange={(event) => {
            const value = event.target.value
            setDraft((current) => ({ ...current, admissionNumber: value }))
          }} />
        </label>
      </div>
      <fieldset className="answer-card-display">
        <legend>答题卡显示内容</legend>
        {(Object.keys(displayOptions) as (keyof typeof displayOptions)[]).map((key) => (
          <label key={key}>
            <input type="checkbox" checked={Boolean(draft.display[key])} onChange={(event) => {
              const checked = event.target.checked
              setDraft((current) => ({ ...current, display: { ...current.display, [key]: checked } }))
            }} />
            {displayOptions[key]}
          </label>
        ))}
      </fieldset>
      <div className="question-import-actions">
        <button type="button" className="btn" onClick={() => dialog.current?.close()}>取消</button>
        <button type="submit" className="btn btn--primary" disabled={!draft.name.trim()}>
          {adding ? '创建空白答题卡' : '应用设置'}
        </button>
      </div>
    </form>
  </dialog>
}
