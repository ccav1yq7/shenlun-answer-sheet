import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'

export interface ImportedQuestion {
  materials: string
  prompt: string
}

interface QuestionImportProps {
  question: ImportedQuestion | null
  onSave: (question: ImportedQuestion) => void
  onClose: () => void
}

export function QuestionImport({ question, onSave, onClose }: QuestionImportProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState<ImportedQuestion>(question ?? { materials: '', prompt: '' })
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  async function readText(field: keyof ImportedQuestion, file?: File) {
    if (!file) return
    setReading(true)
    setError('')
    try {
      const text = await file.text()
      setDraft((current) => ({ ...current, [field]: text }))
    } catch {
      setError('无法读取文件，请复制文字后粘贴。')
    } finally {
      setReading(false)
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reading || !draft.prompt.trim()) return
    onSave({ materials: draft.materials.trim(), prompt: draft.prompt.trim() })
  }

  return (
    <dialog className="question-import" ref={dialogRef} onClose={onClose} aria-labelledby="question-import-title">
      <form onSubmit={save}>
        <h2 id="question-import-title">{question ? '编辑题目' : '导入题目'}</h2>
        {(['materials', 'prompt'] as const).map((field) => {
          const label = field === 'materials' ? '材料' : '题干'
          return (
            <div className="question-import-field" key={field}>
              <label htmlFor={`question-${field}`}>{label}</label>
              <textarea
                id={`question-${field}`}
                rows={field === 'materials' ? 8 : 3}
                required={field === 'prompt'}
                placeholder={`粘贴${label}文字`}
                value={draft[field]}
                onChange={(event) => {
                  const value = event.target.value
                  setDraft((current) => ({ ...current, [field]: value }))
                }}
              />
              <label className="question-file">
                导入{label} TXT
                <input type="file" accept=".txt,text/plain" disabled={reading} onChange={(event) => {
                  void readText(field, event.target.files?.[0])
                  event.target.value = ''
                }} />
              </label>
            </div>
          )
        })}
        {error && <p role="alert">{error}</p>}
        <div className="question-import-actions">
          <button type="button" className="btn" onClick={() => dialogRef.current?.close()}>取消</button>
          <button type="submit" className="btn btn--primary" disabled={reading || !draft.prompt.trim()}>
            {question ? '保存题目' : '导入并作答'}
          </button>
        </div>
      </form>
    </dialog>
  )
}
