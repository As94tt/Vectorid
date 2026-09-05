// Rendering für die Licht-Wirtschaft (siehe economy/buildings.ts + lightSimulation.ts): die 3
// Bautypen (Lichtquelle/Spiegel/Prisma), ihr Anteil an der kombinierten Kauf-Leiste, und die
// Lichtstrahlen selbst. Reine Zeichenfunktionen, keine Simulation — siehe lightSimulation.ts dafür.

import { COLORS, isColorDark } from '../constants/colors'
import { getResource } from '../data/resources'
import { GENERATOR_MAX_LEVEL, type LightSource, type Mirror, type MirrorOrientation, type Prism } from '../economy/buildings'
import type { BeamSegment, PrismStatus } from '../economy/lightSimulation'
import { cellCenter, type GridCoord, type HexDirection, type PlacementGrid } from '../grid/placementGrid'
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

/** Persistenter Status-Marker (User-Vorgabe): die Rasterzelle unter einem Gebäude auf Max-Level
 * färbt sich golden (Füllung + Kontur) statt der normalen Gitterlinie — anders als
 * `drawCellHighlight()` (kurzlebige Platzierungs-Vorschau) bleibt dieser Marker dauerhaft sichtbar,
 * solange das Gebäude dort auf Maximal-Level ist. Vor den Gebäuden selbst gezeichnet, damit er wie
 * ein Hintergrund-Glühen unter der Bau-Grafik wirkt statt sie zu verdecken. */
export function drawMaxLevelCellMarker(ctx: CanvasRenderingContext2D, grid: PlacementGrid, cell: GridCoord) {
  const { x, y } = cellCenter(grid, cell)
  const vertex = (i: number) => {
    const angle = (Math.PI / 180) * (60 * i - 90)
    return { x: x + grid.cellSize * Math.cos(angle), y: y + grid.cellSize * Math.sin(angle) }
  }
  ctx.save()
  ctx.beginPath()
  for (let i = 0; i < 6; i++) {
    const p = vertex(i)
    if (i === 0) ctx.moveTo(p.x, p.y)
    else ctx.lineTo(p.x, p.y)
  }
  ctx.closePath()
  ctx.fillStyle = MAX_LEVEL_COLOR
  ctx.globalAlpha = 0.16
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.strokeStyle = MAX_LEVEL_COLOR
  ctx.shadowColor = MAX_LEVEL_COLOR
  ctx.shadowBlur = 6
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.restore()
}

export const SOURCE_OUTER_SIZE = 22
const SOURCE_INNER_SIZE = 10
const PULSE_PERIOD_SECONDS = 1
const UNCONFIGURED_COLOR = '#ffffff'
const MIRROR_COLOR = '#eafffa'
export const PRISM_SIMPLE_SIZE = 20
export const PRISM_COMPLEX_SIZE = 24
const PORT_DOT_RADIUS = 3.5
const PORT_DOT_OFFSET = 15
const OUTPUT_PORT_RADIUS = 5.5

/** Golden — Marker-Farbe für "auf Maximal-Level" (User-Vorgabe), unabhängig von der jeweiligen
 * Ressourcen-Farbe des Gebäudes, damit sie auf JEDER Farbe klar erkennbar bleibt. */
export const MAX_LEVEL_COLOR = '#ffd23f'

/** Der Generator ist der einzige verbliebene Bautyp, der noch über ein Level skaliert (Prismen
 * haben keins mehr, Container gibt es nicht mehr) — seine sichtbare Größe interpoliert linear
 * zwischen diesem Mindest-Anteil der Basisgröße (Level 1) und 100% (Max-Level, siehe
 * SOURCE_OUTER_SIZE — bleibt unverändert die GRÖSSTE Größe). Untergrenze bewusst nicht zu klein
 * gewählt, damit ein Level-1-Generator weiterhin gut klickbar/lesbar bleibt. */
const LEVEL_MIN_SIZE_SCALE = 0.55

function levelSizeScale(level: number, maxLevel: number): number {
  if (maxLevel <= 1) return 1
  return LEVEL_MIN_SIZE_SCALE + ((level - 1) / (maxLevel - 1)) * (1 - LEVEL_MIN_SIZE_SCALE)
}

/** Aktuelle (level-abhängige) Radien/Größen — von main.ts auch fürs Hit-Testing und die Level-Up-
 * Badge-Position genutzt, damit Klickfläche und Badge-Abstand immer zur sichtbaren Größe passen. */
export function sourceOuterRadius(source: LightSource): number {
  return SOURCE_OUTER_SIZE * levelSizeScale(source.level, GENERATOR_MAX_LEVEL)
}
/** Prismen haben kein Level mehr (User-Vorgabe, entfernt) — immer die volle Basisgröße. */
export function prismSize(prism: Prism): number {
  return prism.prismKind === 'triangle' ? PRISM_SIMPLE_SIZE : PRISM_COMPLEX_SIZE
}

export function isSourceMaxed(source: LightSource): boolean {
  return source.level >= GENERATOR_MAX_LEVEL
}

/** Hohler Außenring + gefüllter Innenkreis, der 1x/Sekunde pulsiert — identisch zum früheren Generator.
 * Größe skaliert mit `source.level` (siehe levelSizeScale/sourceOuterRadius). */
export function drawLightSourceEntity(ctx: CanvasRenderingContext2D, source: LightSource, center: { x: number; y: number }, elapsedSeconds: number) {
  const color = getResource(source.resourceId).color
  const scale = levelSizeScale(source.level, GENERATOR_MAX_LEVEL)
  const outer = SOURCE_OUTER_SIZE * scale
  const inner = SOURCE_INNER_SIZE * scale
  drawCircleOutline(ctx, center.x, center.y, outer, color)
  const phase = (elapsedSeconds % PULSE_PERIOD_SECONDS) / PULSE_PERIOD_SECONDS
  const pulse = 0.7 + 0.3 * Math.sin(phase * Math.PI * 2)
  drawCircle(ctx, center.x, center.y, inner * pulse, color, 14)
}

/** Eine von 6 möglichen Spiegel-Achsen (siehe MirrorOrientation-Kommentar in economy/buildings.ts)
 * — je 30° zueinander versetzt, abwechselnd genau AUF einer Rasterrichtung (gerade Werte) und
 * genau ZWISCHEN zwei Rasterrichtungen (ungerade Werte, die bisherigen 3 einzig möglichen Achsen). */
const MIRROR_AXIS_ANGLE_DEG: Record<MirrorOrientation, number> = { 0: 0, 1: -30, 2: -60, 3: -90, 4: -120, 5: -150 }

/** Kleine, glühende Linie durch die Zellmitte, Winkel je nach Achsen-Orientierung (0-5) —
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
 * Richtungen (`onlyDirections`, siehe lightSimulation.ts `isTriangleCorner()`) — die 3
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
  const size = prismSize(prism)
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

// --- Kauf-Leiste (Teil 1 der kombinierten Leiste oben — siehe towerRender.ts buildTowerPalette()
// für Teil 2, main.ts reiht beide direkt aneinander in EINE gemeinsame Reihe) ---

export type PaletteKind = 'source-cyan' | 'source-magenta' | 'source-yellow' | 'mirror' | 'prism-simple' | 'prism-complex'

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
  }

  ctx.textAlign = 'center'
  ctx.fillStyle = getResource(item.costResourceId).color
  ctx.font = '10px monospace'
  ctx.fillText(`${item.cost}`, item.x, item.y + item.radius + 16)
  ctx.restore()
}
