// Drei Seiten hier, alle blockierende Modals mit derselben Chrome (drawPanelChrome()):
//  - "Türme" (aus dem 'tower-info'-Icon der Kauf-Leiste, siehe towerRender.ts) listet alle 8
//    Turmtypen mit Beschreibung + Kampf-Werten (main.ts towersInfoOpen).
//  - Der Farb-Guide (drawColorGuidePanel(), Inhalt in drawColorGuideList()) fasst KURZ zusammen,
//    woraus jede Farbe gemischt wird (für Tier 3/4 BEIDE Rezept-Varianten) UND welchen Kampfeffekt
//    sie hat, aufgeteilt auf 2 Spalten (main.ts colorGuideOpen, aus dem 'color-guide'-Icon der
//    Kauf-Leiste). Lebte früher als nicht-blockierendes Feld im festen Mittel-Streifen zwischen
//    Economy/Defense — seit der Zusammenlegung auf EIN gemeinsames Raster gibt es diesen Streifen
//    nicht mehr, daher jetzt ein Modal wie die übrigen beiden Seiten hier.
//  - Das Willkommens-/Tutorial-Popup (drawWelcomePanel()) erscheint einmalig beim allerersten
//    Start (siehe main.ts, per localStorage gemerkt).

import { COLORS, readableTextColor } from '../constants/colors'
import { getResource, RESOURCES, type ResourceDefinition } from '../data/resources'
import { COLOR_EFFECT_INFO } from '../towerdefense/ammoEffects'
import { TOWER_DEFINITIONS } from '../towerdefense/towers'
import { drawCircle, drawCircleOutline, drawHexagonOutline, drawTriangleOutline } from './shapes'
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

interface RecipeEntry {
  icon: 'triangle' | 'hexagon'
  text: string
}

/** Dreieck-Rezept ("A + B"), falls vorhanden. */
function triangleRecipeEntry(resource: (typeof RESOURCES)[number]): RecipeEntry | null {
  if (!resource.triangleRecipe) return null
  return { icon: 'triangle', text: resource.triangleRecipe.map((id) => getResource(id).name).join(' + ') }
}

/** Hexagon-Rezept ("M+2C+Y" bzw. "A + B + C" bei den benannten Tier-5-Rezepten), falls vorhanden.
 * Tier 1 hat zwar technisch ein (triviales, 1-teiliges) `hexagonRecipe` fürs Munitions-System
 * (siehe resources.ts), das ist aber keine ECHTE Mischung — die Guide-Liste zeigt dort stattdessen
 * "Purchased" (siehe drawColorGuideList()), daher hier bewusst `null` für Tier 1. */
function hexagonRecipeEntry(resource: (typeof RESOURCES)[number]): RecipeEntry | null {
  if (resource.tier === 1) return null
  if (resource.hexagonNamedRecipe) return { icon: 'hexagon', text: resource.hexagonNamedRecipe.map((id) => getResource(id).name).join(' + ') }
  if (resource.hexagonRecipe) {
    const { c, m, y } = resource.hexagonRecipe
    const parts: string[] = []
    if (m > 0) parts.push(m === 1 ? 'M' : `${m}M`)
    if (c > 0) parts.push(c === 1 ? 'C' : `${c}C`)
    if (y > 0) parts.push(y === 1 ? 'Y' : `${y}Y`)
    return { icon: 'hexagon', text: parts.join('+') }
  }
  return null
}

/** Kleines, gezeichnetes (statt Unicode-Glyphen — die rendern bei 9-10px in vielen Fonts nur als
 * unklarer Klecks, siehe User-Feedback "Qualität der Darstellung ist eine Katastrophe") Dreieck-
 * bzw. Hexagon-Symbol vor einer Rezept-Zeile, mittig auf `textY` (Text-Baseline) ausgerichtet. */
function drawRecipeIcon(ctx: CanvasRenderingContext2D, icon: RecipeEntry['icon'], x: number, textY: number) {
  const cy = textY - 3
  if (icon === 'triangle') drawTriangleOutline(ctx, x, cy + 1, 4, COLORS.textMid, 1.2)
  else drawHexagonOutline(ctx, x, cy, 3.6, COLORS.textMid, 1.2)
}

/** Inhalt des Farb-Guide — EIN Eintrag je Farbe, für Tier 3/4 BEIDE Rezept-Varianten (Dreieck UND
 * Hexagon) übereinander (User-Vorgabe: "beide varianten für t3 und t4 farben sollen angezeigt
 * werden"). Reine Inhalts-Zeichnung ohne Hintergrund/Rahmen/Titel (das übernimmt
 * `drawColorGuidePanel()`) — `x`/`y`/`width`/`height` begrenzen nur den verfügbaren Platz, es wird
 * nicht gescrollt oder abgeschnitten. `resourceList` lässt `drawColorGuidePanel()` die Farben auf
 * 2 Spalten aufteilen (Default = alle Nicht-Spezial-Farben in einer einzigen Liste). */
export function drawColorGuideList(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  resourceList: ResourceDefinition[] = RESOURCES.filter((r) => r.tier !== 'special'),
) {
  const resources = resourceList
  const lineHeight = 11
  const rowGap = 6
  let cursorY = y

  ctx.save()
  ctx.textAlign = 'left'

  for (const resource of resources) {
    const effect = COLOR_EFFECT_INFO[resource.id]
    const showBoth = resource.tier === 3 || resource.tier === 4
    const recipeEntries = showBoth
      ? [triangleRecipeEntry(resource), hexagonRecipeEntry(resource)].filter((r): r is RecipeEntry => !!r)
      : [triangleRecipeEntry(resource) ?? hexagonRecipeEntry(resource)].filter((r): r is RecipeEntry => !!r)

    const swatchY = cursorY + 6
    drawCircle(ctx, x + 7, swatchY, 7, resource.color, 6)
    drawCircleOutline(ctx, x + 7, swatchY, 7, COLORS.gridLineStrong, 1, 0)

    ctx.fillStyle = readableTextColor(resource.color)
    ctx.font = 'bold 11px monospace'
    ctx.fillText(resource.name, x + 20, swatchY + 4)
    cursorY = swatchY + lineHeight

    ctx.font = '9px monospace'
    if (recipeEntries.length === 0) {
      ctx.fillStyle = COLORS.textDim
      ctx.fillText('Purchased', x + 20, cursorY)
      cursorY += lineHeight
    } else {
      for (const entry of recipeEntries) {
        drawRecipeIcon(ctx, entry.icon, x + 7, cursorY)
        ctx.fillStyle = COLORS.textMid
        ctx.fillText(entry.text, x + 20, cursorY)
        cursorY += lineHeight
      }
    }

    if (effect) {
      ctx.fillStyle = COLORS.textMid
      const lines = wrapLines(ctx, `${effect.name}: ${effect.description}`, width - 20, 2)
      lines.forEach((line) => {
        ctx.fillText(line, x + 20, cursorY)
        cursorY += lineHeight
      })
    }

    cursorY += rowGap
    if (cursorY > y + height) break // Sicherheitsbremse, sollte bei normaler Fenstergröße nie greifen

    ctx.strokeStyle = COLORS.gridLine
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, cursorY - rowGap / 2)
    ctx.lineTo(x + width, cursorY - rowGap / 2)
    ctx.stroke()
  }

  ctx.restore()
}

/** Farb-Guide als eigenes blockierendes Modal (User-Vorgabe seit der Zusammenlegung auf ein
 * gemeinsames Raster: das feste Mittel-Feld zwischen Economy/Defense, in dem der Guide früher als
 * nicht-blockierendes Feld lebte, gibt es nicht mehr — dieselbe Chrome wie `drawTowerReferencePanel()`,
 * geöffnet über das neue "Colors"-Icon in der Kauf-Leiste, siehe towerRender.ts). Teilt die Farben
 * auf 2 Spalten auf, damit die Liste in der Modal-Höhe Platz hat, statt in einer einzigen, sehr
 * hohen Spalte zu laufen. */
export function drawColorGuidePanel(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const bounds = drawPanelChrome(ctx, width, height, 'C O L O R   G U I D E')

  const all = RESOURCES.filter((r) => r.tier !== 'special')
  const mid = Math.ceil(all.length / 2)
  const left = all.slice(0, mid)
  const right = all.slice(mid)

  const columnWidth = 340
  const columnGap = 40
  const startX = bounds.x + (bounds.width - (columnWidth * 2 + columnGap)) / 2
  const contentY = bounds.y + 58
  const contentHeight = bounds.height - 58 - 20

  drawColorGuideList(ctx, startX, contentY, columnWidth, contentHeight, left)
  drawColorGuideList(ctx, startX + columnWidth + columnGap, contentY, columnWidth, contentHeight, right)
}

const QUICK_START_STEPS: { title: string; body: string }[] = [
  { title: '1. Generate Light', body: 'Place Cyan, Magenta, and Yellow sources to create light beams.' },
  {
    title: '2. Mix Colors',
    body: 'Use prisms to combine colors into stronger resources. Triangle prisms mix 2 colors, Hexagon prisms mix up to 5. Check the Color Guide (the icon in the build bar) for what mixes into what.',
  },
  { title: '3. Build Towers', body: 'Choose a tower type and place it anywhere on the shared grid.' },
  {
    title: '4. Arm Your Towers',
    body: 'Route a beam directly into a tower — whatever color reaches it becomes its ammo automatically. No picking, no storage: the wire IS the ammo, and a stronger beam (a higher-level generator, or a shorter route) arms it more reliably.',
  },
  {
    title: '5. Defend',
    body: 'Stop enemies before they reach the end. Every building blocks their path, not just towers, so plan your layout carefully. Use mirrors to redirect the enemy path — and your light beams.',
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
