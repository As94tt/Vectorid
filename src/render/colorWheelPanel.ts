import { COLORS } from '../constants/colors'
import { getResource, getResourcesByTier, type ResourceDefinition } from '../data/resources'
import { drawCircle, drawCircleOutline } from './shapes'

// Info-Panel: zeigt alle Ressourcen als Wheel (Tier 1 innen -> Tier 5 außen, Lumen/Prisma im
// äußersten Ring) und beim Hover die genaue Zusammensetzung (beide Misch-Rezepte, falls vorhanden).

export interface WheelSwatch {
  resource: ResourceDefinition
  x: number
  y: number
  radius: number
}

const CLOSE_BUTTON_SIZE = 28
const PANEL_RADIUS = 345
const PANEL_FILL = '#0b0d12'

function ring(resources: ResourceDefinition[], centerX: number, centerY: number, ringRadius: number, swatchRadius: number, phaseOffset = 0): WheelSwatch[] {
  return resources.map((resource, i) => {
    const angle = -Math.PI / 2 + phaseOffset + (i / resources.length) * Math.PI * 2
    return {
      resource,
      x: centerX + ringRadius * Math.cos(angle),
      y: centerY + ringRadius * Math.sin(angle),
      radius: swatchRadius,
    }
  })
}

export function buildWheelLayout(width: number, height: number): WheelSwatch[] {
  const centerX = width / 2
  const centerY = height / 2
  return [
    ...ring(getResourcesByTier(1), centerX, centerY, 60, 15),
    ...ring(getResourcesByTier(2), centerX, centerY, 125, 13),
    ...ring(getResourcesByTier(3), centerX, centerY, 185, 12),
    ...ring(getResourcesByTier(4), centerX, centerY, 245, 11),
    ...ring([...getResourcesByTier(5), ...getResourcesByTier('special')], centerX, centerY, 300, 12, Math.PI / 6),
  ]
}

export function closeButtonBounds(width: number) {
  const centerX = width / 2
  return { x: centerX + 300, y: 60, size: CLOSE_BUTTON_SIZE }
}

export function hitTestWheelClose(width: number, x: number, y: number): boolean {
  const b = closeButtonBounds(width)
  return x >= b.x && x <= b.x + b.size && y >= b.y && y <= b.y + b.size
}

export function hitTestWheelSwatch(swatches: WheelSwatch[], x: number, y: number): WheelSwatch | null {
  return swatches.find((s) => Math.hypot(s.x - x, s.y - y) <= s.radius + 6) ?? null
}

/** Zeigt beide alternativen Misch-Rezepte (Dreieck + Fünfeck, siehe data/resources.ts) — der
 * Spieler kann sich für jede Farbe aussuchen, welchen Prisma-Typ er dafür baut. */
function describeRecipe(resource: ResourceDefinition): string {
  if (resource.tier === 'special') return 'Combat resource (no mixing)'
  if (resource.tier === 1) return 'Base color (purchased)'

  const alternatives: string[] = []
  if (resource.triangleRecipe) {
    alternatives.push(`Triangle: ${resource.triangleRecipe.map((id) => getResource(id).name).join(' + ')}`)
  }
  if (resource.pentagonRecipe) {
    const { c, m, y } = resource.pentagonRecipe
    const parts: string[] = []
    if (c > 0) parts.push(`${c} Cyan`)
    if (m > 0) parts.push(`${m} Magenta`)
    if (y > 0) parts.push(`${y} Yellow`)
    alternatives.push(`Pentagon: ${parts.join(' + ')}`)
  }
  if (resource.pentagonSpecial) {
    alternatives.push(`Pentagon: any ${resource.pentagonSpecial.count} Tier-${resource.pentagonSpecial.tier} colors`)
  }
  return alternatives.join(' · ')
}

/** Text mit eigenem, blickdichtem Hintergrund-Chip — bleibt lesbar, egal was dahinterliegt. */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  font: string,
  color: string,
  lineHeight: number,
) {
  ctx.save()
  ctx.font = font
  ctx.textAlign = 'center'
  const textWidth = ctx.measureText(text).width
  const paddingX = 6
  const paddingY = 3
  const rectX = x - textWidth / 2 - paddingX
  const rectY = y - lineHeight + paddingY
  const rectW = textWidth + paddingX * 2
  const rectH = lineHeight + paddingY

  ctx.fillStyle = 'rgba(4, 5, 8, 0.9)'
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath()
    ctx.roundRect(rectX, rectY, rectW, rectH, 4)
    ctx.fill()
  } else {
    ctx.fillRect(rectX, rectY, rectW, rectH)
  }

  ctx.fillStyle = color
  ctx.fillText(text, x, y)
  ctx.restore()
}

export function drawColorWheelPanel(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  swatches: WheelSwatch[],
  hoveredId: string | null,
  subtitle = 'Tier 1 inside -> Tier 5 outside, Lumen/Prism in the outer ring',
  disabledIds: Set<string> = new Set(),
) {
  const centerX = width / 2
  const centerY = height / 2

  // Ganzflächiger Abdunkler (Modal-Scrim) + eigene, blickdichte Panel-Scheibe hinter dem Wheel —
  // ohne diese Panel-Fläche war das Wheel vor dem durchscheinenden Spiel dahinter kaum lesbar.
  ctx.save()
  ctx.fillStyle = 'rgba(3, 4, 6, 0.92)'
  ctx.fillRect(0, 0, width, height)
  ctx.restore()

  ctx.save()
  ctx.fillStyle = PANEL_FILL
  ctx.strokeStyle = COLORS.gridLineStrong
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(centerX, centerY, PANEL_RADIUS, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()

  drawLabel(ctx, 'C O L O R W H E E L', centerX, centerY - 320, 'bold 16px monospace', COLORS.textBright, 20)
  drawLabel(ctx, subtitle, centerX, centerY - 300, '11px monospace', COLORS.textDim, 14)

  for (const swatch of swatches) {
    const isHovered = hoveredId === swatch.resource.id
    const isDisabled = disabledIds.has(swatch.resource.id)
    ctx.save()
    ctx.globalAlpha = isDisabled ? 0.3 : 1
    drawCircle(ctx, swatch.x, swatch.y, swatch.radius, swatch.resource.color, isHovered ? 22 : 8)
    if (isHovered) drawCircleOutline(ctx, swatch.x, swatch.y, swatch.radius + 5, isDisabled ? '#ff3355' : COLORS.textBright, 1.5, 6)
    ctx.restore()

    drawLabel(
      ctx,
      swatch.resource.name,
      swatch.x,
      swatch.y + swatch.radius + 14,
      '9px monospace',
      isHovered ? COLORS.textBright : COLORS.textDim,
      11,
    )
  }

  const hovered = swatches.find((s) => s.resource.id === hoveredId)
  let infoText = 'Hover over a color to see its recipe'
  if (hovered) {
    infoText = `${hovered.resource.name} — ${describeRecipe(hovered.resource)}`
    if (disabledIds.has(hovered.resource.id)) infoText += ' (rate too low)'
  }
  drawLabel(ctx, infoText, centerX, centerY + 320, '13px monospace', COLORS.textBright, 18)

  const close = closeButtonBounds(width)
  ctx.save()
  ctx.fillStyle = PANEL_FILL
  ctx.fillRect(close.x, close.y, close.size, close.size)
  ctx.strokeStyle = COLORS.textBright
  ctx.lineWidth = 1.5
  ctx.strokeRect(close.x, close.y, close.size, close.size)
  ctx.beginPath()
  ctx.moveTo(close.x + 7, close.y + 7)
  ctx.lineTo(close.x + close.size - 7, close.y + close.size - 7)
  ctx.moveTo(close.x + close.size - 7, close.y + 7)
  ctx.lineTo(close.x + 7, close.y + close.size - 7)
  ctx.stroke()
  ctx.restore()
}
