import { COLORS, readableTextColor } from '../constants/colors'
import { RESOURCES, type ResourceDefinition } from '../data/resources'
import { drawCircle, drawCircleOutline } from './shapes'

// Munitions-Auswahl fürs Farbwheel-Panel (Klick auf die "Ammo"-Zeile eines Turms, siehe main.ts
// wheelMode==='ammo') — bewusst KEIN Rezept-Diagramm (das steht stattdessen im Farb-Guide, siehe
// render/referencePanels.ts drawColorGuideList()), sondern eine einfache, flache Übersicht aller
// Farben mit ihrer AKTUELLEN Produktionsrate — User-Vorgabe: "just an overview of all colors
// including the current production rate".

export interface WheelSwatch {
  resource: ResourceDefinition
  x: number
  y: number
  radius: number
}

const PANEL_FILL = '#0b0d12'
const CLOSE_BUTTON_SIZE = 26
const COLS = 4

interface PanelBounds {
  x: number
  y: number
  width: number
  height: number
  closeButton: { x: number; y: number; size: number }
}

function panelBounds(width: number, height: number): PanelBounds {
  const panelWidth = Math.min(880, width - 80)
  const panelHeight = Math.min(620, height - 60)
  const x = (width - panelWidth) / 2
  const y = (height - panelHeight) / 2
  return { x, y, width: panelWidth, height: panelHeight, closeButton: { x: x + panelWidth - 40, y: y + 14, size: CLOSE_BUTTON_SIZE } }
}

export function hitTestWheelClose(width: number, height: number, x: number, y: number): boolean {
  const b = panelBounds(width, height).closeButton
  return x >= b.x && x <= b.x + b.size && y >= b.y && y <= b.y + b.size
}

export function hitTestWheelSwatch(swatches: WheelSwatch[], x: number, y: number): WheelSwatch | null {
  return swatches.find((s) => Math.hypot(s.x - x, s.y - y) <= s.radius + 6) ?? null
}

/** Munition kommt nur aus Farben, die die Wirtschaft tatsächlich produziert — Lumen/Prisma sind
 * Kampf-Belohnungen ohne laufende Produktionsrate (siehe data/resources.ts) und würden, als
 * Munition zugewiesen, einen Turm dauerhaft "ohne Munition" (und damit permanent feuerlos)
 * stehen lassen, ohne dass das für den Spieler ersichtlich wäre. */
const AMMO_RESOURCES = RESOURCES.filter((r) => r.tier !== 'special')

export function buildWheelLayout(width: number, height: number): WheelSwatch[] {
  const bounds = panelBounds(width, height)
  const padding = 20
  const contentX = bounds.x + padding
  const contentY = bounds.y + 60
  const contentW = bounds.width - padding * 2
  const contentH = bounds.height - 60 - padding
  const rows = Math.ceil(AMMO_RESOURCES.length / COLS)
  const cellW = contentW / COLS
  const cellH = contentH / rows

  return AMMO_RESOURCES.map((resource, i) => {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    return {
      resource,
      x: contentX + col * cellW + 26,
      y: contentY + row * cellH + cellH / 2,
      radius: 15,
    }
  })
}

export function drawColorWheelPanel(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  swatches: WheelSwatch[],
  hoveredId: string | null,
  rates: Map<string, number>,
  disabledIds: Set<string> = new Set(),
) {
  const bounds = panelBounds(width, height)

  ctx.save()
  ctx.fillStyle = 'rgba(3, 4, 6, 0.92)'
  ctx.fillRect(0, 0, width, height)
  ctx.restore()

  ctx.save()
  ctx.fillStyle = PANEL_FILL
  ctx.strokeStyle = COLORS.gridLineStrong
  ctx.lineWidth = 2
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath()
    ctx.roundRect(bounds.x, bounds.y, bounds.width, bounds.height, 10)
    ctx.fill()
    ctx.stroke()
  } else {
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height)
    ctx.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height)
  }
  ctx.restore()

  ctx.save()
  ctx.textAlign = 'center'
  ctx.fillStyle = COLORS.textBright
  ctx.font = 'bold 16px monospace'
  ctx.fillText('C H O O S E   A M M O', bounds.x + bounds.width / 2, bounds.y + 32)
  ctx.fillStyle = COLORS.textMid
  ctx.font = '11px monospace'
  ctx.fillText('Click a color to assign it to this tower — rate is the current net production', bounds.x + bounds.width / 2, bounds.y + 48)
  ctx.restore()

  const padding = 20
  const contentX = bounds.x + padding
  const contentW = bounds.width - padding * 2
  const rows = Math.ceil(RESOURCES.length / COLS)
  const contentH = bounds.height - 60 - padding
  const cellW = contentW / COLS
  const cellH = contentH / rows

  swatches.forEach((swatch, i) => {
    const col = i % COLS
    const row = Math.floor(i / COLS)
    const cellX = contentX + col * cellW
    const cellY = bounds.y + 60 + row * cellH
    const isHovered = hoveredId === swatch.resource.id
    const isDisabled = disabledIds.has(swatch.resource.id)

    ctx.save()
    ctx.globalAlpha = isDisabled ? 0.35 : 1
    drawCircle(ctx, swatch.x, swatch.y, swatch.radius, swatch.resource.color, isHovered ? 20 : 8)
    drawCircleOutline(ctx, swatch.x, swatch.y, swatch.radius, COLORS.gridLineStrong, 1, 0)
    if (isHovered) drawCircleOutline(ctx, swatch.x, swatch.y, swatch.radius + 4, isDisabled ? '#ff3355' : COLORS.textBright, 1.5, 6)
    ctx.restore()

    const textX = swatch.x + swatch.radius + 12
    ctx.save()
    ctx.textAlign = 'left'
    ctx.fillStyle = readableTextColor(swatch.resource.color)
    ctx.font = 'bold 12px monospace'
    ctx.fillText(swatch.resource.name, textX, swatch.y - 4)

    const rate = rates.get(swatch.resource.id) ?? 0
    ctx.fillStyle = isDisabled ? '#ff6a80' : COLORS.textMid
    ctx.font = '11px monospace'
    ctx.fillText(`${rate.toFixed(1)}/s`, textX, swatch.y + 12)
    ctx.restore()

    if (col < COLS - 1) {
      ctx.save()
      ctx.strokeStyle = COLORS.gridLine
      ctx.beginPath()
      ctx.moveTo(cellX + cellW, cellY + 10)
      ctx.lineTo(cellX + cellW, cellY + cellH - 10)
      ctx.stroke()
      ctx.restore()
    }
  })

  const close = bounds.closeButton
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
