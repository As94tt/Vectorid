// Drei Seiten hier:
//  - "Türme" (aus dem 'tower-info'-Icon der Defense-Kauf-Leiste, siehe towerRender.ts) listet
//    alle 8 Turmtypen mit Beschreibung + Kampf-Werten. Blockierendes Modal (main.ts towersInfoOpen).
//  - Der Farb-Guide (drawColorGuideList()) fasst KURZ zusammen, woraus jede Farbe gemischt wird
//    (für Tier 3/4 BEIDE Rezept-Varianten) UND welchen Kampfeffekt sie hat — ersetzt die beiden
//    früheren Bild-Infoseiten (Assets/InfoColors.png/ColorEffects.png). Reine Inhalts-Zeichnung
//    ohne eigenes Chrome/Blocking — lebt im festen Mittel-Feld (main.ts drawMiddleStrip()).
//  - Das Willkommens-/Tutorial-Popup (drawWelcomePanel()) erscheint einmalig beim allerersten
//    Start (siehe main.ts, per localStorage gemerkt). Blockierendes Modal wie "Türme".

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
  let last = lines[lines.length - 1]
  let truncated = false
  while (last && ctx.measureText(`${last}…`).width > maxWidth && last.length > 1) {
    last = last.slice(0, -1)
    truncated = true
  }
  if (truncated) lines[lines.length - 1] = `${last}…`
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

/** Dreieck-Rezept als kurze Zeile ("△ A + B"), falls vorhanden. */
function triangleLine(resource: (typeof RESOURCES)[number]): string | null {
  if (!resource.triangleRecipe) return null
  return `△ ${resource.triangleRecipe.map((id) => getResource(id).name).join(' + ')}`
}

/** Hexagon-Rezept als kurze Zeile ("⬡ M+2C+Y" bzw. "⬡ A + B + C" bei den benannten Tier-5-
 * Rezepten), falls vorhanden. */
function hexagonLine(resource: (typeof RESOURCES)[number]): string | null {
  if (resource.hexagonNamedRecipe) return `⬡ ${resource.hexagonNamedRecipe.map((id) => getResource(id).name).join(' + ')}`
  if (resource.hexagonRecipe) {
    const { c, m, y } = resource.hexagonRecipe
    const parts: string[] = []
    if (m > 0) parts.push(m === 1 ? 'M' : `${m}M`)
    if (c > 0) parts.push(c === 1 ? 'C' : `${c}C`)
    if (y > 0) parts.push(y === 1 ? 'Y' : `${y}Y`)
    return `⬡ ${parts.join('+')}`
  }
  return null
}

/** Kombinierter Farb-Guide fürs feste Mittel-Feld zwischen Economy und Defense (siehe main.ts
 * drawMiddleStrip()) — ersetzt die beiden früheren Bild-Infoseiten (siehe Datei-Kommentar oben).
 * Schmale, hohe Liste statt eines zentrierten Modals: EIN Eintrag je Farbe, für Tier 3/4 BEIDE
 * Rezept-Varianten (Dreieck UND Hexagon) übereinander — User-Vorgabe: "beide varianten für t3
 * und t4 farben sollen angezeigt werden". Reine Inhalts-Zeichnung ohne Hintergrund/Rahmen/Titel
 * (das übernimmt main.ts, da der Streifen dort layoutet wird) — `x`/`y`/`width`/`height`
 * begrenzen nur den verfügbaren Platz, es wird nicht gescrollt oder abgeschnitten. */
export function drawColorGuideList(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  const resources = RESOURCES.filter((r) => r.tier !== 'special')
  const lineHeight = 11
  const rowGap = 6
  let cursorY = y

  ctx.save()
  ctx.textAlign = 'left'

  for (const resource of resources) {
    const effect = COLOR_EFFECT_INFO[resource.id]
    const showBoth = resource.tier === 3 || resource.tier === 4
    const recipeLines = showBoth ? [triangleLine(resource), hexagonLine(resource)].filter((l): l is string => !!l) : [triangleLine(resource) ?? hexagonLine(resource) ?? 'purchased']

    const swatchY = cursorY + 6
    drawCircle(ctx, x + 7, swatchY, 7, resource.color, 6)
    drawCircleOutline(ctx, x + 7, swatchY, 7, COLORS.gridLineStrong, 1, 0)

    ctx.fillStyle = readableTextColor(resource.color)
    ctx.font = 'bold 11px monospace'
    ctx.fillText(resource.name, x + 20, swatchY + 4)
    cursorY = swatchY + lineHeight

    ctx.fillStyle = COLORS.textMid
    ctx.font = '9px monospace'
    for (const line of recipeLines) {
      ctx.fillText(line, x + 20, cursorY)
      cursorY += lineHeight
    }

    if (effect) {
      const lines = wrapLines(ctx, `${effect.name}: ${effect.description}`, width - 20, 2)
      lines.forEach((line) => {
        ctx.fillText(line, x + 20, cursorY)
        cursorY += lineHeight
      })
    }

    cursorY += rowGap
    if (cursorY > y + height) break // Sicherheitsbremse, sollte bei normaler Fenstergröße nie greifen
  }

  ctx.restore()
}

const QUICK_START_STEPS: { title: string; body: string }[] = [
  { title: '1. Generate Light', body: 'Place Cyan, Magenta, and Yellow sources to create light beams.' },
  {
    title: '2. Mix Colors',
    body: 'Use prisms to combine colors into stronger resources. Triangle prisms mix 2 colors, Hexagon prisms mix up to 5. Check the Color Guide (the ? between Economy and Defense) for what mixes into what.',
  },
  { title: '3. Store Resources', body: 'Route mixed light into containers to collect colors.' },
  { title: '4. Build Towers', body: 'Choose a tower type and load it with a color to define its combat effect.' },
  {
    title: '5. Defend',
    body: 'Stop enemies before they reach the end. Combine tower types and color effects for powerful synergies. Use mirrors to redirect the enemy path.',
  },
]

/** Einmaliges Willkommens-/Tutorial-Popup (siehe main.ts — per localStorage gemerkt, erscheint
 * nur beim allerersten Start). Teilt sich Chrome/Close-Position mit drawTowerReferencePanel(). */
export function drawWelcomePanel(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const bounds = drawPanelChrome(ctx, width, height, 'Q U I C K   S T A R T')

  const padding = 28
  const contentX = bounds.x + padding
  const contentW = bounds.width - padding * 2
  let cursorY = bounds.y + 50

  ctx.save()
  ctx.textAlign = 'left'
  for (const step of QUICK_START_STEPS) {
    ctx.fillStyle = COLORS.textBright
    ctx.font = 'bold 14px monospace'
    ctx.fillText(step.title, contentX, cursorY)
    cursorY += 20

    ctx.fillStyle = COLORS.textMid
    ctx.font = '12px monospace'
    const lines = wrapLines(ctx, step.body, contentW, 3)
    lines.forEach((line) => {
      ctx.fillText(line, contentX, cursorY)
      cursorY += 16
    })
    cursorY += 14
  }
  ctx.restore()

  ctx.save()
  ctx.textAlign = 'center'
  ctx.fillStyle = COLORS.textBright
  ctx.font = 'bold 15px monospace'
  ctx.fillText('Mix.  Build.  Defend.', bounds.x + bounds.width / 2, bounds.y + bounds.height - 24)
  ctx.restore()
}
