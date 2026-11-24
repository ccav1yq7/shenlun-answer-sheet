// All coordinates are raster pixels so the break matches the image embedded in the PDF.
export function pdfRasterBreak(context: CanvasRenderingContext2D, start: number, limit: number): number {
  const { width, height } = context.canvas
  if (limit >= height) return height

  const bandTop = Math.max(start + 1, limit - 280)
  const pixels = context.getImageData(0, bandTop, width, limit - bandTop).data
  const rowWidth = width * 4

  function findGap(inset: number, minimum: number) {
    let clear = 0
    for (let y = limit - 1; y >= bandTop; y--) {
      const row = (y - bandTop) * rowWidth
      let empty = true
      for (let x = row + inset * 4; x < row + rowWidth - inset * 4; x += 4) {
        if (pixels[x + 3] && Math.min(pixels[x], pixels[x + 1], pixels[x + 2]) < minimum) {
          empty = false
          break
        }
      }
      clear = empty ? clear + 1 : 0
      if (clear >= 4) return y + 2
    }
  }

  // Prefer white gutters. Inside a long note, allow its pale background and vertical border.
  return findGap(0, 253) ?? findGap(8, 232) ?? limit
}
