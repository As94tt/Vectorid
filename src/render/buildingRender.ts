// Rendering für die Licht-Wirtschaft (siehe economy/buildings.ts + lightSimulation.ts): die 4
// Bautypen (Lichtquelle/Spiegel/Prisma/Container), ihre Kauf-Leiste, und die Lichtstrahlen
// selbst. Reine Zeichenfunktionen, keine Simulation — siehe lightSimulation.ts dafür.

import { COLORS, isColorDark } from '../constants/colors'
import { getResource } from '../data/resources'
import type { LightSource, Mirror, Prism } from '../economy/buildings'
import type { BeamSegment, PrismStatus } from '../economy/lightSimulation'
import { cellCenter, GRID_EXPAND_COST, type GridCoord, type HexDirection, type PlacementGrid } from '../grid/placementGrid'
import { drawCircle, drawCircleOutline, drawHexagon, drawHexagonOutline, drawTriangle, drawTriangleOutline, strokeRoundedPolyline } from './shapes'

/** Pixel-Winkel (Grad) der 6 Hex-Richtungen — deckungsgleich mit den Nachbar-Deltas in
 * grid/placementGrid.ts (gerade Zeile), fürs Platzieren von Anschluss-Punkten/Spiegel-Linien. */
const HEX_DIRECTION_ANGLE_DEG: Record<HexDirection, number> = { 0: 0, 1: -60, 2: -120, 3: 180, 4: 120, 5: 60 }

/** Vorschau-Highlight einer einzelnen Rasterzelle (grün = gültig, rot = ungültig). */
export function drawCellHighlight(ctx: CanvasRenderingContext2D, grid: PlacementGrid, cell: GridCoord, color: string, alpha = 0.25) {
  const { x, y } = cellCenter(grid, cell)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 90)
    const px = x + grid.cellSize * Math.cos(angle)
    const py = y + grid.cellSize * Math.sin(angle)
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

export const SOURCE_OUTER_SIZE = 22
const SOURCE_INNER_SIZE = 10
const PULSE_PERIOD_SECONDS = 1
const UNCONFIGURED_COLOR = '#ffffff'
const MIRROR_COLOR = '#eafffa'
export const PRISM_SIMPLE_SIZE = 20
export const PRISM_COMPLEX_SIZE = 24
export const CONTAINER_SIZE = 18
const PORT_DOT_RADIUS = 3.5
const PORT_DOT_OFFSET = 15
const OUTPUT_PORT_RADIUS = 5.5

/** Hohler Außenring + gefüllter Innenkreis, der 1x/Sekunde pulsiert — identisch zum früheren Generator. */
export function drawLightSourceEntity(ctx: CanvasRenderingContext2D, source: LightSource, center: { x: number; y: number }, elapsedSeconds: number) {
  const color = getResource(source.resourceId).color
  drawCircleOutline(ctx, center.x, center.y, SOURCE_OUTER_SIZE, color)
  const phase = (elapsedSeconds % PULSE_PERIOD_SECONDS) / PULSE_PERIOD_SECONDS
  const pulse = 0.7 + 0.3 * Math.sin(phase * Math.PI * 2)
  drawCircle(ctx, center.x, center.y, SOURCE_INNER_SIZE * pulse, color, 14)
}

/** Eine von 3 möglichen Spiegel-Achsen (0/1/2, siehe MirrorOrientation-Kommentar in
 * economy/buildings.ts) — je 60° zueinander versetzt, liegt genau zwischen zwei Rasterrichtungen. */
const MIRROR_AXIS_ANGLE_DEG: Record<0 | 1 | 2, number> = { 0: -30, 1: -90, 2: -150 }

/** Kleine, glühende Linie durch die Zellmitte, Winkel je nach Achsen-Orientierung (0/1/2) —
 * farblos (Spiegel ändern nie die Farbe). */
export function drawMirrorEntity(ctx: CanvasRenderingContext2D, mirror: Mirror, center: { x: number; y: number }, cellSize: number) {
  const half = cellSize * 0.55
  const angle = (Math.PI / 180) * MIRROR_AXIS_ANGLE_DEG[mirror.orientation]
  const dx = half * Math.cos(angle)
  const dy = half * Math.sin(angle)
  ctx.save()
  ctx.strokeStyle = MIRROR_COLOR
  ctx.shadowColor = MIRROR_COLOR
  ctx.shadowBlur = 10
  ctx.lineWidth = 3
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(center.x - dx, center.y - dy)
  ctx.lineTo(center.x + dx, center.y + dy)
  ctx.stroke()
  ctx.restore()
}

/** Kleine Anschluss-Punkte an den Rasterkanten der Zelle — beim Hexagon-Prisma alle 6 Richtungen
 * außer der dedizierten Output-Richtung (unverändert), beim Dreieck-Prisma NUR die 3 eckengenauen
 * Richtungen (`onlyDirections`, siehe lightSimulation.ts `isTriangleInputSide()`) — die 3
 * "Seiten"-Richtungen bekommen gar keinen Punkt, weil dort ohnehin nie ein Eingang möglich ist.
 * Gefüllt in der Farbe eines gerade ankommenden Strahls, sonst hohl/grau ("fehlender Input"
 * bleibt sichtbar). */
function drawPrismPorts(
  ctx: CanvasRenderingContext2D,
  center: { x: number; y: number },
  sides: Set<HexDirection>,
  outputDirection: HexDirection,
  outputColor: string,
  outputActive: boolean,
  onlyDirections?: HexDirection[],
) {
  const directions = onlyDirections ?? ([0, 1, 2, 3, 4, 5] as HexDirection[])
  for (const dir of directions) {
    const angle = (Math.PI / 180) * HEX_DIRECTION_ANGLE_DEG[dir]
    const x = center.x + PORT_DOT_OFFSET * Math.cos(angle)
    const y = center.y + PORT_DOT_OFFSET * Math.sin(angle)

    if (dir === outputDirection) {
      // Der dedizierte Output-Port: größer + immer mit Ring umrandet, damit er sich klar von den
      // normalen Eingangs-Punkten unterscheidet, unabhängig vom aktuellen Zustand.
      ctx.save()
      ctx.strokeStyle = COLORS.textBright
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(x, y, OUTPUT_PORT_RADIUS, 0, Math.PI * 2)
      ctx.stroke()
      if (outputActive) {
        ctx.fillStyle = outputColor
        ctx.shadowColor = outputColor
        ctx.shadowBlur = 8
        ctx.beginPath()
        ctx.arc(x, y, OUTPUT_PORT_RADIUS - 2, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.restore()
      continue
    }

    const filled = sides.has(dir)
    ctx.save()
    if (filled) {
      ctx.fillStyle = COLORS.textBright
      ctx.shadowColor = COLORS.textBright
      ctx.shadowBlur = 6
      ctx.beginPath()
      ctx.arc(x, y, PORT_DOT_RADIUS, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.strokeStyle = COLORS.gridLineStrong
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(x, y, PORT_DOT_RADIUS, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }
}

/** Dreieck (mischt aus 2 benannten Farben) oder Hexagon (mischt aus roher C/M/Y-Summe oder 3
 * benannten Farben) — Form zeigt die Misch-METHODE (siehe data/resources.ts). Gefüllt mit der
 * erzeugten Farbe, sobald ein Rezept erfüllt ist (sichtbare Reaktion), sonst weiß/unkonfiguriert.
 * Pulsiert sanft, solange aktiv. Der Ring um den Output-Port (siehe drawPrismPorts()) zeigt, in
 * welche Richtung das Prisma seine Ausgabe gerade abstrahlt — beim Hexagon per Klick drehbar wie
 * ein Spiegel (`rotatePrism()`), beim Dreieck automatisch die freie Ecke (siehe status.output-
 * Direction/deriveTriangleOutputDirection() in lightSimulation.ts), Klick dreht dort nur noch den
 * Anker (welche 3 der 6 Richtungen überhaupt Ecken sind). */
/** Dreht das Dreieck so, dass seine 3 Ecken exakt auf `outputDirection` und dessen beiden
 * eckengenauen Nachbarn (±2, siehe lightSimulation.ts `isTriangleCorner()`) zeigen — hergeleitet
 * aus HEX_DIRECTION_ANGLE_DEG (Pixel-Winkel je Richtung) und getPolygonVertices()' Konvention
 * (Ecke 0 liegt bei `rotation - 90°`): `rotation = HEX_DIRECTION_ANGLE_DEG[outputDirection] + 90°`
 * legt Ecke 0 exakt auf die Output-Richtung, die beiden anderen Ecken (je 120°/240° versetzt)
 * fallen dank der 60°-Hex-Winkel automatisch auf outputDirection±2. */
function triangleRotationForOutput(outputDirection: HexDirection): number {
  return (Math.PI / 180) * (HEX_DIRECTION_ANGLE_DEG[outputDirection] + 90)
}

export function drawPrismEntity(ctx: CanvasRenderingContext2D, prism: Prism, center: { x: number; y: number }, status: PrismStatus, elapsedSeconds: number) {
  const active = !!status.output
  const color = status.output?.color ?? UNCONFIGURED_COLOR
  const size = prism.prismKind === 'triangle' ? PRISM_SIMPLE_SIZE : PRISM_COMPLEX_SIZE
  const pulse = active ? 0.85 + 0.15 * Math.sin(((elapsedSeconds % PULSE_PERIOD_SECONDS) / PULSE_PERIOD_SECONDS) * Math.PI * 2) : 1
  const glow = active ? 18 * pulse : 8

  // Ein aktives Prisma mit sehr dunkler Ausgabefarbe (v. a. Black, #000000) wäre sonst — Füllung
  // UND Glow beide in derselben dunklen Farbe — auf dem fast-schwarzen Hintergrund praktisch
  // unsichtbar und sähe wie ein untätiges Prisma aus, obwohl das Rezept erfüllt ist. Zusätzlicher,
  // farbunabhängiger Rahmen macht "aktiv" in jedem Fall sichtbar.
  const needsAccentRing = active && isColorDark(color)

  if (prism.prismKind === 'triangle') {
    // `prism.outputDirection` ist nur noch der Rotations-ANKER (legt fest, welche 3 der 6
    // Richtungen überhaupt Ecken sind) — welche dieser 3 Ecken GERADE der Output ist, kommt aus
    // `status.outputDirection` (siehe lightSimulation.ts deriveTriangleOutputDirection()).
    const rotation = triangleRotationForOutput(prism.outputDirection)
    drawTriangle(ctx, center.x, center.y, size, color, rotation, glow)
    if (needsAccentRing) drawTriangleOutline(ctx, center.x, center.y, size + 2, COLORS.textBright, 1.5, rotation)
    const corners: HexDirection[] = [prism.outputDirection, ((prism.outputDirection + 2) % 6) as HexDirection, ((prism.outputDirection + 4) % 6) as HexDirection]
    drawPrismPorts(ctx, center, status.sides, status.outputDirection, color, active, corners)
  } else {
    drawHexagon(ctx, center.x, center.y, size, color, 0, glow)
    if (needsAccentRing) drawHexagonOutline(ctx, center.x, center.y, size + 2, COLORS.textBright, 1.5)
    drawPrismPorts(ctx, center, status.sides, prism.outputDirection, color, active)
  }
}

/** Gefüllter Kreis (User-Vorgabe, ersetzt das frühere Sechseck) — gefüllt mit Tortenstücken in
 * den Farben, die er gerade einfängt (je gleich große Kreissektoren, an der Kreis-Kontur
 * geclippt), statt nur kleiner Farbpunkte daneben. */
export function drawContainerEntity(ctx: CanvasRenderingContext2D, center: { x: number; y: number }, receivedResourceIds: string[]) {
  const active = receivedResourceIds.length > 0
  const outlineColor = active ? COLORS.textBright : '#3a3f4a'

  if (active) {
    ctx.save()
    ctx.beginPath()
    ctx.arc(center.x, center.y, CONTAINER_SIZE, 0, Math.PI * 2)
    ctx.clip()

    const anglePerSlice = (Math.PI * 2) / receivedResourceIds.length
    receivedResourceIds.forEach((resourceId, i) => {
      const color = getResource(resourceId).color
      ctx.fillStyle = color
      ctx.shadowColor = color
      ctx.shadowBlur = 10
      ctx.beginPath()
      ctx.moveTo(center.x, center.y)
      ctx.arc(center.x, center.y, CONTAINER_SIZE * 1.5, -Math.PI / 2 + i * anglePerSlice, -Math.PI / 2 + (i + 1) * anglePerSlice)
      ctx.closePath()
      ctx.fill()
    })
    ctx.restore()
  }

  ctx.save()
  ctx.strokeStyle = outlineColor
  ctx.shadowColor = outlineColor
  ctx.shadowBlur = active ? 14 : 4
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(center.x, center.y, CONTAINER_SIZE, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

/** Ein Lichtstrahl-Segment (Zellpfad -> Pixel-Punkte) als leuchtende Linie. */
export function drawBeamSegment(ctx: CanvasRenderingContext2D, grid: PlacementGrid, segment: BeamSegment, alpha = 0.8) {
  const points = segment.cells.map((cell) => cellCenter(grid, cell))
  strokeRoundedPolyline(ctx, points, segment.color, alpha, false)
}

const BEAM_TRAVELER_SPEED = 110 // px/Sekunde, Platzhalter — konstante gefühlte Geschwindigkeit unabhängig von der Pfadlänge.
const BEAM_TRAVELER_LONG_RADIUS = 6
const BEAM_TRAVELER_SHORT_RADIUS = 3.5

function pointAlongPolyline(points: { x: number; y: number }[], distance: number): { x: number; y: number; angle: number } {
  let remaining = distance
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const segmentLength = Math.hypot(b.x - a.x, b.y - a.y)
    if (remaining <= segmentLength) {
      const t = segmentLength === 0 ? 0 : remaining / segmentLength
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) }
    }
    remaining -= segmentLength
  }
  const last = points[points.length - 1]
  return { x: last.x, y: last.y, angle: 0 }
}

/** Ovales, glühendes Partikel, das entlang eines Strahl-Pfads von der Quelle/dem Prisma zu seinem
 * Ziel fliegt (User-Vorgabe: "eine Art Oval/Kugel soll entlang der Verbindungen fliegen, sofern
 * ein Endpunkt existiert") — läuft endlos in einer Schleife, Umlaufzeit proportional zur
 * Pfadlänge (gleiche gefühlte Geschwindigkeit auf kurzen wie langen Strecken). Nur für Segmente
 * mit `reachedEndpoint` aufrufen (main.ts filtert das). */
export function drawBeamTraveler(ctx: CanvasRenderingContext2D, grid: PlacementGrid, segment: BeamSegment, elapsedSeconds: number) {
  const points = segment.cells.map((cell) => cellCenter(grid, cell))
  if (points.length < 2) return
  let totalLength = 0
  for (let i = 0; i < points.length - 1; i++) totalLength += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y)
  if (totalLength <= 0) return

  const period = totalLength / BEAM_TRAVELER_SPEED
  const progress = (elapsedSeconds % period) / period
  const { x, y, angle } = pointAlongPolyline(points, progress * totalLength)

  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(angle)
  ctx.fillStyle = segment.color
  ctx.shadowColor = segment.color
  ctx.shadowBlur = 12
  ctx.beginPath()
  ctx.ellipse(0, 0, BEAM_TRAVELER_LONG_RADIUS, BEAM_TRAVELER_SHORT_RADIUS, 0, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

// --- Kauf-Leiste (oben im Economy-Feld) ---

export type PaletteKind = 'source-cyan' | 'source-magenta' | 'source-yellow' | 'mirror' | 'prism-simple' | 'prism-complex' | 'container' | 'expand-grid'

export interface PaletteItem {
  kind: PaletteKind
  x: number
  y: number
  radius: number
  cost: number
  costResourceId: string
}

const PALETTE_RADIUS = 15

export function buildPalette(startX: number, y: number, gap: number): PaletteItem[] {
  const specs: { kind: PaletteKind; cost: number; costResourceId: string }[] = [
    { kind: 'source-cyan', cost: 10, costResourceId: 'lumen' },
    { kind: 'source-magenta', cost: 10, costResourceId: 'lumen' },
    { kind: 'source-yellow', cost: 10, costResourceId: 'lumen' },
    { kind: 'mirror', cost: 5, costResourceId: 'lumen' },
    { kind: 'prism-simple', cost: 25, costResourceId: 'lumen' },
    { kind: 'prism-complex', cost: 50, costResourceId: 'lumen' },
    { kind: 'container', cost: 8, costResourceId: 'lumen' },
    { kind: 'expand-grid', cost: GRID_EXPAND_COST, costResourceId: 'prisma' },
  ]
  return specs.map((spec, i) => ({ ...spec, x: startX + i * gap, y, radius: PALETTE_RADIUS }))
}

export function sourceResourceIdForPalette(kind: PaletteKind): 'cyan' | 'magenta' | 'yellow' | null {
  if (kind === 'source-cyan') return 'cyan'
  if (kind === 'source-magenta') return 'magenta'
  if (kind === 'source-yellow') return 'yellow'
  return null
}

export function hitTestPalette(items: PaletteItem[], x: number, y: number): PaletteItem | null {
  return items.find((item) => Math.hypot(item.x - x, item.y - y) <= item.radius + 6) ?? null
}

/** Kurzbeschreibung fürs Hover-Tooltip über einem Kauf-Leisten-Icon (main.ts) — Name + Zweck,
 * für Produktions- UND Info-Icons. */
export function paletteItemDescription(kind: PaletteKind): string {
  switch (kind) {
    case 'source-cyan':
    case 'source-magenta':
    case 'source-yellow':
      return 'Generator — produces a raw color at a fixed rate, beams it into all 6 directions'
    case 'mirror':
      return 'Mirror — redirects a beam without changing its color or rate'
    case 'prism-simple':
      return 'Triangle Prism — mixes 2 named colors arriving at its corners into a new one'
    case 'prism-complex':
      return 'Hexagon Prism — mixes raw Cyan/Magenta/Yellow parts (or 3 named colors) into a new one'
    case 'container':
      return 'Container — stores rate from up to N different colors, based on its level'
    case 'expand-grid':
      return 'Expand the Economy grid by one row and column'
  }
}

export function drawPaletteItem(ctx: CanvasRenderingContext2D, item: PaletteItem, affordable: boolean) {
  ctx.save()
  ctx.globalAlpha = affordable ? 1 : 0.35

  switch (item.kind) {
    case 'source-cyan':
    case 'source-magenta':
    case 'source-yellow': {
      const resourceId = sourceResourceIdForPalette(item.kind)!
      drawCircleOutline(ctx, item.x, item.y, item.radius, getResource(resourceId).color, 2, 10)
      break
    }
    case 'mirror': {
      const half = item.radius * 0.7
      const angle = (Math.PI / 180) * MIRROR_AXIS_ANGLE_DEG[0]
      const dx = half * Math.cos(angle)
      const dy = half * Math.sin(angle)
      ctx.strokeStyle = MIRROR_COLOR
      ctx.lineWidth = 2.5
      ctx.lineCap = 'round'
      ctx.beginPath()
      ctx.moveTo(item.x - dx, item.y - dy)
      ctx.lineTo(item.x + dx, item.y + dy)
      ctx.stroke()
      break
    }
    case 'prism-simple':
      drawTriangle(ctx, item.x, item.y, item.radius, UNCONFIGURED_COLOR, 0, 8)
      break
    case 'prism-complex':
      drawHexagon(ctx, item.x, item.y, item.radius, UNCONFIGURED_COLOR, 0, 8)
      break
    case 'container':
      drawCircle(ctx, item.x, item.y, item.radius * 0.85, COLORS.textBright, 6)
      break
    case 'expand-grid':
      drawHexagonOutline(ctx, item.x, item.y, item.radius, COLORS.gridLineStrong, 2)
      break
  }

  ctx.textAlign = 'center'
  ctx.fillStyle = getResource(item.costResourceId).color
  ctx.font = '10px monospace'
  ctx.fillText(`${item.cost}`, item.x, item.y + item.radius + 16)
  ctx.restore()
}
