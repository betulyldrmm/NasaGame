import { useEffect, useRef } from 'react'
import { partDef } from '../game/data'
import { drawPart } from '../render/partArt'

/** Parça paletindeki küçük önizleme (aynı prosedürel çizim). */
export default function PartIcon({ id, size = 46 }: { id: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    cv.width = size * dpr
    cv.height = size * dpr
    const ctx = cv.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size, size)
    const d = partDef(id)
    const c = Math.min((size - 6) / d.w, (size - 6) / d.h)
    ctx.translate((size - d.w * c) / 2, (size - d.h * c) / 2)
    drawPart(ctx, { def: id, x: 0, y: 0 }, c)
  }, [id, size])
  return <canvas ref={ref} style={{ width: size, height: size }} aria-hidden="true" />
}
