import { COLORS } from '../constants/colors'
import { BUILDING_COSTS } from '../economy/buildings'
import { getResource } from '../data/resources'
import { GRID_EXPAND_COST } from '../grid/placementGrid'
import { defaultTowerRotation, getTowerDefinition, TOWER_DEFINITIONS, type PlacedTower, type TowerKind } from '../towerdefense/towers'
import { drawCircle, drawCircleOutline, drawHalfCircle, drawHexagon, drawHexagonOutline, drawPentagon, drawSquare, drawStar, drawTriangle } from './shapes'

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

// --- Turm-Kauf-/Erweiterungs-Leiste (oben im Defense-Feld) ---

export type TowerPaletteKind = TowerKind | 'mirror' | 'expand-grid' | 'tower-info' | 'ammo-info'

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

export function buildTowerPalette(startX: number, y: number, gap: number): TowerPaletteItem[] {
  const towerItems: TowerPaletteItem[] = TOWER_DEFINITIONS.map((def, i) => ({
    kind: def.kind,
    name: def.name,
    cost: def.cost,
    costResourceId: 'lumen',
    x: startX + i * gap,
    y,
    radius: PALETTE_RADIUS,
  }))
  const extraKinds: { kind: TowerPaletteKind; name: string; costResourceId: string; cost: number }[] = [
    { kind: 'mirror', name: 'Mirror', cost: BUILDING_COSTS.mirror, costResourceId: 'lumen' },
    { kind: 'expand-grid', name: 'Grid', cost: GRID_EXPAND_COST, costResourceId: 'prisma' },
    { kind: 'tower-info', name: 'Towers', cost: 0, costResourceId: 'lumen' },
    { kind: 'ammo-info', name: 'Ammo', cost: 0, costResourceId: 'lumen' },
  ]
  const extraItems: TowerPaletteItem[] = extraKinds.map((item, i) => ({
    ...item,
    x: startX + (towerItems.length + i) * gap,
    y,
    radius: PALETTE_RADIUS,
  }))
  return [...towerItems, ...extraItems]
}

export function hitTestTowerPalette(items: TowerPaletteItem[], x: number, y: number): TowerPaletteItem | null {
  return items.find((item) => Math.hypot(item.x - x, item.y - y) <= item.radius + 6) ?? null
}

/** Kurzbeschreibung fürs Hover-Tooltip über einem Kauf-Leisten-Icon (main.ts) — Name + Zweck,
 * für Turm- UND Info-Icons. Turmtypen nutzen ihre eigene TOWER_DEFINITIONS-Beschreibung. */
export function towerPaletteItemDescription(kind: TowerPaletteKind): string {
  switch (kind) {
    case 'mirror':
      return 'Mirror — redirects the enemy path without changing it otherwise'
    case 'expand-grid':
      return 'Expand the Defense grid by one row and column'
    case 'tower-info':
      return 'Towers — shows every tower type with its stats'
    case 'ammo-info':
      return 'Ammo — shows every color and its combat effect'
    default:
      return getTowerDefinition(kind).description
  }
}

/** Kleine "alle Formen"-Miniatur fürs Türme-Info-Icon: deutet an, dass dahinter eine
 * Übersicht ALLER Turmformen steckt, statt für einen bestimmten Turmtyp zu stehen. */
function drawTowerInfoIcon(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  drawCircleOutline(ctx, x, y, radius, COLORS.textBright, 1.5, 6)
  drawTriangle(ctx, x - radius * 0.4, y + radius * 0.3, radius * 0.32, COLORS.textDim, 0, 0)
  drawSquare(ctx, x + radius * 0.4, y + radius * 0.3, radius * 0.24, COLORS.textDim, 0, 0)
  drawCircle(ctx, x, y - radius * 0.4, radius * 0.26, COLORS.textDim, 0)
}

/** Drei-Punkte-CMY-Icon fürs Munitions-Info-Icon — dieselbe Bildsprache wie das "INFO"-Icon
 * der Economy-Kauf-Leiste (siehe buildingRender.ts), weil es inhaltlich dasselbe Thema ist. */
function drawAmmoInfoIcon(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  drawCircleOutline(ctx, x, y, radius, COLORS.textBright, 1.5, 6)
  const dotColors = [getResource('cyan').color, getResource('magenta').color, getResource('yellow').color]
  dotColors.forEach((color, i) => {
    const angle = -Math.PI / 2 + (i / dotColors.length) * Math.PI * 2
    drawCircle(ctx, x + radius * 0.55 * Math.cos(angle), y + radius * 0.55 * Math.sin(angle), 3, color, 4)
  })
}

/** Kleine diagonale Linie — dasselbe Icon-Muster wie der Spiegel in der Economy-Kauf-Leiste
 * (siehe buildingRender.ts), da es exakt derselbe Bautyp ist (nur auf dem Defense-Raster). */
function drawMirrorPaletteIcon(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  const half = radius * 0.7
  const angle = (Math.PI / 180) * -30
  const dx = half * Math.cos(angle)
  const dy = half * Math.sin(angle)
  ctx.strokeStyle = '#eafffa'
  ctx.lineWidth = 2.5
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(x - dx, y - dy)
  ctx.lineTo(x + dx, y + dy)
  ctx.stroke()
}

export function drawTowerPaletteItem(ctx: CanvasRenderingContext2D, item: TowerPaletteItem, affordable: boolean) {
  ctx.save()
  ctx.globalAlpha = affordable ? 1 : 0.35

  if (item.kind === 'mirror') drawMirrorPaletteIcon(ctx, item.x, item.y, item.radius)
  else if (item.kind === 'expand-grid') drawHexagonOutline(ctx, item.x, item.y, item.radius, COLORS.gridLineStrong, 2)
  else if (item.kind === 'tower-info') drawTowerInfoIcon(ctx, item.x, item.y, item.radius)
  else if (item.kind === 'ammo-info') drawAmmoInfoIcon(ctx, item.x, item.y, item.radius)
  else drawTowerShape(ctx, item.kind, item.x, item.y, item.radius, TOWER_UNSELECTED_COLOR, defaultTowerRotation(item.kind))

  ctx.textAlign = 'center'
  ctx.fillStyle = '#9aa0ab'
  ctx.font = '9px monospace'
  ctx.fillText(item.name, item.x, item.y + item.radius + 14)
  if (item.kind === 'tower-info' || item.kind === 'ammo-info') {
    ctx.fillStyle = COLORS.textDim
    ctx.font = '10px monospace'
    ctx.fillText('INFO', item.x, item.y + item.radius + 26)
  } else {
    ctx.fillStyle = getResource(item.costResourceId).color
    ctx.font = '10px monospace'
    ctx.fillText(`${item.cost}`, item.x, item.y + item.radius + 26)
  }
  ctx.restore()
}

export { getTowerDefinition }
