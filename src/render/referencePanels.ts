// Zwei Nachschlage-Seiten für die Defense-Seite (aus der Turm-Kauf-Leiste heraus geöffnet,
// siehe die 'tower-info'/'ammo-info'-Icons in towerRender.ts): "Türme" listet alle 8 Turmtypen
// mit Beschreibung + Kampf-Werten, "Munition" listet alle 16 Kampf-Farben mit ihrem eigenen,
// festen Effekt (siehe towerdefense/ammoEffects.ts COLOR_EFFECT_INFO/applyAmmoEffect()). Rein
// informativ, blockiert wie das Farbwheel alle anderen Interaktionen, solange offen (siehe main.ts).

import { COLORS } from '../constants/colors'
import { RESOURCES } from '../data/resources'
import { COLOR_EFFECT_INFO } from '../towerdefense/ammoEffects'
import { TOWER_DEFINITIONS } from '../towerdefense/towers'
import { drawCircle } from './shapes'
import { drawTowerPreview, TOWER_UNSELECTED_COLOR } from './towerRender'

const PANEL_FILL = '#0b0d12'
const CLOSE_BUTTON_SIZE = 26

interface PanelBounds {
  x: number
  y: number
  width: number
  height: number
  closeButton: { x: number; y: number; size: number }
}

function panelBounds(width: number, height: number): PanelBounds {
  const panelWidth = Math.min(960, width - 120)
  const panelHeight = Math.min(680, height - 120)
  const x = (width - panelWidth) / 2
  const y = (height - panelHeight) / 2
  return { x, y, width: panelWidth, height: panelHeight, closeButton: { x: x + panelWidth - 40, y: y + 14, size: CLOSE_BUTTON_SIZE } }
}

export function hitTestReferencePanelClose(width: number, height: number, x: number, y: number): boolean {
  const b = panelBounds(width, height).closeButton
  return x >= b.x && x <= b.x + b.size && y >= b.y && y <= b.y + b.size
}

function drawPanelChrome(ctx: CanvasRenderingContext2D, width: number, height: number, title: string, subtitle?: string): PanelBounds {
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
  ctx.fillText(title, bounds.x + bounds.width / 2, bounds.y + 34)
  if (subtitle) {
    ctx.fillStyle = COLORS.textDim
    ctx.font = '10px monospace'
    ctx.fillText(subtitle, bounds.x + bounds.width / 2, bounds.y + 50)
  }
  ctx.restore()

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

  return bounds
}

/** Bricht `text` in bis zu `maxLines` Zeilen um (einfacher Greedy-Wortumbruch); überschüssiger
 * Text wird in der letzten Zeile mit "…" abgeschnitten statt den Bereich zu sprengen. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (current && ctx.measureText(candidate).width > maxWidth) {
      lines.push(current)
      current = word
      if (lines.length === maxLines) break
    } else {
      current = candidate
    }
  }
  if (lines.length < maxLines && current) lines.push(current)

  if (lines.length > maxLines) lines.length = maxLines
  const last = lines[lines.length - 1]
  while (last && ctx.measureText(`${last}…`).width > maxWidth && last.length > 1) {
    lines[lines.length - 1] = last.slice(0, -1)
  }
  return lines
}

export function drawTowerReferencePanel(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const bounds = drawPanelChrome(ctx, width, height, 'T Ü R M E')

  const cols = 2
  const rows = Math.ceil(TOWER_DEFINITIONS.length / cols)
  const padding = 22
  const contentX = bounds.x + padding
  const contentY = bounds.y + 58
  const contentW = bounds.width - padding * 2
  const contentH = bounds.height - 58 - padding
  const cellW = contentW / cols
  const cellH = contentH / rows

  TOWER_DEFINITIONS.forEach((def, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const cellX = contentX + col * cellW
    const cellY = contentY + row * cellH
    const iconCenter = { x: cellX + 26, y: cellY + cellH / 2 }
    const textX = cellX + 60
    const textW = cellW - 76

    drawTowerPreview(ctx, def.kind, iconCenter, TOWER_UNSELECTED_COLOR)

    ctx.save()
    ctx.textAlign = 'left'
    ctx.fillStyle = COLORS.textBright
    ctx.font = 'bold 13px monospace'
    ctx.fillText(def.name, textX, cellY + 16)

    ctx.fillStyle = COLORS.textDim
    ctx.font = '10px monospace'
    const descLines = wrapLines(ctx, def.description, textW, 2)
    descLines.forEach((line, li) => ctx.fillText(line, textX, cellY + 32 + li * 12))

    const attackSpeed = (1 / def.fireInterval).toFixed(2)
    const projectile = def.projectileSpeed ? `${def.projectileSpeed}px/s` : '—'
    ctx.fillStyle = COLORS.textDim
    ctx.font = '9px monospace'
    ctx.fillText(`Schaden ${def.damage}  ·  Reichweite ${def.range}px`, textX, cellY + cellH - 22)
    ctx.fillText(`Tempo ${attackSpeed}/s  ·  Projektil ${projectile}`, textX, cellY + cellH - 10)
    ctx.restore()
  })
}

export function drawAmmoReferencePanel(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const bounds = drawPanelChrome(ctx, width, height, 'M U N I T I O N', 'Jede Farbe hat ihren eigenen festen Effekt je Treffer')

  const ammoResources = RESOURCES.filter((r) => r.tier !== 'special')
  const cols = 2
  const rows = Math.ceil(ammoResources.length / cols)
  const padding = 22
  const contentX = bounds.x + padding
  const contentY = bounds.y + 62
  const contentW = bounds.width - padding * 2
  const contentH = bounds.height - 62 - padding
  const cellW = contentW / cols
  const cellH = contentH / rows

  ammoResources.forEach((resource, i) => {
    const effect = COLOR_EFFECT_INFO[resource.id]
    if (!effect) return
    const col = i % cols
    const row = Math.floor(i / cols)
    const cellX = contentX + col * cellW
    const cellY = contentY + row * cellH
    const swatchCenter = { x: cellX + 16, y: cellY + 18 }
    const nameX = cellX + 36
    const textW = cellW - 46

    drawCircle(ctx, swatchCenter.x, swatchCenter.y, 8, resource.color, 8)

    ctx.save()
    ctx.textAlign = 'left'
    ctx.fillStyle = COLORS.textBright
    ctx.font = 'bold 11px monospace'
    ctx.fillText(`${resource.name} — ${effect.name}`, nameX, cellY + 21)

    ctx.fillStyle = COLORS.textDim
    ctx.font = '9px monospace'
    const lines = wrapLines(ctx, effect.description, textW, 2)
    lines.forEach((line, li) => ctx.fillText(line, cellX + 4, cellY + 38 + li * 11))
    ctx.restore()
  })
}
