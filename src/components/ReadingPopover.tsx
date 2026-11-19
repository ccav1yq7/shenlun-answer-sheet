import { useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function ReadingPopover({ anchor, label, compact, onClose, children }: {
  anchor: Element | Range
  label: string
  compact?: boolean
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dismiss = useRef(onClose)
  dismiss.current = onClose

  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    const layout = () => {
      const rect = anchor.getBoundingClientRect()
      const { innerWidth, innerHeight } = window
      const margin = 10
      const gap = 8
      const above = rect.top - gap - box.offsetHeight
      const below = rect.bottom + gap
      const preferred = compact && above >= margin ? above
        : below + box.offsetHeight <= innerHeight - margin ? below : above
      box.style.top = `${Math.max(margin, Math.min(innerHeight - box.offsetHeight - margin, preferred))}px`
      box.style.left = `${Math.max(margin, Math.min(innerWidth - box.offsetWidth - margin, rect.left))}px`
    }
    layout()
    const observer = new ResizeObserver(layout)
    observer.observe(box)
    window.addEventListener('scroll', layout, true)
    window.addEventListener('resize', layout)
    const outsideClick = (event: PointerEvent) => {
      if (!box.contains(event.target as Node)) dismiss.current()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss.current()
    }
    document.addEventListener('pointerdown', outsideClick)
    document.addEventListener('keydown', escape)
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', layout, true)
      window.removeEventListener('resize', layout)
      document.removeEventListener('pointerdown', outsideClick)
      document.removeEventListener('keydown', escape)
    }
  }, [anchor, compact])

  return createPortal(<div ref={ref} className={`reading-popover${compact ? ' reading-popover--compact' : ''}`}
    role={compact ? 'toolbar' : 'dialog'} aria-label={label}>{children}</div>, document.body)
}
