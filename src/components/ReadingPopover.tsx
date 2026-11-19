import { useLayoutEffect, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ReadingPopoverProps {
  anchor: Element | Range
  label: string
  compact?: boolean
  connection?: {
    color: string
    resolveSource: () => HTMLElement | undefined
  }
  onClose: () => void
  children: ReactNode
}

export function ReadingPopover({ anchor, label, compact, connection, onClose, children }: ReadingPopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const leader = useRef<HTMLDivElement>(null)
  const dismiss = useRef(onClose)
  dismiss.current = onClose
  const connected = Boolean(connection)
  const connectionRef = useRef(connection)
  connectionRef.current = connection

  useLayoutEffect(() => {
    const box = ref.current
    if (!box) return
    const layout = () => {
      const active = connectionRef.current
      const source = active?.resolveSource()
      const target = source ?? anchor
      const rect = target.getBoundingClientRect()
      const pane = source?.closest('.question-pane')?.getBoundingClientRect()
      const scroller = source?.closest('.question-prompt-content, .question-material-content')?.getBoundingClientRect()
      const { innerWidth, innerHeight } = window
      const clipTop = Math.max(0, scroller?.top ?? 0)
      const clipBottom = Math.min(innerHeight, scroller?.bottom ?? innerHeight)
      const rows = Array.from(target.getClientRects())
        .filter((line) => line.width > 0 && line.bottom > clipTop && line.top < clipBottom)
      const row = rows[rows.length - 1]
      const margin = 10
      const gap = 10
      const above = rect.top - gap - box.offsetHeight
      const below = rect.bottom + gap
      const side = !!(pane && pane.right + 18 + box.offsetWidth <= innerWidth - margin)
      const placeAbove = compact ? above >= margin : below + box.offsetHeight > innerHeight - margin
      const preferredTop = side ? (row?.top ?? rect.top) - 12 : placeAbove ? above : below
      const top = Math.max(margin, Math.min(innerHeight - box.offsetHeight - margin, preferredTop))
      const left = Math.max(margin, Math.min(innerWidth - box.offsetWidth - margin, side && pane ? pane.right + 18 : rect.left))
      box.style.top = `${top}px`
      box.style.left = `${left}px`
      const link = leader.current
      if (!link) return
      if (!row || (!side && top < row.bottom && top + box.offsetHeight > row.top)) {
        link.hidden = true
        return
      }

      const x = side ? Math.min(pane?.right ?? innerWidth, row.right + 3) : (row.left + row.right) / 2
      const y = side ? Math.min(clipBottom, row.bottom) : placeAbove ? row.top : row.bottom
      const endX = side ? left : Math.max(left + 12, Math.min(left + box.offsetWidth - 12, x))
      const endY = side ? top + 25 : placeAbove ? top + box.offsetHeight : top
      link.hidden = false
      link.style.left = `${x}px`
      link.style.top = `${y}px`
      link.style.width = `${Math.hypot(endX - x, endY - y)}px`
      link.style.transform = `rotate(${Math.atan2(endY - y, endX - x)}rad)`
    }
    layout()
    const observer = new ResizeObserver(layout)
    observer.observe(box)
    const source = connectionRef.current?.resolveSource()
    const pane = source?.closest('.question-pane')
    if (pane) observer.observe(pane)
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
  }, [anchor, compact, connected])

  const colors = connection ? { '--mark-color': connection.color } as CSSProperties : undefined
  const variant = compact ? ' reading-popover--compact' : connection ? ' reading-popover--connected' : ''
  return createPortal(<>
    {connection && <div ref={leader} className="reading-leader" style={colors} aria-hidden="true" hidden />}
    <div ref={ref} className={`reading-popover${variant}`} style={colors}
      role={compact ? 'toolbar' : 'dialog'} aria-label={label}>{children}</div>
  </>, document.body)
}
