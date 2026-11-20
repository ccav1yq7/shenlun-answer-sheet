import { hasFenbiAssistant, requestFenbiAssistant } from './fenbiAssistant'
import { parsePractice, reloadPractice, storePractice } from './practiceStore'
import type { DirectoryHandle, PracticeEntry, SavedPractice } from './practiceStore'

export interface WebDavSettings {
  url: string
  username: string
  password: string
}

const settingsKey = 'shenlun-webdav-settings-v1'
let tabPassword = ''

export function readWebDavSettings(): WebDavSettings {
  try {
    const value = JSON.parse(localStorage.getItem(settingsKey) ?? '{}')
    return { url: value.url ?? '', username: value.username ?? '', password: tabPassword }
  } catch {
    return { url: '', username: '', password: '' }
  }
}

function normalizeEndpoint(raw: string) {
  const url = new URL(raw.trim())
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('请输入不含用户名、密码及查询参数的 HTTPS WebDAV 目录地址。')
  }
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

type Revision = { filename: string; id: string; parent: string; hash: string }
const revisionName = /^shenlun-sync-([0-9a-f-]{36})-(root|[0-9a-f]{64})-([0-9a-f]{64})\.json$/
const encoder = new TextEncoder()

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function serialized(record: SavedPractice | PracticeEntry) {
  return JSON.stringify({
    id: record.id, name: record.name, updatedAt: record.updatedAt,
    status: record.status, snapshot: record.snapshot,
  })
}

function conflictId(hash: string) {
  return [hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16),
    hash.slice(16, 20), hash.slice(20, 32)].join('-')
}

function listRevisions(xml: string, endpoint: URL) {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml')
  if (parsed.documentElement.localName !== 'multistatus' || parsed.querySelector('parsererror')) {
    throw new Error('WebDAV 没有返回可读取的目录列表，请核对目录地址。')
  }
  const groups = new Map<string, Revision[]>()
  for (const href of Array.from(parsed.getElementsByTagNameNS('DAV:', 'href'))) {
    const path = new URL(href.textContent ?? '', endpoint).pathname
    const filename = path.split('/').pop() ?? ''
    const match = revisionName.exec(filename)
    if (!match) continue
    const [, id, parent, hash] = match
    const current = groups.get(id) ?? []
    if (!current.some((version) => version.hash === hash)) {
      current.push({ filename, id, parent, hash })
      groups.set(id, current)
    }
  }
  return groups
}

export async function synchronizeWebDav(settings: WebDavSettings, entries: PracticeEntry[], directory?: DirectoryHandle) {
  const endpoint = normalizeEndpoint(settings.url)
  const username = settings.username.trim()
  if (!username || username.includes(':') || !settings.password) throw new Error('请输入 WebDAV 用户名和密码。')
  const auth = 'Basic ' + btoa(Array.from(encoder.encode(username + ':' + settings.password),
    (byte) => String.fromCharCode(byte)).join(''))
  async function request(method: string, filename = '', headers: Record<string, string> = {}, body?: string) {
    const url = new URL(filename, endpoint)
    const requestHeaders = { Authorization: auth, ...headers }
    let result: { status: number; ok: boolean; text: () => Promise<string> }
    if (url.origin === 'https://dav.jianguoyun.com') {
      if (!hasFenbiAssistant()) throw new Error('坚果云同步需要粉笔助手。安装或更新脚本后请刷新此页。')
      if (endpoint.pathname === '/dav/') throw new Error('请先在坚果云新建「申论练习」文件夹，再填写该文件夹的 WebDAV 地址。')
      const reply = await requestFenbiAssistant({
        action: 'webdav', url: url.href, method, headers: requestHeaders, body,
      })
      const status = reply.status ?? 0
      result = { status, ok: status >= 200 && status < 300, text: async () => reply.text ?? '' }
    } else {
      try {
        result = await fetch(url, {
          method, headers: requestHeaders, body,
          credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000),
        })
      } catch {
        throw new Error('无法连接 WebDAV，请检查 HTTPS 地址、网络或服务的跨域设置。')
      }
    }
    if (result.status === 401 || result.status === 403) throw new Error('WebDAV 拒绝访问，请检查账号和目录权限。')
    return result
  }

  const listing = await request('PROPFIND', '', { Depth: '1', 'Content-Type': 'application/xml' },
    '<?xml version="1.0"?><propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>')
  if (listing.status !== 207) throw new Error(`读取 WebDAV 目录失败（HTTP ${listing.status}）。`)
  const groups = listRevisions(await listing.text(), endpoint)
  localStorage.setItem(settingsKey, JSON.stringify({ url: endpoint.href, username }))
  tabPassword = settings.password
  const baselineKey = 'shenlun-webdav-base-v1:' + await digest(endpoint.href + '\n' + username)
  const baseline: Record<string, string> = JSON.parse(localStorage.getItem(baselineKey) ?? '{}')
  const local = new Map<string, PracticeEntry>()
  for (const entry of entries) local.set(entry.id, await reloadPractice(entry, directory))
  const ids = new Set([...local.keys(), ...groups.keys()])
  const stats = { uploaded: 0, downloaded: 0, conflicts: 0 }
  const downloads: { record: SavedPractice; previous?: PracticeEntry }[] = []

  for (const id of ids) {
    const entry = local.get(id)
    const versions = groups.get(id) ?? []
    const parents = new Set(versions.map(({ parent }) => parent))
    const heads = versions.filter(({ hash }) => !parents.has(hash))
    const raw = entry ? serialized(entry) : ''
    const localHash = entry ? await digest(raw) : ''
    if (heads.length === 1 && heads[0].hash === localHash) {
      baseline[id] = localHash
      continue
    }
    const remote = await Promise.all(heads.map(async (revision) => {
      const response = await request('GET', revision.filename)
      if (!response.ok) throw new Error(`下载练习版本失败（HTTP ${response.status}）。`)
      const text = await response.text()
      if (await digest(text) !== revision.hash) throw new Error('网盘练习版本校验失败，已保留本地副本。')
      return { ...revision, record: parsePractice(text, revision.id) }
    }))
    remote.sort((a, b) => b.record.updatedAt.localeCompare(a.record.updatedAt) || b.hash.localeCompare(a.hash))
    const alreadyRemote = versions.some(({ hash }) => hash === localHash)
    const localChanged = !!entry && !alreadyRemote
    const primary = remote.find(({ hash }) => hash === localHash) ?? remote[0]
    let chosen = primary?.hash

    if (localChanged) {
      const parent = versions.some(({ hash }) => hash === baseline[id]) ? baseline[id] : 'root'
      const filename = `shenlun-sync-${id}-${parent}-${localHash}.json`
      const uploaded = await request('PUT', filename, { 'Content-Type': 'application/json', 'If-None-Match': '*' }, raw)
      if (!uploaded.ok && uploaded.status !== 412) throw new Error(`上传练习失败（HTTP ${uploaded.status}）。`)
      chosen = localHash
      stats.uploaded++
      if (remote.some(({ hash }) => hash !== parent)) stats.conflicts++
    } else if (primary && primary.hash !== localHash) {
      downloads.push({ record: primary.record, previous: entry })
      stats.downloaded++
    }

    for (const alternate of remote) {
      if (alternate.hash === chosen || (localChanged && alternate.hash === baseline[id])) continue
      const alternateId = conflictId(alternate.hash)
      if (local.has(alternateId)) continue
      const record = { ...alternate.record, id: alternateId, name: `${alternate.record.name}（同步冲突副本）` }
      downloads.push({ record })
      local.set(alternateId, { ...record, storage: directory ? 'folder' : 'browser' })
      stats.conflicts++
    }
    if (chosen) baseline[id] = chosen
  }

  for (const { record, previous } of downloads) {
    await storePractice({ ...record, storage: previous?.storage ?? (directory ? 'folder' : 'browser') }, directory, previous)
  }
  localStorage.setItem(baselineKey, JSON.stringify(baseline))
  return stats
}
