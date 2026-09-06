// Der Farb-Guide lebt seit einer früheren Runde als IMMER SICHTBARE Seitenleiste links vom Raster
// (User-Vorgabe: "nicht mehr als öffnenbares Popup, sondern immer") — jetzt als Karten-Liste im
// Referenzbild-Look (drawCard(), siehe render/ui.ts), main.ts positioniert + ruft sie jeden Frame
// auf. Die Turmregeln-Liste, die früher direkt darüber stand, ist wieder entfernt (User-Vorgabe:
// "brauche ich nicht") — ein platzierter Turm hat weiterhin seine eigenen Kennzahlen, jetzt in der
// "SELECTED"-Karte der RECHTEN Seitenleiste (siehe main.ts drawSelectedCard()) statt in einem
// schwebenden Info-Panel. Nur das einmalige Willkommens-/Tutorial-Popup (drawWelcomePanel()) ist
// noch ein echtes blockierendes Modal mit Chrome (drawPanelChrome()) — erscheint einmalig beim
// allerersten Start (siehe main.ts, per localStorage gemerkt).

import { COLORS, readableTextColor } from '../constants/colors'
import { getResource, RESOURCES, type ResourceDefinition } from '../data/resources'
import { COLOR_EFFECT_INFO } from '../towerdefense/ammoEffects'
import { drawCircle, drawCircleOutline, drawHexagonOutline, drawTriangleOutline } from './shapes'
import { drawCard } from './ui'

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
  ctx.font = 'bold 17px monospace'
  ctx.fillText(title, bounds.x + bounds.width / 2, bounds.y + 34)
  if (subtitle) {
    ctx.fillStyle = COLORS.textMid
    ctx.font = '12px monospace'
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

const COLOR_CARD_GAP = 8
const COLOR_CARD_PADDING = 10
const COLOR_CARD_ACCENT_WIDTH = 3

/** Inhalt des Farb-Guide — EINE Karte je Farbe (User-Vorgabe: Referenzbild-Karten-Look), farbiger
 * Akzentstreifen links = Ressourcenfarbe, für Tier 3/4 BEIDE Rezept-Varianten (Dreieck UND
 * Hexagon) übereinander (User-Vorgabe: "beide varianten für t3 und t4 farben sollen angezeigt
 * werden"). main.ts ruft sie direkt in der immer sichtbaren Seitenleiste links vom Raster auf
 * (User-Vorgabe: "nicht mehr als öffnenbares Popup, sondern immer"), einmal je Sektion (Primary/
 * Combinations). `x`/`y`/`width`/`height` begrenzen nur den verfügbaren Platz — bricht sauber ab
 * (kein Scrollen), sobald `height` erreicht ist. Gibt die Y-Position nach der letzten Karte
 * zurück, damit main.ts die nächste Sektion direkt darunter anschließen kann. */
export function drawColorGuideList(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  resourceList: ResourceDefinition[] = RESOURCES.filter((r) => r.tier !== 'special'),
): number {
  const lineHeight = 14
  let cursorY = y

  ctx.save()
  ctx.textAlign = 'left'

  for (const resource of resourceList) {
    const effect = COLOR_EFFECT_INFO[resource.id]
    const showBoth = resource.tier === 3 || resource.tier === 4
    const recipeEntries = showBoth
      ? [triangleRecipeEntry(resource), hexagonRecipeEntry(resource)].filter((r): r is RecipeEntry => !!r)
      : [triangleRecipeEntry(resource) ?? hexagonRecipeEntry(resource)].filter((r): r is RecipeEntry => !!r)

    // Höhe erst BERECHNEN (braucht die fertig umgebrochenen Effekt-Zeilen), dann die Karte
    // zeichnen, dann den Inhalt darüber — sonst wüsste die Karte ihre eigene Höhe nicht im Voraus.
    ctx.font = '10px monospace'
    const effectLines = effect ? wrapLines(ctx, `${effect.name}: ${effect.description}`, width - COLOR_CARD_PADDING * 2 - 12, 2) : []
    const recipeLineCount = recipeEntries.length === 0 ? 1 : recipeEntries.length
    const contentLines = recipeLineCount + effectLines.length
    const cardHeight = COLOR_CARD_PADDING * 2 + 16 + contentLines * lineHeight

    if (cursorY + cardHeight > y + height) break // Sicherheitsbremse, sollte bei normaler Fenstergröße nie greifen

    drawCard(ctx, x, cursorY, width, cardHeight)
    ctx.fillStyle = resource.color
    ctx.fillRect(x, cursorY, COLOR_CARD_ACCENT_WIDTH, cardHeight)

    const textX = x + COLOR_CARD_PADDING + 10
    const swatchX = x + COLOR_CARD_PADDING + 3
    let lineY = cursorY + COLOR_CARD_PADDING + 8

    drawCircle(ctx, swatchX, lineY - 3, 6, resource.color, 6)
    drawCircleOutline(ctx, swatchX, lineY - 3, 6, COLORS.gridLineStrong, 1, 0)
    ctx.fillStyle = readableTextColor(resource.color)
    ctx.font = 'bold 12px monospace'
    ctx.fillText(resource.name, textX, lineY)
    lineY += lineHeight

    ctx.font = '10px monospace'
    if (recipeEntries.length === 0) {
      ctx.fillStyle = COLORS.textDim
      ctx.fillText('Purchased', textX, lineY)
      lineY += lineHeight
    } else {
      for (const entry of recipeEntries) {
        drawRecipeIcon(ctx, entry.icon, swatchX, lineY)
        ctx.fillStyle = COLORS.textMid
        ctx.fillText(entry.text, textX, lineY)
        lineY += lineHeight
      }
    }

    ctx.fillStyle = COLORS.textMid
    for (const line of effectLines) {
      ctx.fillText(line, textX, lineY)
      lineY += lineHeight
    }

    cursorY += cardHeight + COLOR_CARD_GAP
  }

  ctx.restore()
  return cursorY
}

/** Kopf der Farb-Guide-Seitenleiste (User-Vorgabe, Referenzbild: Titel + kurze Unterzeile) — die
 * beiden Abschnitte darunter (Primary/Combinations) bekommen ihre eigene, kleinere Überschrift
 * (siehe drawColorSectionHeader()), die Listen selbst sind drawColorGuideList()-Aufrufe. */
export function drawColorGuideSidebarTitle(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save()
  ctx.textAlign = 'left'
  ctx.fillStyle = COLORS.textBright
  ctx.font = 'bold 15px monospace'
  ctx.fillText('Colors & Combinations', x, y)
  ctx.fillStyle = COLORS.textDim
  ctx.font = '11px monospace'
  ctx.fillText('Combine colors to create powerful towers', x, y + 18)
  ctx.restore()
}

/** Kleine Abschnitts-Überschrift innerhalb der Farb-Guide-Seitenleiste ("PRIMARY COLORS" /
 * "COLOR COMBINATIONS", siehe main.ts drawLeftSidebar()). */
export function drawColorSectionHeader(ctx: CanvasRenderingContext2D, x: number, y: number, label: string) {
  ctx.save()
  ctx.textAlign = 'left'
  ctx.fillStyle = COLORS.textDim
  ctx.font = 'bold 11px monospace'
  ctx.fillText(label.toUpperCase(), x, y)
  ctx.restore()
}

const QUICK_START_STEPS: { title: string; body: string }[] = [
  { title: '1. Generate Light', body: 'Place Cyan, Magenta, and Yellow sources to create light beams.' },
  {
    title: '2. Mix Colors',
    body: 'Use prisms to combine colors into stronger resources. Triangle prisms mix 2 colors, Hexagon prisms mix up to 5. Check the Color Guide (left of the grid) for what mixes into what.',
  },
  { title: '3. Build Towers', body: 'Choose a tower type and place it anywhere on the shared grid.' },
  {
    title: '4. Arm Your Towers',
    body: 'Route a beam directly into a tower — whatever color reaches it becomes its ammo automatically. No picking, no storage: the wire IS the ammo, and a stronger beam (a higher-level generator, or a shorter route) arms it more reliably.',
  },
  {
    title: '5. Defend',
    body: 'Enemies march toward the fixed stone above the grid — click it to rotate which way it casts its path. Every building blocks the path, and the path itself blocks light beams crossing it, so plan your layout carefully. Use mirrors to redirect both the enemy path and your light beams.',
  },
  {
    title: '6. Protect Your Base',
    body: 'Every enemy that reaches the stone costs Base HP (bosses cost much more) — waves always keep advancing. At 0 HP the run resets to Wave 1 with full HP, but your buildings and currency are kept.',
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
    ctx.font = 'bold 15px monospace'
    ctx.fillText(step.title, contentX, cursorY)
    cursorY += 20

    ctx.fillStyle = COLORS.textMid
    ctx.font = '13px monospace'
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
  ctx.font = 'bold 16px monospace'
  ctx.fillText('Mix.  Build.  Defend.', bounds.x + bounds.width / 2, bounds.y + bounds.height - 24)
  ctx.restore()
}
