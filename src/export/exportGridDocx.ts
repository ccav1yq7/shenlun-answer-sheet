import {
  AlignmentType, BorderStyle, Document, HeightRule, LineRuleType, Packer,
  PageOrientation, Paragraph, SectionType, Table, TableCell, TableLayoutType,
  TableRow, TextRun, VerticalAlign, WidthType, convertMillimetersToTwip as twips,
} from 'docx'
import type { DocumentLayout, Panel } from '../layout'
import type { SheetGeometry } from '../sheet/geometry'
import type { AnswerSheet } from '../document/model'
import { downloadBlob, textDocxSection, timestamp } from './exportDocx'

const red = { style: BorderStyle.SINGLE, color: 'B74949', size: 4 }
const hidden = { style: BorderStyle.NONE }
const margins = { top: 0, bottom: 0, left: 0, right: 0 }

function paragraph(text: string, size: number) {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0, line: size * 11, lineRule: LineRuleType.EXACT },
    children: [new TextRun({
      text: text.replace(/[\u0000-\u001F\uFFFE\uFFFF]/g, ''),
      size,
      font: { ascii: 'Arial', hAnsi: 'Arial', eastAsia: 'Noto Sans SC' },
    })],
  })
}

function panelContent(panel: Panel, geometry: SheetGeometry, cellWidth: number) {
  const fontSize = Math.floor(geometry.cell * 72 / 25.4 * 1.4)
  const grid = new Table({
    layout: TableLayoutType.FIXED,
    width: { size: cellWidth * geometry.columns, type: WidthType.DXA },
    columnWidths: Array<number>(geometry.columns).fill(cellWidth),
    margins,
    borders: { top: red, bottom: red, left: red, right: red, insideHorizontal: red, insideVertical: red },
    rows: Array.from({ length: panel.regionRows }, (_, rowIndex) => new TableRow({
      cantSplit: true,
      height: { value: cellWidth, rule: HeightRule.EXACT },
      children: Array.from({ length: geometry.columns }, (_, column) => {
        const cell = panel.rows[rowIndex]?.cells[column]
        const text = cell?.display ?? ''
        const length = Array.from(text).length
        const size = length > 1 ? Math.min(fontSize, Math.floor(cellWidth / (length * 5.5))) : fontSize
        return new TableCell({
          width: { size: cellWidth, type: WidthType.DXA },
          verticalAlign: VerticalAlign.CENTER,
          ...(cell?.overflow ? { shading: { fill: 'FCE7E7' } } : {}),
          children: [paragraph(text, size)],
        })
      }),
    })),
  })
  const heading = panel.isContinuation ? `${panel.blockTitle}（续）` : panel.blockTitle
  return [paragraph(`${heading} · ${panel.capacity} 格`, 22), grid, paragraph('', 2)]
}

export function buildGridDocxBlob(layout: DocumentLayout, geometry: SheetGeometry, frontMatter?: AnswerSheet): Promise<Blob> {
  const cellWidth = twips(geometry.cell)
  const panelWidth = cellWidth * geometry.columns
  const gap = twips(geometry.panelGap)
  const landscape = geometry.panelsPerPage === 2
  const columnWidths = landscape ? [panelWidth, gap, panelWidth] : [panelWidth]
  const sectionWidth = columnWidths.reduce((sum, width) => sum + width, 0)
  const pageWidth = twips(geometry.pageWidth)
  const pageHeight = twips(geometry.pageHeight)
  const sideMargin = Math.floor((pageWidth - sectionWidth) / 2)
  const document = new Document({
    title: '申论答题卡',
    sections: [
      ...(frontMatter ? [textDocxSection(frontMatter, { title: frontMatter.blocks.length === 1 ? '题干' : '申论题目', keepIndent: false })] : []),
      ...layout.pages.map((page, index) => ({
        properties: {
          type: SectionType.NEXT_PAGE,
          page: {
            // docx exchanges dimensions when serializing landscape sections.
            size: landscape
              ? { width: pageHeight, height: pageWidth, orientation: PageOrientation.LANDSCAPE }
              : { width: pageWidth, height: pageHeight },
            margin: { left: sideMargin, right: sideMargin, top: twips(12), bottom: twips(12) },
          },
        },
        children: [
          paragraph('申论答题卡', 36),
          paragraph(`第 ${index + 1} 页 / 共 ${layout.pages.length} 页`, 20),
          new Table({
            layout: TableLayoutType.FIXED,
            width: { size: sectionWidth, type: WidthType.DXA },
            columnWidths,
            margins,
            borders: {
              top: hidden, bottom: hidden, left: hidden, right: hidden,
              insideHorizontal: hidden, insideVertical: hidden,
            },
            rows: [new TableRow({
              children: columnWidths.map((width, column) => {
                const panel = page.panels.find((item) => item.slot * 2 === column)
                return new TableCell({
                  width: { size: width, type: WidthType.DXA },
                  children: panel ? panelContent(panel, geometry, cellWidth) : [paragraph('', 2)],
                })
              }),
            })],
          }),
          paragraph('', 2),
        ],
      })),
    ],
  })
  return Packer.toBlob(document)
}

export async function exportGridDocx(layout: DocumentLayout, geometry: SheetGeometry, frontMatter?: AnswerSheet): Promise<void> {
  const blob = await buildGridDocxBlob(layout, geometry, frontMatter)
  downloadBlob(blob, `申论方格答题卡-${timestamp()}.docx`)
}
