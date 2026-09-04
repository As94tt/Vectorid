// Zwei Nachschlage-Seiten für die Defense-Seite (aus der Turm-Kauf-Leiste heraus geöffnet,
// siehe die 'tower-info'/'ammo-info'-Icons in towerRender.ts): "Türme" listet alle 8 Turmtypen
// mit Beschreibung + Kampf-Werten, "Munition" listet alle 16 Kampf-Farben mit ihrem eigenen,
// festen Effekt (siehe towerdefense/ammoEffects.ts COLOR_EFFECT_INFO/applyAmmoEffect()). Rein
// informativ, blockiert wie das Farbwheel alle anderen Interaktionen, solange offen (siehe main.ts).

import { COLORS, readableTextColor } from '../constants/colors'
import { getResourcesByTier, type ResourceTier } from '../data/resources'
import { COLOR_EFFECT_INFO } from '../towerdefense/ammoEffects'
import { TOWER_DEFINITIONS } from '../towerdefense/towers'
import { drawEffectIcon, EFFECT_ICON_BY_RESOURCE } from './effectIcons'
import { drawCircle, drawCircleOutline, drawHexagonOutline } from './shapes'
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
    ctx.fillStyle = COLORS.textMid
    ctx.font = '11px monospace'
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

/** Kleines Hexagon mit zentrierter Ziffer — der Tier-Marker links jeder Zeile auf den neuen
 * "How Color Mixing Works"/"What Each Color Does"-Infoseiten (siehe Assets/InfoColors.png bzw.
 * Assets/ColorEffects.png). Exportiert, weil colorWheelPanel.ts denselben Marker braucht. */
export function drawTierBadge(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, tier: number) {
  drawHexagonOutline(ctx, x, y, size, COLORS.textBright, 1.5)
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = COLORS.textBright
  ctx.font = `bold ${Math.round(size * 0.9)}px monospace`
  ctx.fillText(`${tier}`, x, y + 1)
  ctx.restore()
}

const AMMO_TIER_LABELS: Record<number, string> = {
  1: 'BASIC EFFECTS',
  2: 'STACKING EFFECTS',
  3: 'SPECIAL STACK EFFECTS',
  4: 'ADVANCED EFFECTS',
  5: 'ULTIMATE EFFECTS',
}

export function drawTowerReferencePanel(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const bounds = drawPanelChrome(ctx, width, height, 'T O W E R S')

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

    ctx.fillStyle = COLORS.textMid
    ctx.font = '12px monospace'
    const descLines = wrapLines(ctx, def.description, textW, 2)
    descLines.forEach((line, li) => ctx.fillText(line, textX, cellY + 34 + li * 13))

    const attackSpeed = (1 / def.fireInterval).toFixed(2)
    const projectile = def.projectileSpeed ? `${def.projectileSpeed}px/s` : '—'
    ctx.fillStyle = COLORS.textMid
    ctx.font = '10px monospace'
    ctx.fillText(`Damage ${def.damage}  ·  Range ${def.range}px  ·  Consumption ${def.consumption}/s`, textX, cellY + cellH - 22)
    ctx.fillText(`Rate ${attackSpeed}/s  ·  Projectile ${projectile}`, textX, cellY + cellH - 10)
    ctx.restore()
  })
}

/** "What Each Color Does" (siehe Assets/ColorEffects.png) — 5 Tier-Zeilen, je mit Hexagon-
 * Tier-Marker links und bis zu 3 Farb-Karten rechts (Tier 5: 2 breitere Karten für Black/White).
 * Inhalte 1:1 aus COLOR_EFFECT_INFO/EFFECT_ICON_BY_RESOURCE (siehe towerdefense/ammoEffects.ts
 * bzw. render/effectIcons.ts). */
export function drawAmmoReferencePanel(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const bounds = drawPanelChrome(ctx, width, height, 'W H A T   E A C H   C O L O R   D O E S', 'Color effects for towers and hits')

  const padding = 18
  const labelW = 118
  const contentX = bounds.x + padding
  const contentY = bounds.y + 64
  const contentW = bounds.width - padding * 2
  const contentH = bounds.height - 64 - padding
  const rowH = contentH / 5
  const cardsX = contentX + labelW
  const cardsW = contentW - labelW

  for (let tier = 1; tier <= 5; tier++) {
    const rowY = contentY + (tier - 1) * rowH
    const rowCenterY = rowY + rowH / 2

    drawTierBadge(ctx, contentX + 14, rowCenterY - 10, 12, tier)
    ctx.save()
    ctx.textAlign = 'left'
    ctx.fillStyle = COLORS.textBright
    ctx.font = 'bold 11px monospace'
    ctx.fillText(`TIER ${tier}`, contentX + 32, rowCenterY - 10)
    ctx.fillStyle = COLORS.textMid
    ctx.font = '9px monospace'
    wrapLines(ctx, AMMO_TIER_LABELS[tier], labelW - 4, 2).forEach((line, li) => ctx.fillText(line, contentX, rowCenterY + 6 + li * 11))
    ctx.restore()

    const resources = getResourcesByTier(tier as ResourceTier)
    const cardGap = 8
    const cardW = (cardsW - cardGap * (resources.length - 1)) / resources.length

    resources.forEach((resource, i) => {
      const effect = COLOR_EFFECT_INFO[resource.id]
      if (!effect) return
      const cardX = cardsX + i * (cardW + cardGap)
      const cardY = rowY + 4
      const cardH = rowH - 8
      const iconKind = EFFECT_ICON_BY_RESOURCE[resource.id]

      ctx.save()
      ctx.strokeStyle = COLORS.gridLineStrong
      ctx.lineWidth = 1
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath()
        ctx.roundRect(cardX, cardY, cardW, cardH, 6)
        ctx.stroke()
      } else {
        ctx.strokeRect(cardX, cardY, cardW, cardH)
      }
      ctx.restore()

      const swatchCenter = { x: cardX + 16, y: cardY + 18 }
      const nameX = cardX + 32
      const textW = cardW - 44
      const iconCenter = { x: cardX + cardW - 20, y: cardY + 18 }

      drawCircle(ctx, swatchCenter.x, swatchCenter.y, 9, resource.color, 8)
      drawCircleOutline(ctx, swatchCenter.x, swatchCenter.y, 9, COLORS.gridLineStrong, 1, 0)
      const iconColor = readableTextColor(resource.color)
      if (iconKind) drawEffectIcon(ctx, iconKind, iconCenter.x, iconCenter.y, 12, iconColor)

      ctx.save()
      ctx.textAlign = 'left'
      ctx.fillStyle = readableTextColor(resource.color)
      ctx.font = 'bold 11px monospace'
      ctx.fillText(resource.name, nameX, cardY + 15)
      ctx.fillStyle = COLORS.textBright
      ctx.font = 'bold 10px monospace'
      ctx.fillText(effect.name, nameX, cardY + 29)

      ctx.fillStyle = COLORS.textMid
      ctx.font = '9px monospace'
      const lines = wrapLines(ctx, effect.description, textW, 3)
      lines.forEach((line, li) => ctx.fillText(line, cardX + 6, cardY + 46 + li * 11))
      ctx.restore()
    })
  }
}
