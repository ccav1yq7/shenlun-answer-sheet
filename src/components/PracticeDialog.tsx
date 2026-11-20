import { readWebDavSettings, synchronizeWebDav } from '../document/webdavSync'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DirectoryHandle, PracticeEntry, SavedPractice } from '../document/practiceStore'
import {
  choosePracticeDirectory, clearPracticeDirectory, deletePractice, getDirectoryPermission, getPracticeDirectory,
  listDirectoryPractices, practiceFilename, readPractices, reloadPractice, requestDirectoryPermission,
  storePractice, supportsPracticeDirectory,
} from '../document/practiceStore'

type Status = NonNullable<SavedPractice['status']>

interface PracticeDialogProps {
  openWebdav?: boolean
  mode: 'save' | 'list'
  name: string
  current: PracticeEntry | null
  onSave: (name: string, status: Status, asCopy: boolean, directory?: DirectoryHandle) => Promise<void>
  onOpen: (practice: PracticeEntry, directory?: DirectoryHandle) => void
  onUpdate: (previous: PracticeEntry, updated: PracticeEntry | null) => void
  onClose: () => void
}

export function PracticeDialog({ mode, name, current, onSave, onOpen, onUpdate, onClose, openWebdav }: PracticeDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(name)
  const [status, setStatus] = useState<Status>(current?.status ?? 'in-progress')
  const [directory, setDirectory] = useState<DirectoryHandle>()
  const [permission, setPermission] = useState<PermissionState>('prompt')
  const [records, setRecords] = useState<PracticeEntry[]>([])
  const [unreadable, setUnreadable] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | Status>('all')
  const [webdav, setWebdav] = useState(readWebDavSettings)
  const [showWebdav, setShowWebdav] = useState(() => openWebdav || new URLSearchParams(location.search).get('webdav') === '1')
  const [syncStatus, setSyncStatus] = useState('')
  const [editing, setEditing] = useState<{ record: PracticeEntry; name: string } | null>(null)
  const folderSupported = supportsPracticeDirectory()

  const refresh = useCallback(async (folder?: DirectoryHandle) => {
    const browser = mode === 'list' ? readPractices().map((record): PracticeEntry => ({ ...record, storage: 'browser' })) : []
    setRecords(browser)
    setUnreadable(0)
    if (!folder) return
    const access = await getDirectoryPermission(folder)
    setPermission(access)
    if (access === 'granted' && mode === 'list') {
      const local = await listDirectoryPractices(folder)
      setRecords([...local.records, ...browser].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
      setUnreadable(local.unreadable)
    }
  }, [mode])

  async function run(action: () => Promise<void>) {
    setLoading(true)
    setError('')
    try {
      await action()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setError(error instanceof Error ? error.message : '操作失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    dialog.current?.showModal()
    void (async () => {
      try {
        const folder = supportsPracticeDirectory() ? await getPracticeDirectory() : undefined
        setDirectory(folder)
        await refresh(folder)
      } catch {
        setError('无法读取练习存储，请检查浏览器权限。')
      } finally {
        setLoading(false)
      }
    })()
  }, [refresh])

  async function save(asCopy: boolean) {
    if (!draft.trim()) return
    await run(() => onSave(draft.trim(), status, asCopy, directory))
  }

  async function update(record: PracticeEntry, patch: Pick<PracticeEntry, 'name'> | Pick<PracticeEntry, 'status'>) {
    const updated = { ...record, ...patch, updatedAt: new Date().toISOString() }
    await storePractice(updated, directory, record)
    onUpdate(record, updated)
    setEditing(null)
    await refresh(directory)
  }

  function confirmDelete(record: PracticeEntry) {
    if (!window.confirm(`删除「${record.name}」的已保存记录？`)) return
    void run(async () => {
      await deletePractice(record, directory)
      onUpdate(record, null)
      await refresh(directory)
    })
  }

  const visible = records.filter((record) => filter === 'all' || (record.status ?? 'in-progress') === filter)

  return (
    <dialog ref={dialog} className="question-import practice-dialog" onClose={onClose} aria-labelledby="practice-heading">
      <h2 id="practice-heading">{mode === 'save' ? '保存练习' : '我的练习'}</h2>
      <div className="practice-storage">
        <div><b>{directory ? directory.name : '浏览器存储'}</b>
          <small>{directory ? (permission === 'granted' ? '新练习保存为本地 JSON 文件' : '文件夹需要重新授权') : '新练习保存到当前浏览器'}</small>
        </div>
        <div className="practice-actions">
          {directory && permission !== 'granted' && <button type="button" className="btn" disabled={loading}
            onClick={() => void run(async () => {
              const access = await requestDirectoryPermission(directory)
              if (access !== 'granted') throw new Error('未获得文件夹访问权限')
              await refresh(directory)
            })}>重新授权</button>}
          {folderSupported && <button type="button" className="btn" disabled={loading} onClick={() => void run(async () => {
            const selected = await choosePracticeDirectory()
            setDirectory(selected)
            await refresh(selected)
          })}>{directory ? '更换文件夹' : '选择本地文件夹'}</button>}
          {directory && <button type="button" className="btn" disabled={loading} onClick={() => void run(async () => {
            await clearPracticeDirectory()
            setDirectory(undefined)
            await refresh()
          })}>断开文件夹</button>}
        </div>
      </div>
      {!folderSupported && <p className="practice-hint">选择本地文件夹请用支持此功能的浏览器，例如桌面版 Chrome 或 Edge。</p>}
      {error && <p role="alert">{error}</p>}
      {mode === 'save' ? (
        <form onSubmit={(event) => { event.preventDefault(); void save(false) }}>
          <label className="practice-name">练习名称
            <input value={draft} required maxLength={100} onChange={(event) => setDraft(event.target.value)} />
          </label>
          <label className="practice-filter">完成状态
            <select value={status} onChange={(event) => setStatus(event.target.value as Status)}>
              <option value="in-progress">未完成</option>
              <option value="completed">已完成</option>
            </select>
          </label>
          <p className="practice-hint">{current ? `保存会更新原记录（${current.storage === 'folder' ? '本地文件' : '浏览器'}），另存一份可使用当前存储位置。`
            : '保存内容包括材料、题干、各题答案和笔记。首次保存后，后续修改会自动保存。'}</p>
          <div className="question-import-actions">
            <button type="button" className="btn" onClick={() => dialog.current?.close()}>取消</button>
            {current && <button type="button" className="btn" disabled={loading || !draft.trim()}
              onClick={() => void save(true)}>另存一份</button>}
            <button type="submit" className="btn btn--primary" disabled={loading || !draft.trim()}>保存</button>
          </div>
        </form>
      ) : (
        <>
          <button className="btn" type="button" aria-expanded={showWebdav}
            onClick={() => setShowWebdav((open) => !open)}>WebDAV 同步</button>
          {showWebdav && <form className="practice-webdav" onSubmit={(event) => {
            event.preventDefault()
            setSyncStatus('')
            void run(async () => {
              if (directory && permission !== 'granted') throw new Error('请先重新授权本地文件夹。')
              const result = await synchronizeWebDav(webdav, records, directory)
              await refresh(directory)
              setSyncStatus(`同步完成：上传 ${result.uploaded}，下载 ${result.downloaded}，冲突 ${result.conflicts}。`)
            })
          }}>
            <label className="practice-name">WebDAV 目录
              <input type="url" value={webdav.url} required placeholder="https://dav.jianguoyun.com/dav/申论练习/"
                onChange={(event) => setWebdav({ ...webdav, url: event.target.value })} />
            </label>
            <label className="practice-name">WebDAV 用户名
              <input value={webdav.username} required onChange={(event) => setWebdav({ ...webdav, username: event.target.value })} />
            </label>
            <label className="practice-name">WebDAV 密码
              <input type="password" value={webdav.password} required autoComplete="off"
                onChange={(event) => setWebdav({ ...webdav, password: event.target.value })} />
            </label>
            <p className="practice-hint">双向同步已保存的练习；云端保留版本，密码仅在当前网页会话使用。</p>
            <div className="practice-actions">
              <button className="btn btn--primary" type="submit" disabled={loading}>立即双向同步</button>
              {syncStatus && <span role="status">{syncStatus}</span>}
            </div>
          </form>}
          <div className="practice-list-toolbar">
            <label className="practice-filter">筛选状态
              <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
                <option value="all">全部</option>
                <option value="in-progress">未完成</option>
                <option value="completed">已完成</option>
              </select>
            </label>
            <button type="button" className="btn" disabled={loading} onClick={() => void run(() => refresh(directory))}>刷新列表</button>
          </div>
          {unreadable > 0 && <p className="practice-hint">有 {unreadable} 个练习文件无法读取，原文件仍保留。</p>}
          {!loading && visible.length === 0 && <p>没有符合条件的练习。</p>}
          <ul className="practice-list">
            {visible.map((practice) => (
              <li key={`${practice.storage}-${practice.id}`}>
                <div className="practice-record">
                  {editing?.record === practice ? (
                    <form className="practice-actions" onSubmit={(event) => {
                      event.preventDefault()
                      if (editing.name.trim()) void run(() => update(practice, { name: editing.name.trim() }))
                    }}>
                      <input aria-label="新名称" value={editing.name} maxLength={100}
                        onChange={(event) => setEditing({ record: practice, name: event.target.value })} />
                      <button type="submit" className="btn" disabled={loading || !editing.name.trim()}>确定</button>
                      <button type="button" className="btn" onClick={() => setEditing(null)}>取消</button>
                    </form>
                  ) : <b>{practice.name}</b>}
                  <small>{practice.status === 'completed' ? '已完成' : '未完成'} · {practice.storage === 'folder' ? '本地文件' : '浏览器'} · {new Date(practice.updatedAt).toLocaleString('zh-CN')}</small>
                  {practice.storage === 'folder' && <code>{practiceFilename(practice.id)}</code>}
                </div>
                <div className="practice-actions">
                  <button type="button" className="btn" disabled={loading} aria-label={`打开 ${practice.name}`}
                    onClick={() => void run(async () => onOpen(await reloadPractice(practice, directory), directory))}>打开</button>
                  <button type="button" className="btn" disabled={loading} onClick={() => setEditing({ record: practice, name: practice.name })}>重命名</button>
                  <button type="button" className="btn" disabled={loading} onClick={() => void run(() => update(practice, {
                    status: practice.status === 'completed' ? 'in-progress' : 'completed',
                  }))}>{practice.status === 'completed' ? '标为未完成' : '标为已完成'}</button>
                  {practice.storage === 'browser' && directory && permission === 'granted' && (
                    <button type="button" className="btn" disabled={loading} onClick={() => void run(async () => {
                      const source = await reloadPractice(practice)
                      await storePractice({ ...source, id: crypto.randomUUID(), storage: 'folder',
                        updatedAt: new Date().toISOString() }, directory)
                      await refresh(directory)
                    })}>复制到文件夹</button>
                  )}
                  <button type="button" className="btn practice-delete" disabled={loading} onClick={() => confirmDelete(practice)}>删除</button>
                </div>
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
