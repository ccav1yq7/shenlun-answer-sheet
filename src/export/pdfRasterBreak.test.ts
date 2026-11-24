import { describe, expect, it } from 'vitest'
import { pdfRasterBreak } from './pdfRasterBreak'

function raster(paint: (x: number, y: number) => number): CanvasRenderingContext2D {
  const width = 60
  const height = 120
  return {
    canvas: { width, height },
    getImageData: (_x: number, top: number, _width: number, rows: number) => {
      const data = new Uint8ClampedArray(rows * width * 4)
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < width; x++) {
          const shade = paint(x, y + top)
          data.set([shade, shade, shade, 255], (y * width + x) * 4)
        }
      }
      return { data }
    },
  } as CanvasRenderingContext2D
}

describe('带标记 PDF 分页', () => {
  it('页长落在文字行中间时，从该行前的空白断开', () => {
    const image = raster((_x, y) => y >= 62 && y < 82 ? 30 : 255)
    expect(pdfRasterBreak(image, 0, 72)).toBe(60)
  })

  it('保留批注底色和竖边，并在批注文字行间断开', () => {
    const image = raster((x, y) => x < 5 || (y >= 62 && y < 82) ? 30 : 239)
    expect(pdfRasterBreak(image, 0, 72)).toBe(60)
  })

  it('末页保留到图像底部', () => {
    expect(pdfRasterBreak(raster(() => 255), 72, 120)).toBe(120)
  })
})
