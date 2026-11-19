import type { ReadingMark } from '../components/AnnotatedText'

export const markStyles = {
  highlight: '色块',
  underline: '下划线',
  double: '双下划线',
  wave: '波浪线',
  circle: '圈选',
  strike: '删除线',
} as const

export interface MarkPreset {
  id: string
  label: string
  color: string
  style: keyof typeof markStyles
}

export const defaultMarkPresets: MarkPreset[] = [
  { id: 'keyword', label: '关键词', color: '#e5a526', style: 'highlight' },
  { id: 'point', label: '要点', color: '#3975da', style: 'underline' },
  { id: 'cause', label: '因果', color: '#a44ab5', style: 'circle' },
  { id: 'rewrite', label: '待改写', color: '#258d75', style: 'wave' },
]

export function validMarkPreset(value: unknown): value is MarkPreset {
  const preset = value as Partial<MarkPreset> | null
  return !!preset && typeof preset.id === 'string' && typeof preset.label === 'string'
    && preset.label.trim().length > 0 && Array.from(preset.label).length <= 5
    && typeof preset.color === 'string' && /^#[a-f0-9]{6}$/i.test(preset.color)
    && typeof preset.style === 'string' && Object.prototype.hasOwnProperty.call(markStyles, preset.style)
}

const storageKey = 'shenlun-mark-presets-v1'

export function readMarkPresets(): MarkPreset[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    if (Array.isArray(stored) && stored.length > 0 && stored.every(validMarkPreset)) {
      return stored
    }
  } catch {
    // A browser may disable storage.
  }
  return defaultMarkPresets
}

export function writeMarkPresets(presets: MarkPreset[]) {
  localStorage.setItem(storageKey, JSON.stringify(presets))
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
