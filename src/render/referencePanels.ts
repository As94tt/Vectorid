// Der Farb-Guide lebt seit einer früheren Runde als IMMER SICHTBARE Seitenleiste links vom Raster
// (User-Vorgabe: "nicht mehr als öffnenbares Popup, sondern immer") — jetzt als Karten-Liste im
// Referenzbild-Look (drawCard(), siehe render/ui.ts), main.ts positioniert + ruft sie jeden Frame
// auf. Die Turmregeln-Liste, die früher direkt darüber stand, ist wieder entfernt (User-Vorgabe:
// "brauche ich nicht") — ein platzierter Turm hat weiterhin seine eigenen Kennzahlen, jetzt in der
// "SELECTED"-Karte der RECHTEN Seitenleiste (siehe main.ts drawSelectedCard()) statt in einem
// schwebenden Info-Panel. Zwei Arten blockierender Modals mit gemeinsamer Chrome
// (drawPanelChrome()) bleiben: das einmalige Willkommens-/Tutorial-Popup (drawWelcomePanel(),
// erscheint einmalig beim allerersten Start, siehe main.ts) und die neuen Erstbau-Tipp-Felder
// (drawBuildingTipPanel(), einmal pro Gebäude-/Turmart) — beide per localStorage gemerkt, beide
// über das "Disable tips"-Häkchen im Quick-Start-Popup gemeinsam abschaltbar.

import { COLORS, readableTextColor } from '../constants/colors'
import { getResource, RESOURCES, type ResourceDefinition } from '../data/resources'
import { COLOR_EFFECT_INFO } from '../towerdefense/ammoEffects'
import type { TowerKind } from '../towerdefense/towers'
import { drawCircle, drawCircleOutline, drawHexagonOutline, drawTriangleOutline } from './shapes'
import { drawCard } from './ui'

const PANEL_FILL = '#0b0d12'
const CLOSE_BUTTON_SIZE = 26
const DEFAULT_PANEL_MAX_WIDTH = 960
const DEFAULT_PANEL_MAX_HEIGHT = 680

interface PanelBounds {
  x: number
  y: number
  width: number
  height: number
  closeButton: { x: number; y: number; size: number }
}

/** `maxWidth`/`maxHeight` lassen ein kleineres Modal zu (siehe drawBuildingTipPanel()) — ein
 * einzelner kurzer Tipp braucht nicht die volle Quick-Start-Panelgröße. Muss beim Hit-Test
 * (hitTestReferencePanelClose()/hitTestBuildingTipClose()) exakt dieselben Werte bekommen wie beim
 * Zeichnen, sonst verschiebt sich der Schließen-Knopf gegenüber seiner sichtbaren Position. */
function panelBounds(width: number, height: number, maxWidth = DEFAULT_PANEL_MAX_WIDTH, maxHeight = DEFAULT_PANEL_MAX_HEIGHT): PanelBounds {
  const panelWidth = Math.min(maxWidth, width - 120)
  const panelHeight = Math.min(maxHeight, height - 120)
  const x = (width - panelWidth) / 2
  const y = (height - panelHeight) / 2
  return { x, y, width: panelWidth, height: panelHeight, closeButton: { x: x + panelWidth - 40, y: y + 14, size: CLOSE_BUTTON_SIZE } }
}

export function hitTestReferencePanelClose(width: number, height: number, x: number, y: number): boolean {
  const b = panelBounds(width, height).closeButton
  return x >= b.x && x <= b.x + b.size && y >= b.y && y <= b.y + b.size
}

function drawPanelChrome(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  title: string,
  subtitle?: string,
  maxWidth = DEFAULT_PANEL_MAX_WIDTH,
  maxHeight = DEFAULT_PANEL_MAX_HEIGHT,
): PanelBounds {
  const bounds = panelBounds(width, height, maxWidth, maxHeight)

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
  ctx.font = 'bold 18px monospace'
  ctx.fillText(title, bounds.x + bounds.width / 2, bounds.y + 34)
  if (subtitle) {
    ctx.fillStyle = COLORS.textMid
    ctx.font = '13px monospace'
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
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
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

const TIER_HEADER_HEIGHT = 20
const DETAIL_CARD_GAP = 8
const DETAIL_CARD_PADDING = 10
const DETAIL_CARD_ACCENT_WIDTH = 3
const DETAIL_LINE_HEIGHT = 14
const TIER_GROUP_GAP = 14

/** "TIER N ------" — Label und Trennstrich in derselben Zeile (User-Vorgabe), Strich füllt den
 * Rest von `width` nach dem Label. */
function drawTierHeader(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, tier: ResourceDefinition['tier']) {
  ctx.save()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = COLORS.textDim
  ctx.font = 'bold 12px monospace'
  const label = `TIER ${tier}`
  ctx.fillText(label, x, y)
  const labelWidth = ctx.measureText(label).width
  ctx.strokeStyle = COLORS.gridLineStrong
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(x + labelWidth + 8, y)
  ctx.lineTo(x + width, y)
  ctx.stroke()
  ctx.restore()
}

/** Farb-Guide: je Tier eine Kopfzeile (Trennstrich + "TIER N", User-Vorgabe), darunter — je Farbe
 * — eine volle Detail-Karte mit Rezept(en) + Effekt (User-Vorgabe: "ich will weiter die
 * Beschreibung... links beschrieben haben" — die kompakte Chip-Reihe aus einer früheren Runde
 * wollte der User NICHT: "ich brauche nicht die extra Reihe von nur den Farben"). `x`/`y`/`width`/
 * `height` begrenzen nur den verfügbaren Platz — bricht sauber ab (kein Scrollen), sobald `height`
 * erreicht ist. Gibt die Y-Position nach der letzten Karte zurück. */
export function drawColorGuideList(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  resourceList: ResourceDefinition[] = RESOURCES.filter((r) => r.tier !== 'special'),
  // Progress-System (User-Vorgabe): main.ts filtert `resourceList` bereits auf freigeschaltete
  // Tiers herunter (siehe unlockedColorTiers) — kennt aber auch das nächste NOCH gesperrte Tier
  // (falls es eins gibt) und reicht dessen Nummer hier durch, damit direkt im Anschluss ein
  // Hinweis-Platzhalter dafür erscheint (siehe drawLockedTierPlaceholder()).
  nextLockedTier: ResourceDefinition['tier'] | null = null,
): number {
  const tiers = new Map<ResourceDefinition['tier'], ResourceDefinition[]>()
  for (const r of resourceList) {
    if (!tiers.has(r.tier)) tiers.set(r.tier, [])
    tiers.get(r.tier)!.push(r)
  }

  let cursorY = y
  ctx.save()
  ctx.textAlign = 'left'

  tierLoop: for (const [tier, list] of tiers) {
    if (cursorY + TIER_HEADER_HEIGHT > y + height) break
    drawTierHeader(ctx, x, cursorY + 10, width, tier)
    cursorY += TIER_HEADER_HEIGHT + 8

    for (const resource of list) {
      const effect = COLOR_EFFECT_INFO[resource.id]
      // User-Vorgabe: Black/White sollen im Guide auftauchen (Name + Effekt sichtbar, "der Spieler
      // soll wissen, dass es sie gibt"), aber ihr Rezept bleibt geheim ("nicht, wie sie
      // zusammengesetzt werden") — ein einzelner "???"-Platzhalter statt der echten Zutaten-Liste.
      const showBoth = resource.tier === 3 || resource.tier === 4
      const recipeEntries: RecipeEntry[] =
        resource.tier === 5
          ? [{ icon: 'hexagon', text: '???' }]
          : showBoth
            ? [triangleRecipeEntry(resource), hexagonRecipeEntry(resource)].filter((r): r is RecipeEntry => !!r)
            : [triangleRecipeEntry(resource) ?? hexagonRecipeEntry(resource)].filter((r): r is RecipeEntry => !!r)

      // Höhe erst BERECHNEN (braucht die fertig umgebrochenen Effekt-Zeilen), dann die Karte
      // zeichnen, dann den Inhalt darüber — sonst wüsste die Karte ihre eigene Höhe nicht im Voraus.
      ctx.font = '11px monospace'
      const effectLines = effect ? wrapLines(ctx, `${effect.name}: ${effect.description}`, width - DETAIL_CARD_PADDING * 2 - 12, 2) : []
      const recipeLineCount = recipeEntries.length === 0 ? 1 : recipeEntries.length
      const contentLines = recipeLineCount + effectLines.length
      const cardHeight = DETAIL_CARD_PADDING * 2 + 16 + contentLines * DETAIL_LINE_HEIGHT

      if (cursorY + cardHeight > y + height) break tierLoop // Sicherheitsbremse, sollte bei normaler Fenstergröße nie greifen

      drawCard(ctx, x, cursorY, width, cardHeight)
      ctx.fillStyle = resource.color
      ctx.fillRect(x, cursorY, DETAIL_CARD_ACCENT_WIDTH, cardHeight)

      const textX = x + DETAIL_CARD_PADDING + 10
      const swatchX = x + DETAIL_CARD_PADDING + 3
      let lineY = cursorY + DETAIL_CARD_PADDING + 8

      drawCircle(ctx, swatchX, lineY - 3, 6, resource.color, 6)
      drawCircleOutline(ctx, swatchX, lineY - 3, 6, COLORS.gridLineStrong, 1, 0)
      ctx.fillStyle = readableTextColor(resource.color)
      ctx.font = 'bold 13px monospace'
      ctx.fillText(resource.name, textX, lineY)
      lineY += DETAIL_LINE_HEIGHT

      ctx.font = '11px monospace'
      if (recipeEntries.length === 0) {
        ctx.fillStyle = COLORS.textDim
        ctx.fillText('Purchased', textX, lineY)
        lineY += DETAIL_LINE_HEIGHT
      } else {
        for (const entry of recipeEntries) {
          drawRecipeIcon(ctx, entry.icon, swatchX, lineY)
          ctx.fillStyle = COLORS.textMid
          ctx.fillText(entry.text, textX, lineY)
          lineY += DETAIL_LINE_HEIGHT
        }
      }

      ctx.fillStyle = COLORS.textMid
      for (const line of effectLines) {
        ctx.fillText(line, textX, lineY)
        lineY += DETAIL_LINE_HEIGHT
      }

      cursorY += cardHeight + DETAIL_CARD_GAP
    }

    cursorY += TIER_GROUP_GAP - DETAIL_CARD_GAP
  }

  if (nextLockedTier !== null) cursorY = drawLockedTierPlaceholder(ctx, x, cursorY, width, y + height)

  ctx.restore()
  return cursorY
}

const LOCKED_TIER_MESSAGE = 'Create all previous colors to unlock the next tier.'

/** Progress-System (User-Vorgabe): Hinweis-Karte anstelle der (noch gesperrten) Rezept-Karten des
 * nächsten Tiers — bewusst OHNE Tier-Nummer/-Kopfzeile, der exakte Wortlaut ist User-Vorgabe.
 * Erscheint nur, wenn noch Platz ist (dieselbe "kein Scrollen"-Sicherheitsbremse wie beim Rest der
 * Liste), gibt sonst `maxY` unverändert zurück. */
function drawLockedTierPlaceholder(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, maxY: number): number {
  ctx.font = '11px monospace'
  const lines = wrapLines(ctx, LOCKED_TIER_MESSAGE, width - DETAIL_CARD_PADDING * 2, 3)
  const cardHeight = DETAIL_CARD_PADDING * 2 + lines.length * DETAIL_LINE_HEIGHT
  if (y + cardHeight > maxY) return y

  drawCard(ctx, x, y, width, cardHeight)
  ctx.save()
  ctx.textAlign = 'center'
  ctx.fillStyle = COLORS.textDim
  let lineY = y + DETAIL_CARD_PADDING + 8
  for (const line of lines) {
    ctx.fillText(line, x + width / 2, lineY)
    lineY += DETAIL_LINE_HEIGHT
  }
  ctx.restore()
  return y + cardHeight
}

/** Kopf der Farb-Guide-Seitenleiste (User-Vorgabe, Referenzbild: Titel + kurze Unterzeile) — die
 * Tier-Gruppen darunter bekommen ihre eigene Kopfzeile (siehe drawTierHeader(), innerhalb
 * drawColorGuideList()). */
export function drawColorGuideSidebarTitle(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save()
  ctx.textAlign = 'left'
  ctx.fillStyle = COLORS.textBright
  ctx.font = 'bold 16px monospace'
  ctx.fillText('Colors & Combinations', x, y)
  ctx.fillStyle = COLORS.textDim
  ctx.font = '12px monospace'
  ctx.fillText('Combine colors to create powerful towers', x, y + 18)
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
    body: 'Route a beam directly into a tower — whatever color reaches it becomes its ammo automatically. No picking, no storage: the wire IS the ammo, and only whether the beam arrives matters, not its strength.',
  },
  {
    title: '5. Defend',
    body: 'Enemies march toward the fixed stone above the grid, always from the same fixed direction. Every building blocks the path, and the path itself blocks light beams crossing it, so plan your layout carefully. Use mirrors to redirect both the enemy path and your light beams.',
  },
  {
    title: '6. Protect Your Base',
    body: 'Every enemy that reaches the stone costs Base HP (bosses cost much more) — waves always keep advancing. At 0 HP the run resets to Wave 1 with full HP, but your buildings and currency are kept.',
  },
]

const TIPS_TOGGLE_SIZE = 16

/** Position des "Disable tips"-Häkchens (User-Vorgabe: "beim Quick-Start-Tutorial-Text soll es die
 * Option geben, Tipps zu deaktivieren") — unten links im Panel, auf derselben Höhe wie die
 * zentrierte Tagline, die bei der üblichen Panelbreite genug Platz auf beiden Seiten lässt. Eigene
 * Funktion (statt inline in drawWelcomePanel()), damit Zeichnen und Hit-Test garantiert dieselbe
 * Position meinen. */
function tipsToggleBounds(width: number, height: number) {
  const bounds = panelBounds(width, height)
  return { x: bounds.x + 28, y: bounds.y + bounds.height - 32, size: TIPS_TOGGLE_SIZE }
}

export function hitTestTipsToggle(width: number, height: number, x: number, y: number): boolean {
  const b = tipsToggleBounds(width, height)
  return x >= b.x && x <= b.x + b.size && y >= b.y && y <= b.y + b.size
}

/** Einmaliges Willkommens-/Tutorial-Popup (siehe main.ts — per localStorage gemerkt, erscheint
 * nur beim allerersten Start). Teilt sich Chrome/Close-Position mit drawTowerReferencePanel().
 * `tipsDisabled` steuert nur den Häkchen-Zustand hier — main.ts hält den eigentlichen State (auch
 * die neuen Erstbau-Tipps unten hängen daran, siehe drawBuildingTipPanel()). */
export function drawWelcomePanel(ctx: CanvasRenderingContext2D, width: number, height: number, tipsDisabled: boolean) {
  const bounds = drawPanelChrome(ctx, width, height, 'Q U I C K   S T A R T')

  const padding = 28
  const contentX = bounds.x + padding
  const contentW = bounds.width - padding * 2
  let cursorY = bounds.y + 50

  ctx.save()
  ctx.textAlign = 'left'
  for (const step of QUICK_START_STEPS) {
    ctx.fillStyle = COLORS.textBright
    ctx.font = 'bold 16px monospace'
    ctx.fillText(step.title, contentX, cursorY)
    cursorY += 20

    ctx.fillStyle = COLORS.textMid
    ctx.font = '14px monospace'
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
  ctx.font = 'bold 17px monospace'
  ctx.fillText('Mix.  Build.  Defend.', bounds.x + bounds.width / 2, bounds.y + bounds.height - 24)
  ctx.restore()

  const toggle = tipsToggleBounds(width, height)
  ctx.save()
  ctx.strokeStyle = COLORS.textMid
  ctx.lineWidth = 1.5
  ctx.strokeRect(toggle.x, toggle.y, toggle.size, toggle.size)
  if (tipsDisabled) {
    ctx.strokeStyle = COLORS.accent
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(toggle.x + 3, toggle.y + toggle.size / 2)
    ctx.lineTo(toggle.x + toggle.size / 2, toggle.y + toggle.size - 3)
    ctx.lineTo(toggle.x + toggle.size - 3, toggle.y + 3)
    ctx.stroke()
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = COLORS.textMid
  ctx.font = '13px monospace'
  ctx.fillText('Disable tips', toggle.x + toggle.size + 8, toggle.y + toggle.size - 3)
  ctx.restore()
}

/** Kurzer Erklärtext je Gebäude-/Turmart fürs Erstbau-Tipp-Feld (siehe drawBuildingTipPanel()) —
 * Schlüssel sind dieselben Kind-Strings wie in main.ts' PaletteKind (nur Bau-relevante: Quelle/
 * Spiegel/beide Prisma-Arten, nicht 'expand-grid' — das ist keine "Gebäudeart") bzw. TowerKind. */
export type BuildingTipKind = 'source' | 'mirror' | 'prism-simple' | 'prism-complex' | TowerKind

interface BuildingTipContent {
  title: string
  body: string
}

const BUILDING_TIPS: Record<BuildingTipKind, BuildingTipContent> = {
  source: {
    title: 'Light Source',
    body: 'Emits a beam of its color in all 6 directions at once. Route a beam into a tower to arm it, or into a prism to mix colors. Select it and use UPGRADE to increase its range.',
  },
  mirror: {
    title: 'Mirror',
    body: "Redirects any beam that hits it — light or the enemy path — by 60°. Click it to rotate. It's the only building allowed directly on the enemy path.",
  },
  'prism-simple': {
    title: 'Triangle Prism',
    body: 'Mixes 2 incoming beams into a stronger combined color, once both source colors are active somewhere. Click it to rotate which corner receives the beams.',
  },
  'prism-complex': {
    title: 'Hexagon Prism',
    body: 'Mixes up to 5 incoming beams into a powerful combined color. Click it to rotate. Unlocks once the required color tier is active.',
  },
  rapid: {
    title: 'Rapid Tower',
    body: 'Very high fire rate, low damage per hit — a reliable all-rounder, especially early on.',
  },
  cannon: {
    title: 'Cannon Tower',
    body: 'Slow projectiles that deal splash damage on impact — strong against groups of enemies.',
  },
  sniper: {
    title: 'Sniper Tower',
    body: 'Slow fire rate, very long range, high single-target damage — best against tough single enemies.',
  },
  multishot: {
    title: 'Multishot Tower',
    body: 'Fires several projectiles at once, each at a different target.',
  },
  pulse: {
    title: 'Pulse Tower',
    body: "Pulses 360° around itself with short range and low damage — its role is spreading status-effect stacks (Burn, Poison, ...), not raw damage.",
  },
  flamethrower: {
    title: 'Flamethrower Tower',
    body: 'Burns a continuous cone-shaped stream in front of it, hitting everything caught inside.',
  },
  burst: {
    title: 'Burst Tower',
    body: 'Charges up, then fires a powerful volley of projectiles all at once.',
  },
  beam: {
    title: 'Beam Tower',
    body: 'Locks a permanent laser onto one target and keeps firing as long as it stays in range.',
  },
}

const BUILDING_TIP_MAX_WIDTH = 460
const BUILDING_TIP_MAX_HEIGHT = 240

export function hitTestBuildingTipClose(width: number, height: number, x: number, y: number): boolean {
  const b = panelBounds(width, height, BUILDING_TIP_MAX_WIDTH, BUILDING_TIP_MAX_HEIGHT).closeButton
  return x >= b.x && x <= b.x + b.size && y >= b.y && y <= b.y + b.size
}

/** Erstbau-Tipp-Feld (User-Vorgabe: "wenn eine Gebäudeart das erste mal gebaut wird, soll das
 * Spiel pausiert werden, ein kleines Feld geht auf... wie es funktioniert, was es macht, welche
 * Optionen man hat") — ein kompaktes Modal (kleiner als das Quick-Start-Panel, ein einzelner
 * kurzer Absatz braucht nicht dessen volle Größe), sonst dieselbe Chrome/Close-Mechanik. main.ts
 * entscheidet EINMAL pro Gebäude-/Turmart (nicht pro Instanz/Farbe), ob dieses Feld überhaupt
 * aufgerufen wird (siehe dort, seenBuildingTips/tipsDisabled). */
export function drawBuildingTipPanel(ctx: CanvasRenderingContext2D, width: number, height: number, kind: BuildingTipKind) {
  const content = BUILDING_TIPS[kind]
  const bounds = drawPanelChrome(ctx, width, height, content.title.toUpperCase(), undefined, BUILDING_TIP_MAX_WIDTH, BUILDING_TIP_MAX_HEIGHT)

  const padding = 24
  ctx.save()
  ctx.textAlign = 'left'
  ctx.fillStyle = COLORS.textMid
  ctx.font = '14px monospace'
  const lines = wrapLines(ctx, content.body, bounds.width - padding * 2, 6)
  let cursorY = bounds.y + 68
  for (const line of lines) {
    ctx.fillText(line, bounds.x + padding, cursorY)
    cursorY += 19
  }
  ctx.restore()
}
