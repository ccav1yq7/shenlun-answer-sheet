import { useId, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function ReviewNotes({ value, onChange }: {
  value: string
  onChange: (value: string) => void
}) {
  const id = useId()
  const [preview, setPreview] = useState(false)

  return (
    <section className="answer-card-review" aria-labelledby={`${id}-heading`}>
      <div className="answer-review-header">
        <label id={`${id}-heading`} htmlFor={preview ? undefined : id}>复盘笔记</label>
        <button type="button" className="btn" aria-pressed={preview} onClick={() => setPreview(!preview)}>
          {preview ? '编辑 Markdown' : '预览 Markdown'}
        </button>
      </div>
      {preview ? (
        <div className="answer-review-preview" role="region" aria-label="复盘笔记预览" tabIndex={0}>
          {value.trim() ? <Markdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={['img']}>{value}</Markdown>
            : <p>还没有复盘笔记。</p>}
        </div>
      ) : (
        <textarea id={id} value={value} onChange={(event) => onChange(event.target.value)}
          placeholder="支持 Markdown，例如：## 下次改进" />
      )}
    </section>
  )
}
