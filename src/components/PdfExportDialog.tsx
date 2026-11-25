import { useEffect, useRef, useState } from 'react'

export interface PdfOptions {
  cover: boolean
  prompt: boolean
  materials: boolean
  answer: boolean
  review: boolean
  style: 'grid' | 'plain-grid' | 'text'
  markIds: string[]
  cardIds: string[]
}

interface Choice {
  id: string
  name: string
}

interface Props {
  defaults: PdfOptions
  hasPrompt: boolean
  hasMaterials: boolean
  marks: Choice[]
  cards: Choice[]
  busy: boolean
  error: string
  onClose: () => void
  onExport: (options: PdfOptions) => void
}

export function PdfExportDialog({ defaults, hasPrompt, hasMaterials, marks, cards, busy, error, onClose, onExport }: Props) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [options, setOptions] = useState(defaults)
  useEffect(() => { dialog.current?.showModal() }, [])
  const hasCards = options.answer && options.cardIds.length > 0
  const hasReading = (options.prompt && hasPrompt) || (options.materials && hasMaterials)
  const canExport = (!options.answer || hasCards) && (hasReading || hasCards)

  function choices(key: 'markIds' | 'cardIds', items: Choice[]) {
    return items.map(({ id, name }) => <label key={id}>
      <input type="checkbox" checked={options[key].includes(id)} onChange={({ target }) =>
        setOptions((current) => ({ ...current, [key]: target.checked
          ? [...current[key], id] : current[key].filter((selected) => selected !== id) }))} />
      {name}
    </label>)
  }

  return <dialog className="question-import pdf-export-dialog" aria-labelledby="pdf-export-title"
    ref={dialog} onClose={onClose} onCancel={(event) => { if (busy) event.preventDefault() }}>
    <form onSubmit={(event) => { event.preventDefault(); if (canExport && !busy) onExport(options) }}>
      <h2 id="pdf-export-title">导出 PDF</h2>
      <fieldset disabled={busy}>
        <legend>导出内容</legend>
        <label><input type="checkbox" checked={options.cover}
          onChange={({ target }) => setOptions({ ...options, cover: target.checked })} />试卷封面</label>
        {([
          ['prompt', '题干', hasPrompt], ['materials', '材料', hasMaterials], ['answer', '答题卡', true],
        ] as const).map(([key, label, available]) => <label key={key}>
          <input type="checkbox" disabled={!available} checked={available && options[key]}
            onChange={({ target }) => setOptions({ ...options, [key]: target.checked })} />
          {label}
        </label>)}
      </fieldset>
      {marks.length > 0 && hasReading && <fieldset disabled={busy}>
        <legend>原文标记方案</legend>
        {choices('markIds', marks)}
      </fieldset>}
      {options.answer && <fieldset disabled={busy}>
        <legend>答题卡方案</legend>
        {choices('cardIds', cards)}
        <label>样式
          <select value={options.style} onChange={({ target }) => setOptions({ ...options, style: target.value as PdfOptions['style'] })}>
            <option value="grid">保留答题卡样式</option>
            <option value="plain-grid">简洁方格</option>
            <option value="text">纯文字</option>
          </select>
        </label>
        <label><input type="checkbox" checked={options.review}
          onChange={({ target }) => setOptions({ ...options, review: target.checked })} />附上复盘笔记</label>
      </fieldset>}
      {error && <p className="pdf-export-error" role="alert">{error}</p>}
      <div className="question-import-actions">
        <button className="btn" type="button" disabled={busy} onClick={onClose}>取消</button>
        <button className="btn btn--primary" type="submit" disabled={busy || !canExport}>
          {busy ? '正在生成…' : '下载 PDF'}
        </button>
      </div>
    </form>
  </dialog>
}
