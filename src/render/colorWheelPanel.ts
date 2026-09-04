import { COLORS, readableTextColor } from '../constants/colors'
import { getResource, getResourcesByTier, type CmyParts, type ResourceDefinition, type ResourceTier } from '../data/resources'
import { drawTierBadge } from './referencePanels'
import { drawCircle, drawCircleOutline, drawHexagonOutline, drawTriangleOutline } from './shapes'

// "How Color Mixing Works" (siehe Assets/InfoColors.png) — 5 Tier-Zeilen mit Hexagon-Tier-Marker
// links, rechts je Zeile die Misch-Rezepte als Mini-Diagramme (Input-Kreise -> Dreieck/Hexagon-
// Icon -> Output-Kreis). Dient GLEICHZEITIG als reiner Info-Screen (Economy-"INFO"-Icon) UND als
// Munitions-Auswahl fürs Farbwheel-Panel (Klick auf einen Turm, siehe main.ts wheelMode==='ammo')
// — jede Ressource hat dafür genau EINE klickbare "Haupt"-Swatch (an ihrer eigenen Tier-Position),
// zusätzliche Vorkommen als Input in ANDEREN Karten sind rein illustrativ, nicht separat klickbar.

export interface WheelSwatch {
  resource: ResourceDefinition
  x: number
  y: number
  radius: number
}

const PANEL_FILL = '#0b0d12'
const CLOSE_BUTTON_SIZE = 26
const LABEL_W = 112
const PADDING = 18
// Relative Gewichte der 5 Tier-Zeilen (Tier 1 braucht am wenigsten Höhe, Tier 3/4 am meisten
// wegen des zusätzlichen Hex-Rezepts neben dem Dreieck-Rezept) — siehe layoutRows().
const ROW_WEIGHTS = [0.55, 1.15, 1.3, 1.3, 1.05]

interface PanelBounds {
  x: number
  y: number
  width: number
  height: number
  closeButton: { x: number; y: number; size: number }
}

function panelBounds(width: number, height: number): PanelBounds {
  const panelWidth = Math.min(1320, width - 60)
  const panelHeight = Math.min(900, height - 40)
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

interface RowLayout {
  y: number
  height: number
}

function layoutRows(contentY: number, contentH: number): RowLayout[] {
  const totalWeight = ROW_WEIGHTS.reduce((a, b) => a + b, 0)
  const rows: RowLayout[] = []
  let y = contentY
  for (const weight of ROW_WEIGHTS) {
    const height = (contentH * weight) / totalWeight
    rows.push({ y, height })
    y += height
  }
  return rows
}

/** Baut nur die Positionen der KLICKBAREN Haupt-Swatches (eine je Ressource) — muss exakt
 * dieselbe Geometrie verwenden wie drawColorWheelPanel(), sonst laufen Hit-Test und Rendering
 * auseinander. Lumen/Prisma (keine Misch-Rezepte) sitzen in einer eigenen Extra-Zeile unten. */
export function buildWheelLayout(width: number, height: number): WheelSwatch[] {
  const bounds = panelBounds(width, height)
  const contentX = bounds.x + PADDING
  const contentY = bounds.y + 74
  const contentW = bounds.width - PADDING * 2
  const contentH = bounds.height - 74 - PADDING - 58 // 58 = Platz für Spezial-Zeile + Legende
  const rows = layoutRows(contentY, contentH)
  const cardsX = contentX + LABEL_W
  const cardsW = contentW - LABEL_W

  const swatches: WheelSwatch[] = []

  // Tier 1: 3 einfache Kreise, gleichmäßig verteilt.
  const tier1 = getResourcesByTier(1)
  const tier1CellW = cardsW / tier1.length
  tier1.forEach((resource, i) => {
    swatches.push({ resource, x: cardsX + tier1CellW * (i + 0.5), y: rows[0].y + rows[0].height / 2, radius: 15 })
  })

  // Tier 2/3/4: Output-Kreis unten in jeder Rezept-Karte.
  for (const tier of [2, 3, 4] as const) {
    const resources = getResourcesByTier(tier as ResourceTier)
    const row = rows[tier - 1]
    const cardGap = 10
    const cardW = (cardsW - cardGap * (resources.length - 1)) / resources.length
    resources.forEach((resource, i) => {
      const cardX = cardsX + i * (cardW + cardGap)
      swatches.push({ resource, x: cardX + cardW / 2, y: row.y + row.height - 22, radius: 13 })
    })
  }

  // Tier 5: Output-Kreis rechts neben dem Hex-Icon in je einer breiten Karte.
  const tier5 = getResourcesByTier(5)
  const row5 = rows[4]
  const cardGap5 = 16
  const cardW5 = (cardsW - cardGap5 * (tier5.length - 1)) / tier5.length
  tier5.forEach((resource, i) => {
    const cardX = cardsX + i * (cardW5 + cardGap5)
    swatches.push({ resource, x: cardX + cardW5 * 0.72, y: row5.y + row5.height / 2, radius: 15 })
  })

  // Spezial-Ressourcen (Lumen/Prisma) — kein Teil der Misch-Kette, eigene schmale Zeile.
  const specialY = contentY + contentH + 26
  const special = getResourcesByTier('special')
  special.forEach((resource, i) => {
    swatches.push({ resource, x: cardsX + 70 + i * 110, y: specialY, radius: 12 })
  })

  return swatches
}

function formatCmyRecipe(parts: CmyParts): string {
  const segs: string[] = []
  if (parts.m > 0) segs.push(parts.m === 1 ? 'M' : `${parts.m}M`)
  if (parts.c > 0) segs.push(parts.c === 1 ? 'C' : `${parts.c}C`)
  if (parts.y > 0) segs.push(parts.y === 1 ? 'Y' : `${parts.y}Y`)
  return segs.join(' + ')
}

function drawSwatchDot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, resource: ResourceDefinition, state: { hovered: boolean; disabled: boolean }) {
  ctx.save()
  ctx.globalAlpha = state.disabled ? 0.3 : 1
  drawCircle(ctx, x, y, radius, resource.color, state.hovered ? 20 : 7)
  drawCircleOutline(ctx, x, y, radius, COLORS.gridLineStrong, 1, 0)
  if (state.hovered) drawCircleOutline(ctx, x, y, radius + 4, state.disabled ? '#ff3355' : COLORS.textBright, 1.5, 6)
  ctx.restore()
}

/** Kleiner, nicht klickbarer "Input"-Kreis innerhalb einer FREMDEN Rezept-Karte (z. B. Magenta
 * als Zutat in Blues Karte) — bewusst ohne Hover/Disabled-Zustand, siehe Datei-Kommentar oben. */
function drawInputDot(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, resource: ResourceDefinition) {
  drawCircle(ctx, x, y, radius, resource.color, 6)
  drawCircleOutline(ctx, x, y, radius, COLORS.gridLineStrong, 1, 0)
}

function drawCenteredLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, color: string) {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.font = font
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
  subtitle = 'Triangle prism = mix 2 colors   |   Hex prism = source ratio / final fusion',
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

  drawCenteredLabel(ctx, 'H O W   C O L O R   M I X I N G   W O R K S', bounds.x + bounds.width / 2, bounds.y + 34, 'bold 18px monospace', COLORS.textBright)
  drawCenteredLabel(ctx, subtitle, bounds.x + bounds.width / 2, bounds.y + 54, '11px monospace', COLORS.textMid)

  const swatchByResource = (id: string) => swatches.find((s) => s.resource.id === id)
  const swatchState = (id: string) => ({ hovered: hoveredId === id, disabled: disabledIds.has(id) })

  const contentX = bounds.x + PADDING
  const contentY = bounds.y + 74
  const contentW = bounds.width - PADDING * 2
  const contentH = bounds.height - 74 - PADDING - 58
  const rows = layoutRows(contentY, contentH)
  const cardsX = contentX + LABEL_W
  const cardsW = contentW - LABEL_W

  const rowMeta: { tier: number; label: string }[] = [
    { tier: 1, label: 'SOURCE COLORS' },
    { tier: 2, label: 'TRIANGLE PRISM · 2 inputs' },
    { tier: 3, label: 'ADVANCED MIXES' },
    { tier: 4, label: 'REFINED MIXES' },
    { tier: 5, label: 'FINAL FUSION · 3 inputs' },
  ]
  rowMeta.forEach((meta, i) => {
    const row = rows[i]
    const centerY = row.y + row.height / 2
    drawTierBadge(ctx, contentX + 14, centerY - 10, 12, meta.tier)
    ctx.save()
    ctx.textAlign = 'left'
    ctx.fillStyle = COLORS.textBright
    ctx.font = 'bold 11px monospace'
    ctx.fillText(`TIER ${meta.tier}`, contentX + 32, centerY - 10)
    ctx.fillStyle = COLORS.textMid
    ctx.font = '9px monospace'
    const words = meta.label.split(' ')
    let line = ''
    let ly = centerY + 6
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w
      if (line && ctx.measureText(candidate).width > LABEL_W - 4) {
        ctx.fillText(line, contentX, ly)
        line = w
        ly += 11
      } else {
        line = candidate
      }
    }
    if (line) ctx.fillText(line, contentX, ly)
    ctx.restore()
  })

  // --- Tier 1: reine Farb-Kreise ---
  const tier1 = getResourcesByTier(1)
  const row1 = rows[0]
  const tier1CellW = cardsW / tier1.length
  tier1.forEach((resource, i) => {
    const x = cardsX + tier1CellW * (i + 0.5)
    const y = row1.y + row1.height / 2
    drawSwatchDot(ctx, x, y, 15, resource, swatchState(resource.id))
    drawCenteredLabel(ctx, resource.name, x, y + 15 + 16, '11px monospace', readableTextColor(resource.color))
  })

  // --- Tier 2: nur Dreieck-Rezept ---
  const row2 = rows[1]
  drawTriangleTierRow(ctx, cardsX, row2, cardsW, getResourcesByTier(2), swatchByResource, swatchState)

  // --- Tier 3/4: Dreieck- + Hex-Rezept nebeneinander ---
  for (const tier of [3, 4] as const) {
    drawMixedTierRow(ctx, cardsX, rows[tier - 1], cardsW, getResourcesByTier(tier as ResourceTier), swatchByResource, swatchState)
  }

  // --- Tier 5: 3 Inputs -> Hex -> Output ---
  drawFusionTierRow(ctx, cardsX, rows[4], cardsW, getResourcesByTier(5), swatchByResource, swatchState)

  // --- Spezial-Ressourcen (Lumen/Prisma) ---
  const specialY = contentY + contentH + 26
  ctx.save()
  ctx.textAlign = 'left'
  ctx.fillStyle = COLORS.textMid
  ctx.font = '9px monospace'
  ctx.fillText('SPECIAL (COMBAT DROPS, NO RECIPE)', contentX, specialY - 22)
  ctx.restore()
  getResourcesByTier('special').forEach((resource, i) => {
    const x = cardsX + 70 + i * 110
    drawSwatchDot(ctx, x, specialY, 12, resource, swatchState(resource.id))
    drawCenteredLabel(ctx, resource.name, x, specialY + 12 + 15, '10px monospace', readableTextColor(resource.color))
  })

  // --- Legende ---
  const legendY = bounds.y + bounds.height - 16
  const legendItems: { draw: (x: number, y: number) => void; text: string }[] = [
    { draw: (x, y) => drawCircle(ctx, x, y, 6, COLORS.textBright, 6), text: '= Colored dot: color input/output' },
    { draw: (x, y) => drawTriangleOutline(ctx, x, y, 8, COLORS.textBright, 1.5), text: '= Triangle prism: mix 2 colors' },
    { draw: (x, y) => drawHexagonOutline(ctx, x, y, 8, COLORS.textBright, 1.5), text: '= Hex prism: source ratio / final fusion' },
  ]
  ctx.save()
  ctx.font = '9px monospace'
  ctx.textAlign = 'left'
  const gap = 24
  const widths = legendItems.map((item) => 22 + ctx.measureText(item.text).width)
  const totalW = widths.reduce((a, b) => a + b, 0) + gap * (legendItems.length - 1)
  let lx = bounds.x + bounds.width / 2 - totalW / 2
  legendItems.forEach((item, i) => {
    item.draw(lx + 8, legendY)
    ctx.fillStyle = COLORS.textMid
    ctx.fillText(item.text, lx + 20, legendY + 3)
    lx += widths[i] + gap
  })
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
}

type SwatchLookup = (id: string) => WheelSwatch | undefined
type SwatchStateLookup = (id: string) => { hovered: boolean; disabled: boolean }

/** Tier 2: je Karte [inputA] + [inputB] -> Dreieck-Icon -> [Output], kein Hex-Rezept. */
function drawTriangleTierRow(
  ctx: CanvasRenderingContext2D,
  cardsX: number,
  row: RowLayout,
  cardsW: number,
  resources: ResourceDefinition[],
  swatchByResource: SwatchLookup,
  swatchState: SwatchStateLookup,
) {
  const cardGap = 10
  const cardW = (cardsW - cardGap * (resources.length - 1)) / resources.length

  resources.forEach((resource, i) => {
    const cardX = cardsX + i * (cardW + cardGap)
    drawCardFrame(ctx, cardX, row.y + 4, cardW, row.height - 8)
    drawTriangleRecipe(ctx, resource, cardX + cardW / 2, row.y, row.height, swatchByResource, swatchState)
  })
}

/** Tier 3/4: Dreieck-Rezept links, Hex-Formel rechts (getrennt durch eine dünne Linie). */
function drawMixedTierRow(
  ctx: CanvasRenderingContext2D,
  cardsX: number,
  row: RowLayout,
  cardsW: number,
  resources: ResourceDefinition[],
  swatchByResource: SwatchLookup,
  swatchState: SwatchStateLookup,
) {
  const cardGap = 10
  const cardW = (cardsW - cardGap * (resources.length - 1)) / resources.length

  resources.forEach((resource, i) => {
    const cardX = cardsX + i * (cardW + cardGap)
    drawCardFrame(ctx, cardX, row.y + 4, cardW, row.height - 8)

    const splitX = cardX + cardW * 0.58
    drawTriangleRecipe(ctx, resource, cardX + (splitX - cardX) / 2, row.y, row.height, swatchByResource, swatchState)

    ctx.save()
    ctx.strokeStyle = COLORS.gridLine
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(splitX, row.y + 14)
    ctx.lineTo(splitX, row.y + row.height - 14)
    ctx.stroke()
    ctx.restore()

    const hexCenterX = splitX + (cardX + cardW - splitX) / 2
    const iconY = row.y + row.height * 0.36
    drawHexagonOutline(ctx, hexCenterX, iconY, 12, COLORS.textMid, 1.5)
    drawCenteredLabel(ctx, 'Hex:', hexCenterX, iconY + 22, '9px monospace', COLORS.textMid)
    if (resource.hexagonRecipe) {
      drawCenteredLabel(ctx, formatCmyRecipe(resource.hexagonRecipe), hexCenterX, iconY + 35, '10px monospace', COLORS.textBright)
    }
  })
}

/** Tier 5: 3 Input-Kreise oben -> Hex-Icon -> Output-Kreis unten, breitere Karten (2 statt 3). */
function drawFusionTierRow(
  ctx: CanvasRenderingContext2D,
  cardsX: number,
  row: RowLayout,
  cardsW: number,
  resources: ResourceDefinition[],
  swatchByResource: SwatchLookup,
  swatchState: SwatchStateLookup,
) {
  const cardGap = 16
  const cardW = (cardsW - cardGap * (resources.length - 1)) / resources.length

  resources.forEach((resource, i) => {
    const cardX = cardsX + i * (cardW + cardGap)
    drawCardFrame(ctx, cardX, row.y + 4, cardW, row.height - 8)

    const inputs = resource.hexagonNamedRecipe ?? []
    const inputsY = row.y + row.height * 0.28
    const inputGap = Math.min(90, (cardW * 0.55) / Math.max(1, inputs.length - 1))
    const inputsStartX = cardX + cardW * 0.36 - (inputGap * (inputs.length - 1)) / 2

    inputs.forEach((id, ii) => {
      const inputResource = getResource(id)
      const x = inputsStartX + ii * inputGap
      drawInputDot(ctx, x, inputsY, 10, inputResource)
      drawCenteredLabel(ctx, inputResource.name, x, inputsY + 22, '9px monospace', readableTextColor(inputResource.color))
    })

    const hexX = cardX + cardW * 0.36
    const hexY = row.y + row.height * 0.68
    drawHexagonOutline(ctx, hexX, hexY, 13, COLORS.textMid, 1.5)

    const outX = cardX + cardW * 0.78
    const outY = row.y + row.height / 2
    const swatch = swatchByResource(resource.id)
    if (swatch) drawSwatchDot(ctx, outX, outY, swatch.radius, resource, swatchState(resource.id))
    drawCenteredLabel(ctx, resource.name, outX, outY + swatch!.radius + 16, 'bold 11px monospace', readableTextColor(resource.color))
  })
}

function drawCardFrame(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.save()
  ctx.strokeStyle = COLORS.gridLineStrong
  ctx.lineWidth = 1
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 6)
    ctx.stroke()
  } else {
    ctx.strokeRect(x, y, w, h)
  }
  ctx.restore()
}

/** [inputA] + [inputB] -> Dreieck-Icon -> [Output], vertikal zentriert in einer Karte —
 * gemeinsame Geometrie für Tier 2 (volle Kartenbreite) und Tier 3/4 (nur die linke Hälfte). */
function drawTriangleRecipe(
  ctx: CanvasRenderingContext2D,
  resource: ResourceDefinition,
  centerX: number,
  rowY: number,
  rowHeight: number,
  swatchByResource: SwatchLookup,
  swatchState: SwatchStateLookup,
) {
  const recipe = resource.triangleRecipe ?? []
  const inputsY = rowY + rowHeight * 0.22
  const inputGap = 58

  recipe.forEach((id, i) => {
    const inputResource = getResource(id)
    const x = centerX + (i === 0 ? -inputGap / 2 : inputGap / 2)
    drawInputDot(ctx, x, inputsY, 10, inputResource)
    drawCenteredLabel(ctx, inputResource.name, x, inputsY - 16, '9px monospace', readableTextColor(inputResource.color))
  })
  if (recipe.length === 2) drawCenteredLabel(ctx, '+', centerX, inputsY + 4, 'bold 11px monospace', COLORS.textMid)

  const triangleY = rowY + rowHeight * 0.52
  drawTriangleOutline(ctx, centerX, triangleY, 13, COLORS.textMid, 1.5)

  const outY = rowY + rowHeight - 22
  const swatch = swatchByResource(resource.id)
  if (swatch) drawSwatchDot(ctx, centerX, outY, swatch.radius, resource, swatchState(resource.id))
  drawCenteredLabel(ctx, resource.name, centerX, outY + swatch!.radius + 15, 'bold 11px monospace', readableTextColor(resource.color))
}
