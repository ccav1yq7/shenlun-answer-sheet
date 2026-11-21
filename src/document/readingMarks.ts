import type { ReadingMark } from '../components/AnnotatedText'

export const markStyles = {
  highlight: '色块',
  underline: '下划线',
  double: '双下划线',
  wave: '波浪线',
  circle: '圈选',
  strike: '删除线',
  transition: '转换符号 //',
} as const

export interface MarkPreset {
  id: string
  label: string
  color: string
  style: keyof typeof markStyles
}

const transitionPreset: MarkPreset = { id: 'transition', label: '转换', color: '#3f6aab', style: 'transition' }

export const defaultMarkPresets: MarkPreset[] = [
  { id: 'keyword', label: '关键词', color: '#e5a526', style: 'highlight' },
  { id: 'point', label: '要点', color: '#3975da', style: 'underline' },
  { id: 'cause', label: '因果', color: '#a44ab5', style: 'circle' },
  { id: 'rewrite', label: '待改写', color: '#258d75', style: 'wave' },
  transitionPreset,
]

export function validMarkPreset(value: unknown): value is MarkPreset {
  const preset = value as Partial<MarkPreset> | null
  return !!preset && typeof preset.id === 'string' && typeof preset.label === 'string'
    && preset.label.trim().length > 0 && Array.from(preset.label).length <= 5
    && typeof preset.color === 'string' && /^#[a-f0-9]{6}$/i.test(preset.color)
    && typeof preset.style === 'string' && Object.prototype.hasOwnProperty.call(markStyles, preset.style)
}

export const noteKinds = ['提炼', '改写', '随记'] as const
export type NoteKind = typeof noteKinds[number]

export interface NotePreferences {
  kind: NoteKind
  presetId: string
}

const preferencesKey = 'shenlun-reading-preferences-v1'
const storageKey = 'shenlun-mark-presets-v2'

export function readReadingPreferences(): { presets: MarkPreset[]; note: NotePreferences } {
  const legacy = readMarkPresets()
  try {
    const saved = JSON.parse(localStorage.getItem(preferencesKey) ?? 'null')
    const presets = Array.isArray(saved?.presets) && saved.presets.length && saved.presets.every(validMarkPreset)
      ? saved.presets as MarkPreset[] : legacy
    return {
      presets,
      note: {
        kind: noteKinds.includes(saved?.note?.kind) ? saved.note.kind : '提炼',
        presetId: presets.find((preset) => preset.id === saved?.note?.presetId)?.id ?? presets[0].id,
      },
    }
  } catch {
    return { presets: legacy, note: { kind: '提炼', presetId: legacy[0].id } }
  }
}

function readMarkPresets(): MarkPreset[] {
  try {
    const current = localStorage.getItem(storageKey)
    const saved = current ?? localStorage.getItem('shenlun-mark-presets-v1')
    const stored: unknown = JSON.parse(saved ?? 'null')
    if (Array.isArray(stored) && stored.length > 0 && stored.every(validMarkPreset)) {
      return current || stored.some((preset) => preset.id === transitionPreset.id) ? stored : [...stored, transitionPreset]
    }
  } catch {
    // A browser may disable storage.
  }
  return defaultMarkPresets
}

export function writeReadingPreferences(presets: MarkPreset[], note: NotePreferences) {
  localStorage.setItem(preferencesKey, JSON.stringify({ presets, note }))
}

export function syncMarkPresets(marks: ReadingMark[], presets: MarkPreset[]): ReadingMark[] {
  const byId = new Map(presets.map((preset) => [preset.id, preset]))
  return marks.map((mark) => {
    const next = byId.get(mark.preset?.id ?? defaultMarkPresets[0].id)
    if (!next || (mark.preset && mark.preset.label === next.label && mark.preset.color === next.color
      && mark.preset.style === next.style)) return mark
    if (!mark.preset && next.label === defaultMarkPresets[0].label && next.color === defaultMarkPresets[0].color
      && next.style === defaultMarkPresets[0].style) return mark
    return { ...mark, preset: next }
  })
}
