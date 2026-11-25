import { useEffect, useRef, useState } from 'react'
import { answerCardPromptFontSize } from '../document/model'
import type { AnswerCardDetails } from '../document/model'

const displayOptions = {
  name: '答题卡名称',
  title: '申论答题卡标题',
  identity: '姓名与准考证号',
  instructions: '注意事项',
  prompt: '显示题干',
  review: '复盘笔记区域',
} as const

export function AnswerCardDialog({ card, questionPrompt, adding, onSave, onClose }: {
  card: AnswerCardDetails
  questionPrompt: string
  adding: boolean
  onSave: (card: AnswerCardDetails) => void
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(card)
  const [fontSize, setFontSize] = useState(String(answerCardPromptFontSize(card)))
  useEffect(() => { dialog.current?.showModal() }, [])

  return <dialog className="question-import answer-card-dialog" ref={dialog} onClose={onClose}
    aria-labelledby="answer-card-heading">
    <form onSubmit={(event) => {
      event.preventDefault()
      if (draft.name.trim()) onSave({
        ...draft,
        name: draft.name.trim(),
        promptText: draft.promptText?.trim() || undefined,
        promptFontSize: draft.display.prompt ? Number(fontSize) : draft.promptFontSize,
      })
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
      {draft.display.prompt && <fieldset className="answer-card-prompt-fields">
        <legend>答题卡题干</legend>
        <label><input type="checkbox" checked={draft.showPromptTitle !== false}
          onChange={(event) => setDraft({ ...draft, showPromptTitle: event.target.checked })} />显示「题干」标题</label>
        <label className="question-import-field">题干内容
          <textarea rows={5} value={draft.promptText ?? questionPrompt}
            onChange={(event) => setDraft({ ...draft, promptText: event.target.value })} />
        </label>
        <label>题干字号（磅）
          <input type="number" min={6} max={24} step={0.5} required
            value={fontSize} onChange={(event) => setFontSize(event.target.value)} />
        </label>
        <button className="btn" type="button" onClick={() => {
          setDraft({ ...draft, promptText: undefined })
          setFontSize('8')
        }}>恢复默认题干</button>
      </fieldset>}
      <div className="question-import-actions">
        <button type="button" className="btn" onClick={() => dialog.current?.close()}>取消</button>
        <button type="submit" className="btn btn--primary" disabled={!draft.name.trim()}>
          {adding ? '创建空白答题卡' : '应用设置'}
        </button>
      </div>
    </form>
  </dialog>
}
