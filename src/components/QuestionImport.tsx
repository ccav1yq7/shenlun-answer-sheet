import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { FenbiPaper } from '../import/fenbiPdf'

export interface ImportedQuestion {
  materials: string
  prompt: string
  paper?: FenbiPaper
  questionIndex?: number
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
  const [paper, setPaper] = useState<FenbiPaper | null>(question?.paper ?? null)
  const [questionIndex, setQuestionIndex] = useState(question?.questionIndex ?? 0)

  useEffect(() => {
    dialogRef.current?.showModal()
  }, [])

  async function readText(field: 'materials' | 'prompt', file?: File) {
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

  async function readPdf(file?: File) {
    if (!file) return
    setReading(true)
    setError('')
    try {
      const { importFenbiPdf } = await import('../import/fenbiPdf')
      const parsed = await importFenbiPdf(file)
      setPaper(parsed)
      setQuestionIndex(0)
      setDraft({ materials: parsed.materials, prompt: `${parsed.questions[0].label}\n${parsed.questions[0].prompt}` })
    } catch (error) {
      setError(error instanceof Error && /[\u4e00-\u9fff]/.test(error.message)
        ? error.message : '无法读取 PDF，请确认文件能正常打开且没有密码。')
    } finally {
      setReading(false)
    }
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reading || !draft.prompt.trim()) return
    const materials = draft.materials.trim()
    const prompt = draft.prompt.trim()
    onSave({
      materials,
      prompt,
      paper: paper ? {
        ...paper,
        materials,
        questions: paper.questions.map((item, index) => index === questionIndex
          ? { ...item, prompt: prompt.startsWith(item.label + '\n') ? prompt.slice(item.label.length + 1) : prompt }
          : item),
      } : undefined,
      questionIndex,
    })
  }

  return (
    <dialog className="question-import" ref={dialogRef} onClose={onClose} aria-labelledby="question-import-title">
      <form onSubmit={save}>
        <h2 id="question-import-title">{question ? '编辑题目' : '导入题目'}</h2>
        <div className="question-import-field">
          <label className="question-file">
            上传粉笔 PDF
            <input type="file" accept=".pdf,application/pdf" disabled={reading} onChange={(event) => {
              void readPdf(event.target.files?.[0])
              event.target.value = ''
            }} />
          </label>
          {reading && <span role="status">正在读取文件…</span>}
          {paper && (
            <label className="question-file">
              选择题目
              <select value={questionIndex} disabled={reading} onChange={(event) => {
                const index = Number(event.target.value)
                setPaper({
                  ...paper,
                  questions: paper.questions.map((item, i) => i === questionIndex
                    ? { ...item, prompt: draft.prompt.startsWith(item.label + '\n') ? draft.prompt.slice(item.label.length + 1) : draft.prompt }
                    : item),
                })
                const selected = paper.questions[index]
                setQuestionIndex(index)
                setDraft((current) => ({ ...current, prompt: `${selected.label}\n${selected.prompt}` }))
              }}>
                {paper.questions.map((item, index) => <option key={index} value={index}>{item.label}</option>)}
              </select>
            </label>
          )}
        </div>
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
