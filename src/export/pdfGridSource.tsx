import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { SheetView } from '../components/SheetView'
import type { AnswerBlock, AnswerSheet } from '../document/model'
import type { LayoutProfile } from '../layout'
import { layoutDocument } from '../layout'
import { chooseLayout, computeGeometry, geometryToCssVars } from '../sheet/geometry'
import type { GridPdfSource } from './exportImages'

export async function* pdfGridSources(
  host: HTMLElement,
  blocks: AnswerBlock[],
  sheet: AnswerSheet,
  profile: LayoutProfile,
  forceA4: boolean,
  plain: boolean,
): AsyncGenerator<GridPdfSource> {
  const source = document.createElement('div')
  source.setAttribute('aria-hidden', 'true')
  source.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;'
  host.append(source)
  const root = createRoot(source)
  try {
    for (const block of blocks) {
      const card = plain && block.card ? {
        ...block.card,
        display: { name: false, title: false, identity: false, instructions: false, review: false },
      } : block.card
      const display = card?.display
      const header = plain ? 0 : display && !display.instructions
        ? 8 + (display.title ? 27 : 0) + (display.identity ? 9 : 0) + (display.name ? 17 : 0)
        : undefined
      const rows = Math.ceil(block.capacity / sheet.columns)
      const layout = forceA4 ? 'a4-single' : chooseLayout(sheet.columns, rows, sheet.mode, header)
      const geometry = computeGeometry({ columns: sheet.columns, layout, compactHeaderHeight: header })
      const doc = layoutDocument([{
        blockId: block.id, blockTitle: block.title, text: block.text,
        capacity: block.capacity, paragraphs: block.paragraphStyles,
      }], profile, { panelsPerPage: geometry.panelsPerPage, rowsPerPanelForPage: geometry.rowsForPage })
      flushSync(() => root.render(
        <div style={geometryToCssVars(geometry)}>
          <SheetView doc={doc} columns={sheet.columns} activeBlockId={block.id}
            tokensByBlockId={new Map(doc.blocks.map((b) => [b.blockId, new Map(b.tokens.map((t) => [t.id, t]))]))}
            compoundRules={profile.compoundRules} selStart={0} selEnd={0} caretRow={-1} caretColumn={-1} caretFraction={0}
            card={card} showTemplate={sheet.showTemplate && !plain} split={geometry.panelsPerPage > 1}
            paperLabel={layout === 'a4-single' ? 'A4 纵向' : 'A3 横向'}
            interactive={false} onPointerDown={() => undefined} />
        </div>,
      ))
      yield { source, geometry }
    }
  } finally {
    root.unmount()
    source.remove()
  }
}
