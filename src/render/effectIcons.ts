// Kleine Vektor-Icons für die "Ammo"-Infoseite (siehe render/referencePanels.ts), angelehnt an
// Assets/ColorEffects.png. Bewusst einfache Strich-Grafik statt echter Bild-Assets, im selben
// minimalistischen Stil wie die übrigen Kauf-Leisten-Icons (siehe render/towerRender.ts).

import { drawStar } from './shapes'

export type EffectIconKind = 'slow' | 'burn' | 'chain' | 'poison' | 'freeze' | 'vulnerability' | 'spread' | 'pull' | 'explosion' | 'execute' | 'purge' | 'burst'

function withStroke(ctx: CanvasRenderingContext2D, color: string, lineWidth: number, glow: number, draw: () => void) {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.shadowColor = color
  ctx.shadowBlur = glow
  draw()
  ctx.restore()
}

/** 3 sich kreuzende Linien mit kleinen Zacken an den Enden — für Slow/Freeze. */
function drawSnowflake(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  withStroke(ctx, color, 1.5, 5, () => {
    for (let i = 0; i < 3; i++) {
      const angle = (Math.PI / 3) * i
      const dx = Math.cos(angle) * size
      const dy = Math.sin(angle) * size
      ctx.beginPath()
      ctx.moveTo(x - dx, y - dy)
      ctx.lineTo(x + dx, y + dy)
      ctx.stroke()
      for (const sign of [-1, 1]) {
        const bx = x + dx * 0.55 * sign
        const by = y + dy * 0.55 * sign
        const tickAngle = angle + Math.PI / 2
        const tdx = Math.cos(tickAngle) * size * 0.25
        const tdy = Math.sin(tickAngle) * size * 0.25
        ctx.beginPath()
        ctx.moveTo(bx - tdx, by - tdy)
        ctx.lineTo(bx + tdx, by + tdy)
        ctx.stroke()
      }
    }
  })
}

/** Flackernde Flamme (2 verschachtelte Tropfenformen) — für Burn. */
function drawFlame(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  withStroke(ctx, color, 1.5, 6, () => {
    ctx.beginPath()
    ctx.moveTo(x, y + size)
    ctx.bezierCurveTo(x - size * 0.7, y + size * 0.2, x - size * 0.5, y - size * 0.5, x, y - size)
    ctx.bezierCurveTo(x + size * 0.5, y - size * 0.5, x + size * 0.7, y + size * 0.2, x, y + size)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(x, y + size * 0.55)
    ctx.bezierCurveTo(x - size * 0.3, y + size * 0.15, x - size * 0.2, y - size * 0.15, x, y - size * 0.35)
    ctx.bezierCurveTo(x + size * 0.2, y - size * 0.15, x + size * 0.3, y + size * 0.15, x, y + size * 0.55)
    ctx.stroke()
  })
}

/** Zickzack-Blitz — für Chain Lightning. */
function drawLightningBolt(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  withStroke(ctx, color, 0, 6, () => {
    ctx.beginPath()
    ctx.moveTo(x + size * 0.25, y - size)
    ctx.lineTo(x - size * 0.35, y + size * 0.1)
    ctx.lineTo(x + size * 0.05, y + size * 0.1)
    ctx.lineTo(x - size * 0.25, y + size)
    ctx.lineTo(x + size * 0.35, y - size * 0.1)
    ctx.lineTo(x, y - size * 0.1)
    ctx.closePath()
    ctx.fill()
  })
}

/** Schädel mit 2 Augenpunkten — für Poison/Execute. */
function drawSkull(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  withStroke(ctx, color, 1.5, 5, () => {
    ctx.beginPath()
    ctx.arc(x, y - size * 0.15, size * 0.7, Math.PI, 0)
    ctx.lineTo(x + size * 0.7, y + size * 0.35)
    ctx.quadraticCurveTo(x, y + size * 0.7, x - size * 0.7, y + size * 0.35)
    ctx.closePath()
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(x - size * 0.28, y - size * 0.1, size * 0.14, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(x + size * 0.28, y - size * 0.1, size * 0.14, 0, Math.PI * 2)
    ctx.fill()
  })
}

/** Schild-Umriss mit Mittelpunkt — für Vulnerability. */
function drawShield(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  withStroke(ctx, color, 1.5, 5, () => {
    ctx.beginPath()
    ctx.moveTo(x, y - size)
    ctx.lineTo(x + size * 0.75, y - size * 0.55)
    ctx.lineTo(x + size * 0.75, y + size * 0.15)
    ctx.quadraticCurveTo(x + size * 0.75, y + size * 0.85, x, y + size)
    ctx.quadraticCurveTo(x - size * 0.75, y + size * 0.85, x - size * 0.75, y + size * 0.15)
    ctx.lineTo(x - size * 0.75, y - size * 0.55)
    ctx.closePath()
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(x, y, size * 0.16, 0, Math.PI * 2)
    ctx.fill()
  })
}

/** Zentraler Punkt mit 4 verbundenen Satelliten — für Stack Spread. */
function drawSpreadNetwork(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  withStroke(ctx, color, 1.5, 5, () => {
    for (let i = 0; i < 4; i++) {
      const angle = (Math.PI / 2) * i + Math.PI / 4
      const px = x + Math.cos(angle) * size
      const py = y + Math.sin(angle) * size
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(px, py)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(px, py, size * 0.16, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.beginPath()
    ctx.arc(x, y, size * 0.16, 0, Math.PI * 2)
    ctx.fill()
  })
}

/** 3 nach innen gebogene Pfeile — für Pull. */
function drawPullSpiral(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  withStroke(ctx, color, 1.5, 5, () => {
    for (let i = 0; i < 3; i++) {
      const angle = ((Math.PI * 2) / 3) * i - Math.PI / 2
      const outer = { x: x + Math.cos(angle) * size, y: y + Math.sin(angle) * size }
      const inner = { x: x + Math.cos(angle) * size * 0.35, y: y + Math.sin(angle) * size * 0.35 }
      ctx.beginPath()
      ctx.moveTo(outer.x, outer.y)
      ctx.lineTo(inner.x, inner.y)
      ctx.stroke()
      const headAngle = angle + Math.PI
      const h1 = headAngle + 0.5
      const h2 = headAngle - 0.5
      ctx.beginPath()
      ctx.moveTo(inner.x, inner.y)
      ctx.lineTo(inner.x + Math.cos(h1) * size * 0.22, inner.y + Math.sin(h1) * size * 0.22)
      ctx.moveTo(inner.x, inner.y)
      ctx.lineTo(inner.x + Math.cos(h2) * size * 0.22, inner.y + Math.sin(h2) * size * 0.22)
      ctx.stroke()
    }
  })
}

export function drawEffectIcon(ctx: CanvasRenderingContext2D, kind: EffectIconKind, x: number, y: number, size: number, color: string) {
  switch (kind) {
    case 'slow':
    case 'freeze':
      drawSnowflake(ctx, x, y, size, color)
      return
    case 'burn':
      drawFlame(ctx, x, y, size, color)
      return
    case 'chain':
      drawLightningBolt(ctx, x, y, size, color)
      return
    case 'poison':
    case 'execute':
      drawSkull(ctx, x, y, size, color)
      return
    case 'vulnerability':
      drawShield(ctx, x, y, size, color)
      return
    case 'spread':
      drawSpreadNetwork(ctx, x, y, size, color)
      return
    case 'pull':
      drawPullSpiral(ctx, x, y, size, color)
      return
    case 'explosion':
      drawStar(ctx, x, y, size, color, 0, 6, 8)
      return
    case 'purge':
      drawStar(ctx, x, y, size, color, Math.PI / 8, 6, 10)
      return
    case 'burst':
      drawStar(ctx, x, y, size * 0.85, color, 0, 5, 8)
      return
  }
}

export const EFFECT_ICON_BY_RESOURCE: Record<string, EffectIconKind> = {
  cyan: 'slow',
  magenta: 'burst',
  yellow: 'chain',
  blue: 'slow',
  red: 'burn',
  green: 'poison',
  cerulean: 'freeze',
  violet: 'vulnerability',
  chartreuse: 'spread',
  aquamarine: 'pull',
  fuchsia: 'chain',
  amber: 'explosion',
  black: 'execute',
  white: 'purge',
}
