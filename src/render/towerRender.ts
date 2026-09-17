import { COLORS } from '../constants/colors'
import { getResource } from '../data/resources'
import { defaultTowerRotation, getTowerDefinition, TOWER_DEFINITIONS, TOWER_MAX_LEVEL, type PlacedTower, type TowerKind } from '../towerdefense/towers'
import { wrapLines } from './referencePanels'
import { drawCircle, drawHalfCircle, drawHexagon, drawPentagon, drawSquare, drawStar, drawTriangle } from './shapes'
import { drawCard, drawCenteredCostTag } from './ui'

/** Munition noch nicht gewählt -> neutrales Grau statt einer Ressourcenfarbe. */
export const TOWER_UNSELECTED_COLOR = '#8a8a94'
export const TOWER_ICON_SIZE = 16

function drawTowerShape(ctx: CanvasRenderingContext2D, kind: TowerKind, x: number, y: number, size: number, color: string, rotation = 0) {
  switch (kind) {
    case 'pulse':
      drawCircle(ctx, x, y, size, color)
      return
    case 'sniper':
      drawTriangle(ctx, x, y, size, color, rotation)
      return
    case 'cannon':
      drawSquare(ctx, x, y, size * 0.8, color, rotation)
      return
    case 'multishot':
      drawPentagon(ctx, x, y, size, color, rotation)
      return
    case 'rapid':
      drawHexagon(ctx, x, y, size, color, rotation)
      return
    case 'flamethrower':
      drawHalfCircle(ctx, x, y, size, color, rotation)
      return
    case 'beam':
      // Raute = um 45° gedrehtes Quadrat — die 45°-Basis-Neigung steckt in `rotation` selbst
      // (siehe `defaultTowerRotation()`/`aimRotation()` in towerdefense/combat.ts), damit die
      // Form auch im Ruhezustand (noch kein Ziel anvisiert) als Raute erkennbar bleibt.
      drawSquare(ctx, x, y, size * 0.72, color, rotation)
      return
    case 'burst':
      drawStar(ctx, x, y, size, color, rotation)
      return
  }
}

/** `rotation` ist die aktuelle Blickrichtung des Turms (siehe `PlacedTower.rotation`,
 * nachgeführt in towerdefense/combat.ts) — 0 = Default-Ausrichtung der jeweiligen Form. */
export function drawTowerEntity(ctx: CanvasRenderingContext2D, tower: PlacedTower, center: { x: number; y: number }) {
  const color = tower.resourceId ? getResource(tower.resourceId).color : TOWER_UNSELECTED_COLOR
  drawTowerShape(ctx, tower.kind, center.x, center.y, TOWER_ICON_SIZE, color, tower.rotation)
}

/** Für Vorschauen (Kauf/Verschieben), bei denen es noch keinen echten Turm gibt. */
export function drawTowerPreview(ctx: CanvasRenderingContext2D, kind: TowerKind, center: { x: number; y: number }, color = TOWER_UNSELECTED_COLOR) {
  drawTowerShape(ctx, kind, center.x, center.y, TOWER_ICON_SIZE, color, defaultTowerRotation(kind))
}

const LEVEL_PIP_COUNT = 5
const LEVEL_PIP_ORBIT_RADIUS = TOWER_ICON_SIZE + 9
const LEVEL_PIP_RADIUS = 2.2
const LEVEL_PIP_ANGLE_STEP = (Math.PI * 2) / LEVEL_PIP_COUNT

/** Rundet Level 1-50 auf 1-5 aktive Segmente auf (User-Vorgabe: "jedes aktive Segment
 * repräsentiert ungefähr 10 Level") — an TOWER_MAX_LEVEL geankert statt einer festen 10, falls
 * sich die Obergrenze mal ändert. */
function activeLevelPips(level: number): number {
  return Math.min(LEVEL_PIP_COUNT, Math.ceil((level / TOWER_MAX_LEVEL) * LEVEL_PIP_COUNT))
}

/** Dezente 5-stufige Level-Anzeige um jeden platzierten Turm (User-Vorgabe) — 5 kleine Neon-
 * Segmente auf einer Kreisbahn knapp außerhalb des Turm-Icons, beginnend oben (12 Uhr) im
 * Uhrzeigersinn. Aktive Segmente (siehe activeLevelPips()) leuchten in der aktuellen Munitions-
 * farbe (bzw. grau ohne Munition — dieselbe Farblogik wie drawTowerEntity()), inaktive bleiben
 * dunkle Konturpunkte. Der Max-Level-Hinweis selbst (goldener Rahmen) sitzt NICHT hier, sondern
 * — wie bei Economy-Gebäuden — auf dem Rasterfeld dahinter (User-Vorgabe: "wie economy Gebäude
 * auch, als das Grid-Feld dahinter, nicht wie jetzt als Kreis um den Turm"), siehe main.ts
 * drawWorld() + buildingRender.ts drawMaxLevelCellMarker(). */
export function drawTowerLevelRing(ctx: CanvasRenderingContext2D, tower: PlacedTower, center: { x: number; y: number }) {
  const color = tower.resourceId ? getResource(tower.resourceId).color : TOWER_UNSELECTED_COLOR
  const active = activeLevelPips(tower.level)

  // Performance: EIN save()/restore() für alle 5 Pips statt vorher eins PRO Pip — bei vielen
  // Türmen (siehe User-Report "FPS-Einbrüche ab einer gewissen Anzahl an Türmen") sind das 5x
  // weniger Canvas-Zustandswechsel pro Turm und Frame. `shadowBlur` wird nach einem aktiven Pip
  // explizit wieder auf 0 gesetzt, damit es nicht in den Stroke eines nachfolgenden inaktiven
  // Pips "durchsickert" (kein save()/restore() mehr dazwischen, das das sonst automatisch täte).
  ctx.save()
  for (let i = 0; i < LEVEL_PIP_COUNT; i++) {
    const angle = -Math.PI / 2 + i * LEVEL_PIP_ANGLE_STEP
    const px = center.x + LEVEL_PIP_ORBIT_RADIUS * Math.cos(angle)
    const py = center.y + LEVEL_PIP_ORBIT_RADIUS * Math.sin(angle)
    ctx.beginPath()
    ctx.arc(px, py, LEVEL_PIP_RADIUS, 0, Math.PI * 2)
    if (i < active) {
      ctx.fillStyle = color
      ctx.shadowColor = color
      ctx.shadowBlur = 5
      ctx.fill()
      ctx.shadowBlur = 0
    } else {
      ctx.strokeStyle = COLORS.gridLineStrong
      ctx.lineWidth = 1
      ctx.stroke()
    }
  }
  ctx.restore()
}

// --- Turm-Kauf-Reihe (Reihe 1 der zweizeiligen Kauf-Leiste — siehe buildingRender.ts
// buildPalette() für Reihe 2 (Economy-Bauteile); main.ts positioniert beide unabhängig
// voneinander, siehe centeredRowStartX()) — nur noch die 8 Turmtypen selbst, Türme-Info/Farb-
// Guide sind seit einer früheren Runde keine Popup-Icons mehr (User-Vorgabe: "nicht mehr als
// öffnenbares Popup, sondern immer"), siehe render/referencePanels.ts drawColorGuideList() für
// die jetzt immer sichtbare Seitenleisten-Variante.

export type TowerPaletteKind = TowerKind

export interface TowerPaletteItem {
  kind: TowerPaletteKind
  name: string
  cost: number
  costResourceId: string
  x: number
  y: number
  radius: number
}

const PALETTE_RADIUS = 15

// Dieselben Karten-Maße wie render/buildingRender.ts paletteCardBounds() — beide Reihen der
// kombinierten Kauf-Leiste sollen optisch identisch aussehen.
const CARD_WIDTH = 56
const CARD_HEIGHT = 74
const CARD_TOP_OFFSET = 30

function paletteCardBounds(item: { x: number; y: number }) {
  return { x: item.x - CARD_WIDTH / 2, y: item.y - CARD_TOP_OFFSET, w: CARD_WIDTH, h: CARD_HEIGHT }
}

/** Progress-System (User-Vorgabe): nur Türme, deren `unlockWave` main.ts' dauerhaftem
 * `highestWaveReached` schon erreicht ist, bekommen überhaupt eine Kauf-Leisten-Karte — noch
 * gesperrte Türme werden nicht etwa nur ausgegraut, sondern komplett weggelassen (kein Slot),
 * damit die Leiste am Anfang bewusst kurz/übersichtlich bleibt (User-Vorgabe: "damit man nicht von
 * Anfang an alle Sachen hat und mit der Masse überfordert ist"). */
export function buildTowerPalette(startX: number, y: number, gap: number, highestWaveReached: number): TowerPaletteItem[] {
  return TOWER_DEFINITIONS.filter((def) => def.unlockWave <= highestWaveReached).map((def, i) => ({
    kind: def.kind,
    name: def.name,
    cost: def.cost,
    costResourceId: 'lumen',
    x: startX + i * gap,
    y,
    radius: PALETTE_RADIUS,
  }))
}

export function hitTestTowerPalette(items: TowerPaletteItem[], x: number, y: number): TowerPaletteItem | null {
  return (
    items.find((item) => {
      const b = paletteCardBounds(item)
      return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h
    }) ?? null
  )
}

/** Kurzbeschreibung fürs Hover-Tooltip über einem Kauf-Leisten-Icon (main.ts). */
export function towerPaletteItemDescription(kind: TowerPaletteKind): string {
  return getTowerDefinition(kind).description
}

export function drawTowerPaletteItem(ctx: CanvasRenderingContext2D, item: TowerPaletteItem, affordable: boolean) {
  const bounds = paletteCardBounds(item)
  drawCard(ctx, bounds.x, bounds.y, bounds.w, bounds.h)

  ctx.save()
  ctx.globalAlpha = affordable ? 1 : 0.35

  drawTowerShape(ctx, item.kind, item.x, item.y, item.radius, TOWER_UNSELECTED_COLOR, defaultTowerRotation(item.kind))

  ctx.textAlign = 'center'
  ctx.fillStyle = '#9aa0ab'
  ctx.font = '11px monospace'
  ctx.fillText(item.name, item.x, item.y + item.radius + 14)
  ctx.font = '12px monospace'
  drawCenteredCostTag(ctx, item.x, item.y + item.radius + 26, item.cost, item.costResourceId, getResource(item.costResourceId).color)
  ctx.restore()
}

const LOCKED_TOWER_MESSAGE = 'Reach the next milestone to unlock new towers.'
// Doppelt so breit wie eine normale Kauf-Karte (+ ein bisschen für den sonst üblichen
// Zwischenraum) — der Hinweistext braucht mehr Platz als eine einzelne 56px-Karte hergibt.
const LOCKED_PLACEHOLDER_WIDTH = CARD_WIDTH * 2 + 8

/** Progress-System (User-Vorgabe): steht direkt hinter dem letzten aktuell freigeschalteten
 * Turm in der Kauf-Leiste, solange noch nicht alle Türme freigeschaltet sind (siehe main.ts
 * highestWaveReached/TOWER_DEFINITIONS[].unlockWave) — bewusst ohne Formen-Icon (es gibt ja noch
 * keins zu zeigen), der exakte Wortlaut ist User-Vorgabe. `nextSlotCenterX` ist die Mitte, an der
 * die nächste (noch gesperrte) Karte normalerweise stünde — die Platzhalter-Karte startet an
 * GENAU deren linker Kante (identischer Abstand zur letzten sichtbaren Karte wie sonst zwischen
 * zwei Karten üblich) und wächst von dort aus nur nach RECHTS über die doppelte Breite, statt
 * symmetrisch um `nextSlotCenterX` (das würde in die letzte sichtbare Karte hineinragen). */
export function drawLockedTowerPlaceholder(ctx: CanvasRenderingContext2D, nextSlotCenterX: number, y: number) {
  const leftX = nextSlotCenterX - CARD_WIDTH / 2
  const bounds = { x: leftX, y: y - CARD_TOP_OFFSET, w: LOCKED_PLACEHOLDER_WIDTH, h: CARD_HEIGHT }
  drawCard(ctx, bounds.x, bounds.y, bounds.w, bounds.h)

  const centerX = leftX + LOCKED_PLACEHOLDER_WIDTH / 2
  ctx.save()
  ctx.textAlign = 'center'
  ctx.fillStyle = COLORS.textDim
  ctx.font = '11px monospace'
  const lines = wrapLines(ctx, LOCKED_TOWER_MESSAGE, bounds.w - 20, 4)
  let lineY = bounds.y + bounds.h / 2 - ((lines.length - 1) * 15) / 2 + 4
  for (const line of lines) {
    ctx.fillText(line, centerX, lineY)
    lineY += 15
  }
  ctx.restore()
}

export { getTowerDefinition }
