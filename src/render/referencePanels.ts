// Zwei Nachschlage-Seiten, beide über je ein eigenes Icon geöffnet (main.ts hält den offenen
// Zustand): "Türme" (aus dem 'tower-info'-Icon der Defense-Kauf-Leiste, siehe towerRender.ts)
// listet alle 8 Turmtypen mit Beschreibung + Kampf-Werten. Der "Farb-Guide" (aus dem neuen Hilfe-
// Icon zwischen Economy- und Defense-Seite, siehe main.ts drawHelpToggle()) fasst KURZ zusammen,
// woraus jede Farbe gemischt wird UND welchen Kampfeffekt sie hat — ersetzt die beiden früheren,
// separaten Bild-Infoseiten (Assets/InfoColors.png/ColorEffects.png), die der User stattdessen
// als eine einzige knappe Seite wollte. Rein informativ, blockiert wie das Farbwheel alle
// anderen Interaktionen, solange offen (siehe main.ts).

import { COLORS, readableTextColor } from '../constants/colors'
import { getResource, RESOURCES } from '../data/resources'
import { COLOR_EFFECT_INFO } from '../towerdefense/ammoEffects'
import { TOWER_DEFINITIONS } from '../towerdefense/towers'
import { drawCircle, drawCircleOutline } from './shapes'
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

/** Kurze "woraus gemischt"-Angabe je Farbe fürs kombinierte Guide (Tier 1 = gekauft, Tier 2-4 =
 * Dreieck-Rezept, Tier 5 = die 3 benannten Hexagon-Zutaten — siehe data/resources.ts). Bewusst
 * nur EIN Rezept je Farbe statt beider Alternativen, damit die Seite knapp bleibt. */
function mixSourceText(resource: (typeof RESOURCES)[number]): string {
  if (resource.tier === 1) return 'purchased'
  if (resource.triangleRecipe) return resource.triangleRecipe.map((id) => getResource(id).name).join(' + ')
  if (resource.hexagonNamedRecipe) return resource.hexagonNamedRecipe.map((id) => getResource(id).name).join(' + ')
  return '—'
}

/** Kombinierte Hilfeseite: pro Farbe eine kompakte Zeile mit Misch-Herkunft + Kampf-Effekt.
 * Ersetzt die beiden früheren Bild-Infoseiten (siehe Datei-Kommentar oben). */
export function drawColorGuidePanel(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const bounds = drawPanelChrome(ctx, width, height, 'C O L O R   G U I D E', 'How mixing works and what each color does')

  const resources = RESOURCES.filter((r) => r.tier !== 'special')
  const cols = 2
  const rows = Math.ceil(resources.length / cols)
  const padding = 20
  const contentX = bounds.x + padding
  const contentY = bounds.y + 60
  const contentW = bounds.width - padding * 2
  const contentH = bounds.height - 60 - padding
  const cellW = contentW / cols
  const cellH = contentH / rows

  resources.forEach((resource, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    const cellX = contentX + col * cellW
    const cellY = contentY + row * cellH
    const swatchCenter = { x: cellX + 14, y: cellY + cellH / 2 - 6 }
    const textX = cellX + 30
    const effect = COLOR_EFFECT_INFO[resource.id]

    drawCircle(ctx, swatchCenter.x, swatchCenter.y, 9, resource.color, 7)
    drawCircleOutline(ctx, swatchCenter.x, swatchCenter.y, 9, COLORS.gridLineStrong, 1, 0)

    ctx.save()
    ctx.textAlign = 'left'
    ctx.fillStyle = readableTextColor(resource.color)
    ctx.font = 'bold 12px monospace'
    ctx.fillText(resource.name, textX, cellY + cellH / 2 - 10)

    ctx.fillStyle = COLORS.textMid
    ctx.font = '10px monospace'
    ctx.fillText(`from ${mixSourceText(resource)}`, textX, cellY + cellH / 2 + 4)

    if (effect) {
      ctx.fillStyle = COLORS.textMid
      ctx.font = '9px monospace'
      const line = wrapLines(ctx, `${effect.name}: ${effect.description}`, cellW - (textX - cellX) - 10, 1)[0]
      if (line) ctx.fillText(line, textX, cellY + cellH / 2 + 19)
    }
    ctx.restore()
  })
}
