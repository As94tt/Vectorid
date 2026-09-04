import { COLORS } from './constants/colors'
import { startGameLoop } from './core/gameLoop'
import {
  BUILDING_COSTS,
  CONTAINER_MAX_LEVEL,
  containerUpgradeCost,
  createContainer,
  createLightSource,
  createMirror,
  createPrism,
  GENERATOR_MAX_LEVEL,
  generatorUpgradeCost,
  PRISM_MAX_LEVEL,
  prismUpgradeCost,
  rotateMirror,
  rotatePrism,
  upgradeContainer,
  upgradeLightSource,
  upgradePrism,
  type Container,
  type LightSource,
  type Mirror,
  type Prism,
} from './economy/buildings'
import { simulateLight, type SimulationResult } from './economy/lightSimulation'
import {
  cellAtPoint,
  cellCenter,
  cellKey,
  DEFENSE_STARTING_GRID_SIZE,
  drawPlacementGrid,
  ECONOMY_STARTING_GRID_SIZE,
  gridPixelWidth,
  hexColumnWidth,
  GRID_EXPAND_COST,
  inBounds,
  nearestCell,
  type GridCoord,
  type HexDirection,
  type PlacementGrid,
} from './grid/placementGrid'
import { buildDefenseLookup, traceDefensePath, type Occupancy } from './grid/routing'
import { addToInventory, canAfford, cheatAddTenToAll, createInventory, spend, type Inventory } from './economy/inventory'
import {
  buildPalette,
  drawBeamSegment,
  drawBeamTraveler,
  drawCellHighlight,
  drawContainerEntity,
  drawLightSourceEntity,
  drawMirrorEntity,
  drawPaletteItem,
  drawPrismEntity,
  hitTestPalette,
  paletteItemDescription,
  sourceResourceIdForPalette,
  CONTAINER_SIZE,
  PRISM_COMPLEX_SIZE,
  PRISM_SIMPLE_SIZE,
  SOURCE_OUTER_SIZE,
  type PaletteItem,
  type PaletteKind,
} from './render/buildingRender'
import { buildHudButtons, drawHud, hitTestButton, HUD_HEIGHT, type HudButton } from './render/hud'
import { buildWheelLayout, drawColorWheelPanel, hitTestWheelClose, hitTestWheelSwatch, type WheelSwatch } from './render/colorWheelPanel'
import { drawInfoImagePanel, hitTestInfoImageClose } from './render/infoImagePanel'
import {
  buildTowerPalette,
  drawTowerEntity,
  drawTowerPaletteItem,
  drawTowerPreview,
  hitTestTowerPalette,
  towerPaletteItemDescription,
  TOWER_ICON_SIZE,
  type TowerPaletteItem,
} from './render/towerRender'
import { getEffectiveTowerStats, createTower, getTowerDefinition, towerUpgradeCost, TOWER_MAX_LEVEL, type PlacedTower, type TowerKind } from './towerdefense/towers'
import { getResource, RESOURCES } from './data/resources'
import { drawHexagon, drawLabel } from './render/shapes'
import { drawPath, type Point } from './towerdefense/path'
import { updateProjectiles, updateTowers, pruneVisualEffects, type Projectile, type VisualEffect } from './towerdefense/combat'
import { pruneEnemies, tickEnemy, type Enemy } from './towerdefense/enemies'
import { createWaveState, isBossWave, registerLeak, tickWaveSpawning, BOSS_LUMEN_MULTIPLIER, type WaveState } from './towerdefense/waves'
import { drawEnemies, drawProjectiles, drawTowerCombatEffects, drawVisualEffects } from './render/combatRender'
import { drawTowerReferencePanel, hitTestReferencePanelClose } from './render/referencePanels'

const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = canvas.getContext('2d')
if (!ctx) throw new Error('Canvas 2D context is not supported')

let width = 0
let height = 0
let economyZoneWidth = 0

// Info-Feld oben (Spielername/Level/Ressourcen/Einstellungen/Speichern/Cheat) + Bestand.
const inventory: Inventory = createInventory()
const playerName = 'Commander'
const playerLevel = 1
let hudButtons: HudButton[] = []
let paletteItems: PaletteItem[] = []

// Farbwheel-Panel (Overlay, blockiert währenddessen alle anderen Interaktionen): entweder
// reiner Info-Modus (aus dem Economy-"INFO"-Icon) oder Munitions-Auswahl für einen Turm
// (aus dem Anklicken eines platzierten, noch farblosen oder umzufärbenden Turms).
let wheelMode: 'closed' | 'info' | 'ammo' = 'closed'
let ammoTargetTowerId: string | null = null
let wheelSwatches: WheelSwatch[] = []
let hoveredWheelResourceId: string | null = null

// Zwei Nachschlage-Seiten auf der Defense-Seite (aus der Turm-Kauf-Leiste geöffnet, siehe
// 'tower-info'/'ammo-info'-Icons): reine Anzeige, blockiert wie das Farbwheel alle anderen
// Interaktionen, solange offen.
let defenseInfoMode: 'closed' | 'towers' | 'ammo' = 'closed'

// Info-Panel (Klick auf ein Gebäude/einen Turm): zeigt Name/Level/Produktionsdaten bzw.
// Name/Munition/Level. Blockiert wie das Farbwheel alle anderen Interaktionen, solange offen.
interface InfoTarget {
  kind: 'source' | 'container' | 'tower'
  id: string
}
interface InfoPanelRow {
  label: string
  value: string
  y: number
  height: number
  /** 'ammo' öffnet das Farbwheel im Munitions-Modus, 'level' versucht ein Level-Up (siehe
   * attemptLevelUp() weiter unten) — beides über denselben klickbaren-Zeile-Mechanismus. */
  action?: 'ammo' | 'level'
}
interface InfoPanelLayout {
  x: number
  y: number
  width: number
  height: number
  closeButton: { x: number; y: number; size: number }
  rows: InfoPanelRow[]
}
let infoTarget: InfoTarget | null = null
let infoPanelLayout: InfoPanelLayout | null = null

// Abriss-Modus (User-Wunsch: Gebäude/Türme wieder löschen können, Lumen wird zurückerstattet).
// Ein Toggle-Icon in jeder der beiden Kauf-Leisten schaltet denselben Modus ein/aus — solange
// aktiv, löscht ein Klick auf ein Gebäude/einen Turm ihn sofort statt ihn auszuwählen/zu drehen.
let demolishMode = false

/** Klick vs. Halten+Ziehen auf Generator-Innenkreis/Producer-/Turm-Körper: erst nach dem
 * Loslassen entscheiden, ob es ein Klick (Info-Panel) oder ein Ziehen (Verschieben) war. */
interface PendingPress {
  kind: 'source' | 'mirror' | 'prism' | 'container' | 'tower' | 'defense-mirror' | 'spawn'
  id: string
  downPos: Point
}
let pendingPress: PendingPress | null = null
const PRESS_MOVE_THRESHOLD = 6

// Türme (Defense-Seite): Kauf-Leiste oben, analog zur Economy-Seite. Türme stehen NUR auf
// Knotenpunkten des Defense-Rasters (siehe defenseGrid weiter unten), nicht frei im Feld.
let towers: PlacedTower[] = []
let towerPaletteItems: TowerPaletteItem[] = []
let towerCounter = 0
let placingTowerKind: TowerKind | 'mirror' | null = null
let placingTowerCursor: Point | null = null

function nextTowerId(): string {
  towerCounter += 1
  return `tower-${towerCounter}`
}

function buildScene() {
  economyZoneWidth = width * 0.4

  hudButtons = buildHudButtons(width)
  paletteItems = buildPalette(56, HUD_HEIGHT + 46, 76)
  towerPaletteItems = buildTowerPalette(economyZoneWidth + 56, HUD_HEIGHT + 46, 68)
  wheelSwatches = buildWheelLayout(width, height)
}

// Licht-Wirtschaft: eigenes Raster, auf dem Lichtquellen/Spiegel/Prismen/Container platziert
// werden (siehe economy/buildings.ts + lightSimulation.ts). Wird nur einmal aufgebaut (nicht
// bei jedem Resize neu), damit vom User platzierte Bauwerke erhalten bleiben.
let placementGrid: PlacementGrid
let lightSources: LightSource[] = []
let mirrors: Mirror[] = []
let prisms: Prism[] = []
let containers: Container[] = []
let occupancy: Occupancy = new Map()
let buildingsReady = false
let lightSimulation: SimulationResult = { segments: [], prismStatus: new Map(), containerRates: new Map(), totalRates: new Map(), activeSourceIds: new Set() }

function rebuildOccupancy() {
  occupancy = new Map()
  for (const b of [...lightSources, ...mirrors, ...prisms, ...containers]) occupancy.set(cellKey({ col: b.col, row: b.row }), b.id)
}

function recomputeLightSimulation() {
  lightSimulation = simulateLight(placementGrid, lightSources, mirrors, prisms, containers)
}

function buildDemoEconomy() {
  const cellSize = 30
  // Oben-rechts verankert: rechte Kante und obere Kante liegen fest, das Raster wächst beim
  // Erweitern nach links (mehr Spalten) und unten (mehr Zeilen) — siehe expandGrid(). originX
  // wird über die tatsächliche Pixel-Breite des Hex-Rasters bestimmt (nicht mehr `cols*cellSize`
  // wie beim quadratischen Raster, siehe gridPixelWidth()).
  const topMargin = HUD_HEIGHT + 110 // Platz für "ECONOMY"-Label + Kauf-Leiste
  const rightMargin = 40
  const rightEdge = economyZoneWidth - rightMargin
  placementGrid = {
    cols: ECONOMY_STARTING_GRID_SIZE,
    rows: ECONOMY_STARTING_GRID_SIZE,
    cellSize,
    originX: 0,
    originY: topMargin,
  }
  placementGrid.originX = rightEdge - gridPixelWidth(placementGrid)

  // Cyan-Quelle + direkt nördlich angrenzender Container zeigen das Grundprinzip sofort vor;
  // Magenta/Yellow und beide Prismen liegen noch ungenutzt da, damit der Spieler sie selbst
  // per Spiegel verdrahten kann.
  lightSources = [createLightSource(0, 3, 'cyan'), createLightSource(1, 3, 'magenta'), createLightSource(2, 3, 'yellow')]
  mirrors = []
  prisms = [createPrism(3, 0, 'triangle'), createPrism(0, 0, 'hexagon')]
  containers = [createContainer(0, 2)]
  rebuildOccupancy()
  buildingsReady = true
  recomputeLightSimulation()
}

function buildingCenter(b: { col: number; row: number }) {
  return cellCenter(placementGrid, { col: b.col, row: b.row })
}

// Defense-Knotenraster: Türme UND Spiegel stehen ausschließlich auf Knotenpunkten dieses
// Rasters, der Spawn ebenso. Der Gegner-Pfad ist seit dieser Runde KEIN kürzester BFS-Weg zu
// einem separat platzierten Ziel mehr (User-Vorgabe: "ich möchte nicht, dass der kürzeste Weg
// genommen wird") — stattdessen strahlt der Spawn wie ein Prisma auf der Economy-Seite EINEN
// Strahl in eine dedizierte, per Klick drehbare Richtung ab, Spiegel (identisches Datenmodell
// wie economy/buildings.ts) lenken ihn um, er läuft unbegrenzt weiter, bis er einen Turm trifft
// (das ist dann das Ziel) oder den Rasterrand verlässt ("Wand") — siehe grid/routing.ts
// `traceDefensePath()`. Jede Turm-/Spiegel-Platzierung/-Verschiebung UND jede Spawn-Drehung/
// -Verschiebung löst ein Neu-Berechnen aus.
let defenseGrid: PlacementGrid
let defenseOccupancy: Occupancy = new Map()
let spawnNode: GridCoord
let spawnDirection: HexDirection = 0
let defenseMirrors: Mirror[] = []
let enemyPathPixels: Point[] = []
/** Id des Turms, an dem der aktuelle Gegner-Pfad endet — `null`, wenn er stattdessen am
 * Rasterrand endet (noch kein Turm im Weg). */
let pathTargetTowerId: string | null = null
let defenseReady = false

function rebuildDefenseOccupancy() {
  defenseOccupancy = new Map()
  defenseOccupancy.set(cellKey(spawnNode), 'spawn')
  for (const mirror of defenseMirrors) defenseOccupancy.set(cellKey(mirror), mirror.id)
  for (const tower of towers) defenseOccupancy.set(cellKey({ col: tower.col, row: tower.row }), tower.id)
}

function recomputeEnemyPath() {
  const lookup = buildDefenseLookup(defenseMirrors, towers)
  const maxSteps = (defenseGrid.cols + defenseGrid.rows) * 4 // Sicherheitsbremse gg. Spiegel-Endlosschleife
  const { cells, hitTowerId } = traceDefensePath(defenseGrid, lookup, spawnNode, spawnDirection, maxSteps)
  enemyPathPixels = cells.map((c) => cellCenter(defenseGrid, c))
  pathTargetTowerId = hitTowerId
}

function canPlaceTowerAt(cell: GridCoord, ignoreId?: string): boolean {
  if (!inBounds(defenseGrid, cell)) return false
  const occupant = defenseOccupancy.get(cellKey(cell))
  return !occupant || occupant === ignoreId
}

function canPlaceDefenseMirrorAt(cell: GridCoord, ignoreId?: string): boolean {
  if (!inBounds(defenseGrid, cell)) return false
  const occupant = defenseOccupancy.get(cellKey(cell))
  return !occupant || occupant === ignoreId
}

function canMoveSpawnTo(cell: GridCoord): boolean {
  if (!inBounds(defenseGrid, cell)) return false
  const occupant = defenseOccupancy.get(cellKey(cell))
  return !occupant || occupant === 'spawn'
}

function buildDefenseNetwork() {
  const cellSize = 35
  defenseGrid = {
    cols: DEFENSE_STARTING_GRID_SIZE,
    rows: DEFENSE_STARTING_GRID_SIZE,
    cellSize,
    originX: economyZoneWidth + 48,
    originY: HUD_HEIGHT + 110,
  }
  spawnNode = { col: DEFENSE_STARTING_GRID_SIZE - 1, row: 0 }
  spawnDirection = 3 // zeigt zu Beginn ins Rasterinnere (Spawn sitzt oben-rechts)
  defenseMirrors = []
  towers = []
  enemies = []
  waveState = createWaveState()
  rebuildDefenseOccupancy()
  recomputeEnemyPath()
  defenseReady = true
}

/** Erweitert das Defense-Raster um 1 Spalte + 1 Zeile. Oben-links bleibt fix verankert —
 * Ursprung ändert sich nicht, bestehende Knoten-Koordinaten bleiben gültig (kein Renumbering
 * nötig, anders als beim Economy-Raster, das nach links statt nach rechts wächst). */
function expandDefenseGrid() {
  if (!canAfford(inventory, 'prisma', GRID_EXPAND_COST)) return
  spend(inventory, 'prisma', GRID_EXPAND_COST)
  defenseGrid = { ...defenseGrid, cols: defenseGrid.cols + 1, rows: defenseGrid.rows + 1 }
  // Der Pfad kann bisher an der jetzt verschobenen Wand geendet haben — mit mehr Platz läuft er
  // ggf. weiter, bis er einen Turm trifft oder die NEUE (weiter entfernte) Wand erreicht.
  recomputeEnemyPath()
}

// Kampf-Simulation (Defense-Seite): Gegner spawnen wellenweise (siehe towerdefense/waves.ts —
// 20 Gegner/Welle, 5s Pause danach, jede Welle stärker, Boss alle 10 Wellen, Fehlschlag setzt
// 5 Wellen zurück), Türme feuern automatisch auf Gegner in Reichweite (siehe towerdefense/
// combat.ts). Munition liefert dabei nur noch C/M/Y (siehe towerdefense/ammoEffects.ts) —
// Statuseffekte entstehen aus dem angesammelten Mischungsverhältnis der Gegner selbst (siehe
// towerdefense/enemies.ts).
let enemies: Enemy[] = []
let projectiles: Projectile[] = []
let visualEffects: VisualEffect[] = []
let waveState: WaveState = createWaveState()
const LUMEN_PER_KILL = 2

function resize() {
  const dpr = window.devicePixelRatio || 1
  width = window.innerWidth
  height = window.innerHeight
  canvas.width = width * dpr
  canvas.height = height * dpr
  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
  buildScene()
  if (!buildingsReady) buildDemoEconomy()
  if (!defenseReady) buildDefenseNetwork()
}

window.addEventListener('resize', resize)
resize()

// --- Interaktion ---
// Lichtquelle/Prisma/Container halten+ziehen = verschieben, kurz antippen = Info-Panel.
// Spiegel antippen dreht ihn sofort (kein Info-Panel dafür, siehe User-Vorgabe) — halten+ziehen
// verschiebt ihn trotzdem. Kauf-Leiste anfassen = neues Gebäude ziehen und aufs Raster fallen
// lassen (kostet Lumen) bzw. Raster erweitern (kostet Prisma, sofortige Aktion statt Drag).

function pointerPos(e: PointerEvent): Point {
  const rect = canvas.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

interface EconomyHit {
  kind: 'source' | 'mirror' | 'prism' | 'container'
  id: string
}

function hitTestEconomyBuilding(x: number, y: number): EconomyHit | null {
  for (const source of lightSources) {
    if (Math.hypot(buildingCenter(source).x - x, buildingCenter(source).y - y) <= SOURCE_OUTER_SIZE + 6) return { kind: 'source', id: source.id }
  }
  for (const mirror of mirrors) {
    if (Math.hypot(buildingCenter(mirror).x - x, buildingCenter(mirror).y - y) <= placementGrid.cellSize * 0.45) return { kind: 'mirror', id: mirror.id }
  }
  for (const prism of prisms) {
    const size = prism.prismKind === 'triangle' ? PRISM_SIMPLE_SIZE : PRISM_COMPLEX_SIZE
    if (Math.hypot(buildingCenter(prism).x - x, buildingCenter(prism).y - y) <= size + 6) return { kind: 'prism', id: prism.id }
  }
  for (const container of containers) {
    if (Math.hypot(buildingCenter(container).x - x, buildingCenter(container).y - y) <= CONTAINER_SIZE + 6) return { kind: 'container', id: container.id }
  }
  return null
}

const PRISM_LEVEL_BADGE_RADIUS = 10

function prismLevelBadgeCenter(prism: Prism): Point {
  const center = buildingCenter(prism)
  const size = prism.prismKind === 'triangle' ? PRISM_SIMPLE_SIZE : PRISM_COMPLEX_SIZE
  return { x: center.x, y: center.y + size + 14 }
}

/** Kleiner "Lv.N"-Badge unterhalb jedes Prismas, eigens hit-getestet (siehe attemptPrismLevelUp())
 * — bewusst NICHT Teil von hitTestEconomyBuilding(), damit ein Klick aufs Prisma selbst weiterhin
 * nur dreht (siehe pendingPress-Logik), ohne mit dem Level-Up in Konflikt zu geraten. */
function hitTestPrismLevelBadge(x: number, y: number): Prism | null {
  for (const prism of prisms) {
    const badge = prismLevelBadgeCenter(prism)
    if (Math.hypot(badge.x - x, badge.y - y) <= PRISM_LEVEL_BADGE_RADIUS) return prism
  }
  return null
}

function drawPrismLevelBadge(prism: Prism) {
  const { x, y } = prismLevelBadgeCenter(prism)
  const maxed = prism.level >= PRISM_MAX_LEVEL
  ctx!.save()
  ctx!.textAlign = 'center'
  ctx!.font = '10px monospace'
  if (maxed) {
    ctx!.fillStyle = COLORS.textMid
    ctx!.fillText(`Lv.${prism.level}`, x, y)
  } else {
    const cost = prismUpgradeCost(prism.prismKind, prism.level + 1)
    ctx!.fillStyle = canAfford(inventory, 'lumen', cost) ? COLORS.textBright : COLORS.textMid
    ctx!.fillText(`Lv.${prism.level} ▲${cost}`, x, y)
  }
  ctx!.restore()
}

function towerCenter(tower: PlacedTower) {
  return cellCenter(defenseGrid, { col: tower.col, row: tower.row })
}

function hitTestTower(x: number, y: number): PlacedTower | null {
  return towers.find((t) => Math.hypot(towerCenter(t).x - x, towerCenter(t).y - y) <= TOWER_ICON_SIZE + 6) ?? null
}

/** Spawn-Hexagon anfassen — Klick dreht seine Abstrahlrichtung (wie ein Prisma), Halten+Ziehen
 * verschiebt ihn (siehe pendingPress-Logik unten). */
function hitTestSpawn(x: number, y: number): boolean {
  const spawnCenter = cellCenter(defenseGrid, spawnNode)
  return Math.hypot(spawnCenter.x - x, spawnCenter.y - y) <= 20
}

function defenseMirrorCenter(mirror: Mirror) {
  return cellCenter(defenseGrid, { col: mirror.col, row: mirror.row })
}

function hitTestDefenseMirror(x: number, y: number): Mirror | null {
  return defenseMirrors.find((m) => Math.hypot(defenseMirrorCenter(m).x - x, defenseMirrorCenter(m).y - y) <= defenseGrid.cellSize * 0.45) ?? null
}

/** Löscht ein Economy-Gebäude und erstattet seinen Lumen-Baukosten zurück (User-Wunsch). */
function demolishEconomyBuilding(hit: EconomyHit) {
  if (hit.kind === 'source') {
    lightSources = lightSources.filter((s) => s.id !== hit.id)
    addToInventory(inventory, 'lumen', BUILDING_COSTS.source)
  } else if (hit.kind === 'mirror') {
    mirrors = mirrors.filter((m) => m.id !== hit.id)
    addToInventory(inventory, 'lumen', BUILDING_COSTS.mirror)
  } else if (hit.kind === 'prism') {
    const prism = prisms.find((p) => p.id === hit.id)
    prisms = prisms.filter((p) => p.id !== hit.id)
    if (prism) addToInventory(inventory, 'lumen', prism.prismKind === 'triangle' ? BUILDING_COSTS.prismSimple : BUILDING_COSTS.prismComplex)
  } else {
    containers = containers.filter((c) => c.id !== hit.id)
    addToInventory(inventory, 'lumen', BUILDING_COSTS.container)
  }
  rebuildOccupancy()
  if (infoTarget && infoTarget.id === hit.id) infoTarget = null
}

/** Levelt das Gebäude/den Turm hinter `target` um 1 hoch, sofern noch nicht maximal und die
 * Lumen-Kosten (siehe economy/buildings.ts generatorUpgradeCost()/containerUpgradeCost()/
 * towerdefense/towers.ts towerUpgradeCost()) bezahlt werden können — ausgelöst durch Klick auf
 * die "Level"-Zeile im Info-Panel (siehe pointerdown). Prismen haben kein Info-Panel (Klick dreht
 * sie stattdessen, siehe pendingPress-Logik) und werden daher separat geleveled, siehe
 * `attemptPrismLevelUp()`. */
function attemptLevelUp(target: InfoTarget) {
  if (target.kind === 'source') {
    const source = lightSources.find((s) => s.id === target.id)
    if (!source || source.level >= GENERATOR_MAX_LEVEL) return
    const cost = generatorUpgradeCost(source.level + 1)
    if (!canAfford(inventory, 'lumen', cost)) return
    spend(inventory, 'lumen', cost)
    upgradeLightSource(source)
  } else if (target.kind === 'container') {
    const container = containers.find((c) => c.id === target.id)
    if (!container || container.level >= CONTAINER_MAX_LEVEL) return
    const cost = containerUpgradeCost(container.level + 1)
    if (!canAfford(inventory, 'lumen', cost)) return
    spend(inventory, 'lumen', cost)
    upgradeContainer(container)
  } else {
    const tower = towers.find((t) => t.id === target.id)
    if (!tower || tower.level >= TOWER_MAX_LEVEL) return
    const cost = towerUpgradeCost(getTowerDefinition(tower.kind), tower.level + 1)
    if (!canAfford(inventory, 'lumen', cost)) return
    spend(inventory, 'lumen', cost)
    tower.level += 1
  }
}

/** Prismen haben kein Info-Panel (Klick dreht sie, siehe pendingPress-Logik unten) — Level-Up
 * läuft daher über einen kleinen, separat hit-getesteten Badge neben dem Prisma (siehe
 * `hitTestPrismLevelBadge()`/`drawPrismLevelBadge()`), nicht über eine Panel-Zeile wie bei den
 * übrigen 3 levelbaren Bautypen. */
function attemptPrismLevelUp(prism: Prism) {
  if (prism.level >= PRISM_MAX_LEVEL) return
  const cost = prismUpgradeCost(prism.prismKind, prism.level + 1)
  if (!canAfford(inventory, 'lumen', cost)) return
  spend(inventory, 'lumen', cost)
  upgradePrism(prism)
}

/** Löscht einen Turm und erstattet seinen Lumen-Baukosten zurück (User-Wunsch). */
function demolishTower(tower: PlacedTower) {
  towers = towers.filter((t) => t.id !== tower.id)
  addToInventory(inventory, 'lumen', getTowerDefinition(tower.kind).cost)
  rebuildDefenseOccupancy()
  recomputeEnemyPath()
  if (infoTarget && infoTarget.id === tower.id) infoTarget = null
}

/** Löscht einen Defense-Spiegel und erstattet seinen Lumen-Baukosten zurück (derselbe Bautyp/
 * Baukosten wie ein Economy-Spiegel). */
function demolishDefenseMirror(mirror: Mirror) {
  defenseMirrors = defenseMirrors.filter((m) => m.id !== mirror.id)
  addToInventory(inventory, 'lumen', BUILDING_COSTS.mirror)
  rebuildDefenseOccupancy()
  recomputeEnemyPath()
}

let placingNewKind: PaletteKind | null = null
let placingCursor: Point | null = null
let hoveredEconomyItem: PaletteItem | null = null
let hoveredTowerItem: TowerPaletteItem | null = null
let movingBuildingId: string | null = null
let movingKind: 'source' | 'mirror' | 'prism' | 'container' | 'tower' | 'defense-mirror' | 'spawn' | null = null
let movingCursor: Point | null = null

function handleHudButton(id: HudButton['id']) {
  if (id === 'cheat') cheatAddTenToAll(inventory)
  else if (id === 'demolish') demolishMode = !demolishMode
  // 'settings' und 'save': absichtlich ohne Funktion (User-Wunsch — noch keine Logik dahinter).
}

/**
 * Erweitert das Raster um 1 Spalte + 1 Zeile. Oben-rechts bleibt fix verankert: neue Zeilen
 * kommen unten dazu (kein Anpassungsbedarf), neue Spalten kommen links dazu — dafür wird der
 * Ursprung um eine Zellbreite nach links verschoben UND jede bestehende col-Koordinate
 * (Gebäude + Verbindungspfade) um 1 erhöht, damit sich an den Pixel-Positionen nichts ändert.
 */
function expandGrid() {
  if (!canAfford(inventory, 'prisma', GRID_EXPAND_COST)) return
  spend(inventory, 'prisma', GRID_EXPAND_COST)

  const columnWidth = hexColumnWidth(placementGrid)
  placementGrid = {
    ...placementGrid,
    cols: placementGrid.cols + 1,
    rows: placementGrid.rows + 1,
    originX: placementGrid.originX - columnWidth,
  }

  for (const source of lightSources) source.col += 1
  for (const mirror of mirrors) mirror.col += 1
  for (const prism of prisms) prism.col += 1
  for (const container of containers) container.col += 1
  rebuildOccupancy()
}

canvas.addEventListener('pointerdown', (e) => {
  const pos = pointerPos(e)

  // Farbwheel-Panel blockiert alle anderen Interaktionen, solange es offen ist. 'info' zeigt nur
  // Assets/InfoColors.png als Bild (siehe render/infoImagePanel.ts, eigener Close-Hit-Test),
  // 'ammo' ist die eigentliche, klickbare Munitions-Auswahl (render/colorWheelPanel.ts).
  if (wheelMode !== 'closed') {
    if (wheelMode === 'info') {
      if (hitTestInfoImageClose('colors', width, height, pos.x, pos.y)) wheelMode = 'closed'
      return
    }
    if (hitTestWheelClose(width, height, pos.x, pos.y)) {
      wheelMode = 'closed'
      ammoTargetTowerId = null
      return
    }
    if (ammoTargetTowerId) {
      const swatch = hitTestWheelSwatch(wheelSwatches, pos.x, pos.y)
      const tower = towers.find((t) => t.id === ammoTargetTowerId)
      if (swatch && tower && !unavailableAmmoIds(ammoTargetTowerId).has(swatch.resource.id)) {
        tower.resourceId = swatch.resource.id
        wheelMode = 'closed'
        ammoTargetTowerId = null
      }
    }
    return
  }

  // Info-Panel blockiert ebenso alle anderen Interaktionen, solange es offen ist.
  if (infoTarget) {
    const layout = infoPanelLayout
    if (!layout) {
      infoTarget = null
      return
    }
    const { closeButton, rows, x, y, width: w, height: h } = layout
    const insideClose = pos.x >= closeButton.x && pos.x <= closeButton.x + closeButton.size && pos.y >= closeButton.y && pos.y <= closeButton.y + closeButton.size
    if (insideClose) {
      infoTarget = null
      return
    }
    const clickedRow = rows.find((r) => r.action && pos.x >= x && pos.x <= x + w && pos.y >= r.y && pos.y <= r.y + r.height)
    if (clickedRow?.action === 'ammo' && infoTarget.kind === 'tower') {
      ammoTargetTowerId = infoTarget.id
      wheelMode = 'ammo'
      infoTarget = null
      return
    }
    if (clickedRow?.action === 'level') {
      attemptLevelUp(infoTarget)
      return
    }
    const insidePanel = pos.x >= x && pos.x <= x + w && pos.y >= y && pos.y <= y + h
    if (!insidePanel) infoTarget = null
    return
  }

  // Türme-/Munitions-Infoseite blockiert ebenso alle anderen Interaktionen, solange offen —
  // reine Anzeige, einziger Klick-Handler ist das Schließen. "Ammo" zeigt nur Assets/
  // ColorEffects.png als Bild (eigener Close-Hit-Test, siehe render/infoImagePanel.ts).
  if (defenseInfoMode !== 'closed') {
    if (defenseInfoMode === 'ammo') {
      if (hitTestInfoImageClose('effects', width, height, pos.x, pos.y)) defenseInfoMode = 'closed'
    } else if (hitTestReferencePanelClose(width, height, pos.x, pos.y)) {
      defenseInfoMode = 'closed'
    }
    return
  }

  const button = hudButtons.find((b) => hitTestButton(b, pos.x, pos.y))
  if (button) {
    handleHudButton(button.id)
    return
  }

  const paletteItem = hitTestPalette(paletteItems, pos.x, pos.y)
  if (paletteItem) {
    if (paletteItem.kind === 'expand-grid') expandGrid()
    else if (paletteItem.kind === 'color-wheel') wheelMode = 'info'
    else {
      placingNewKind = paletteItem.kind
      placingCursor = pos
    }
    return
  }

  const towerPaletteItem = hitTestTowerPalette(towerPaletteItems, pos.x, pos.y)
  if (towerPaletteItem) {
    if (towerPaletteItem.kind === 'expand-grid') expandDefenseGrid()
    else if (towerPaletteItem.kind === 'tower-info') defenseInfoMode = 'towers'
    else if (towerPaletteItem.kind === 'ammo-info') defenseInfoMode = 'ammo'
    else {
      placingTowerKind = towerPaletteItem.kind
      placingTowerCursor = pos
    }
    return
  }

  const existingTower = hitTestTower(pos.x, pos.y)
  if (existingTower) {
    if (demolishMode) {
      demolishTower(existingTower)
      return
    }
    pendingPress = { kind: 'tower', id: existingTower.id, downPos: pos }
    return
  }

  const defenseMirrorHit = hitTestDefenseMirror(pos.x, pos.y)
  if (defenseMirrorHit) {
    if (demolishMode) {
      demolishDefenseMirror(defenseMirrorHit)
      return
    }
    pendingPress = { kind: 'defense-mirror', id: defenseMirrorHit.id, downPos: pos }
    return
  }

  if (hitTestSpawn(pos.x, pos.y)) {
    // Kein Abriss für den Spawn — er ist Pflichtbestandteil des Defense-Rasters (immer genau 1).
    pendingPress = { kind: 'spawn', id: 'spawn', downPos: pos }
    return
  }

  if (!demolishMode) {
    const badgePrism = hitTestPrismLevelBadge(pos.x, pos.y)
    if (badgePrism) {
      attemptPrismLevelUp(badgePrism)
      return
    }
  }

  const economyHit = hitTestEconomyBuilding(pos.x, pos.y)
  if (economyHit) {
    if (demolishMode) {
      demolishEconomyBuilding(economyHit)
      return
    }
    pendingPress = { kind: economyHit.kind, id: economyHit.id, downPos: pos }
  }
})

canvas.addEventListener('pointermove', (e) => {
  const pos = pointerPos(e)
  if (wheelMode !== 'closed') {
    hoveredWheelResourceId = hitTestWheelSwatch(wheelSwatches, pos.x, pos.y)?.resource.id ?? null
    return
  }
  if (infoTarget) return
  if (defenseInfoMode !== 'closed') return

  hoveredEconomyItem = hitTestPalette(paletteItems, pos.x, pos.y)
  hoveredTowerItem = hitTestTowerPalette(towerPaletteItems, pos.x, pos.y)

  if (pendingPress) {
    const dist = Math.hypot(pos.x - pendingPress.downPos.x, pos.y - pendingPress.downPos.y)
    if (dist > PRESS_MOVE_THRESHOLD) {
      // Genug bewegt -> jetzt erst als Ziehen (Verschieben) werten, nicht als Klick.
      movingBuildingId = pendingPress.id
      movingKind = pendingPress.kind
      movingCursor = pos
      pendingPress = null
    }
  }

  if (placingNewKind) placingCursor = pos
  if (movingBuildingId) movingCursor = pos
  if (placingTowerKind) placingTowerCursor = pos
})

function finalizePlacement(pos: Point) {
  const kind = placingNewKind
  if (!kind) return
  const cell = cellAtPoint(placementGrid, pos.x, pos.y)
  if (!cell || occupancy.has(cellKey(cell))) return

  if (kind === 'mirror') {
    if (!canAfford(inventory, 'lumen', BUILDING_COSTS.mirror)) return
    spend(inventory, 'lumen', BUILDING_COSTS.mirror)
    mirrors.push(createMirror(cell.col, cell.row))
  } else if (kind === 'prism-simple' || kind === 'prism-complex') {
    const cost = kind === 'prism-simple' ? BUILDING_COSTS.prismSimple : BUILDING_COSTS.prismComplex
    if (!canAfford(inventory, 'lumen', cost)) return
    spend(inventory, 'lumen', cost)
    prisms.push(createPrism(cell.col, cell.row, kind === 'prism-simple' ? 'triangle' : 'hexagon'))
  } else if (kind === 'container') {
    if (!canAfford(inventory, 'lumen', BUILDING_COSTS.container)) return
    spend(inventory, 'lumen', BUILDING_COSTS.container)
    containers.push(createContainer(cell.col, cell.row))
  } else {
    const resourceId = sourceResourceIdForPalette(kind)
    if (!resourceId) return
    if (!canAfford(inventory, 'lumen', BUILDING_COSTS.source)) return
    spend(inventory, 'lumen', BUILDING_COSTS.source)
    lightSources.push(createLightSource(cell.col, cell.row, resourceId))
  }
  rebuildOccupancy()
}

/** Irgendein Economy-Gebäude (unabhängig vom Typ) anhand seiner Id finden — fürs generische
 * Verschieben/Tauschen, das nicht wissen muss, in welchem der 4 Arrays es steckt. */
function findEconomyBuilding(id: string): { col: number; row: number } | null {
  return lightSources.find((s) => s.id === id) ?? mirrors.find((m) => m.id === id) ?? prisms.find((p) => p.id === id) ?? containers.find((c) => c.id === id) ?? null
}

/** Kein explizites Neu-Routen nötig — die Licht-Simulation wird jeden Frame komplett neu aus
 * den aktuellen Positionen berechnet (siehe recomputeLightSimulation()), verschobene Bauwerke
 * wirken sich also automatisch auf den nächsten Frame aus.
 *
 * Ziel-Zelle bereits belegt (durch ein ANDERES Gebäude als das gezogene) -> statt die Bewegung
 * abzulehnen, werden beide Gebäude getauscht (User-Wunsch: "Gebäude aufeinander ziehen und
 * loslassen tauscht sie"). */
function finalizeMove(pos: Point) {
  const cell = cellAtPoint(placementGrid, pos.x, pos.y)
  if (!cell || !movingBuildingId) return
  const moving = findEconomyBuilding(movingBuildingId)
  if (!moving) return

  const occupantId = occupancy.get(cellKey(cell))
  if (occupantId && occupantId !== movingBuildingId) {
    const other = findEconomyBuilding(occupantId)
    if (!other) return
    const originalCol = moving.col
    const originalRow = moving.row
    moving.col = other.col
    moving.row = other.row
    other.col = originalCol
    other.row = originalRow
  } else {
    moving.col = cell.col
    moving.row = cell.row
  }
  rebuildOccupancy()
}

/** Turm verschieben: snapt auf den nächsten freien Knotenpunkt, der Spawn<->Ziel weiterhin
 * verbunden lässt. Ungültiges Ziel -> Turm bleibt an alter Position. */
function finalizeTowerMove(pos: Point) {
  const tower = towers.find((t) => t.id === movingBuildingId)
  if (!tower) return
  const cell = nearestCell(defenseGrid, pos.x, pos.y)
  if (!canPlaceTowerAt(cell, tower.id)) return
  tower.col = cell.col
  tower.row = cell.row
  rebuildDefenseOccupancy()
  recomputeEnemyPath()
}

function finalizeTowerPlacement(pos: Point) {
  const kind = placingTowerKind
  if (!kind) return
  const cell = nearestCell(defenseGrid, pos.x, pos.y)

  if (kind === 'mirror') {
    if (!canPlaceDefenseMirrorAt(cell)) return
    if (!canAfford(inventory, 'lumen', BUILDING_COSTS.mirror)) return
    spend(inventory, 'lumen', BUILDING_COSTS.mirror)
    defenseMirrors.push(createMirror(cell.col, cell.row))
    rebuildDefenseOccupancy()
    recomputeEnemyPath()
    return
  }

  const def = getTowerDefinition(kind)
  if (!canPlaceTowerAt(cell)) return
  if (!canAfford(inventory, 'lumen', def.cost)) return
  spend(inventory, 'lumen', def.cost)
  towers.push(createTower(nextTowerId(), kind, cell.col, cell.row))
  rebuildDefenseOccupancy()
  recomputeEnemyPath()
}

/** Spiegel/Spawn auf dem Defense-Raster verschieben (Zellbelegung wie bei Türmen, kein
 * Weg-Existenz-Check mehr nötig — siehe Datei-Kommentar zum Defense-Knotenraster oben). */
function finalizeDefenseMirrorMove(pos: Point) {
  const mirror = defenseMirrors.find((m) => m.id === movingBuildingId)
  if (!mirror) return
  const cell = nearestCell(defenseGrid, pos.x, pos.y)
  if (!canPlaceDefenseMirrorAt(cell, mirror.id)) return
  mirror.col = cell.col
  mirror.row = cell.row
  rebuildDefenseOccupancy()
  recomputeEnemyPath()
}

function finalizeSpawnMove(pos: Point) {
  const cell = nearestCell(defenseGrid, pos.x, pos.y)
  if (!canMoveSpawnTo(cell)) return
  spawnNode = cell
  rebuildDefenseOccupancy()
  recomputeEnemyPath()
}

window.addEventListener('pointerup', (e) => {
  const pos = pointerPos(e)

  if (placingNewKind) {
    finalizePlacement(pos)
    placingNewKind = null
    placingCursor = null
  }

  if (movingBuildingId) {
    if (movingKind === 'tower') finalizeTowerMove(pos)
    else if (movingKind === 'defense-mirror') finalizeDefenseMirrorMove(pos)
    else if (movingKind === 'spawn') finalizeSpawnMove(pos)
    else finalizeMove(pos)
    movingBuildingId = null
    movingKind = null
    movingCursor = null
  }

  if (placingTowerKind) {
    finalizeTowerPlacement(pos)
    placingTowerKind = null
    placingTowerCursor = null
  }

  if (pendingPress) {
    // Nie über die Bewegungsschwelle hinaus gezogen -> war ein Klick, kein Ziehen. Bei einem
    // Spiegel (Economy ODER Defense) ODER einem Prisma dreht ein Klick es direkt (User-Vorgabe:
    // "Prismen müssen auch gedreht werden können, wie Spiegel") statt ein Info-Panel zu öffnen.
    // Der Spawn dreht ebenso seine Abstrahlrichtung (dasselbe Prinzip wie beim Prisma).
    if (pendingPress.kind === 'mirror') {
      const mirror = mirrors.find((m) => m.id === pendingPress!.id)
      if (mirror) rotateMirror(mirror)
    } else if (pendingPress.kind === 'defense-mirror') {
      const mirror = defenseMirrors.find((m) => m.id === pendingPress!.id)
      if (mirror) {
        rotateMirror(mirror)
        recomputeEnemyPath()
      }
    } else if (pendingPress.kind === 'prism') {
      const prism = prisms.find((p) => p.id === pendingPress!.id)
      if (prism) rotatePrism(prism)
    } else if (pendingPress.kind === 'spawn') {
      spawnDirection = ((spawnDirection + 1) % 6) as HexDirection
      recomputeEnemyPath()
    } else {
      infoTarget = { kind: pendingPress.kind, id: pendingPress.id }
    }
    pendingPress = null
  }
})

function drawDivider() {
  ctx!.save()
  ctx!.strokeStyle = COLORS.gridLineStrong
  ctx!.lineWidth = 2
  ctx!.beginPath()
  ctx!.moveTo(economyZoneWidth, HUD_HEIGHT)
  ctx!.lineTo(economyZoneWidth, height)
  ctx!.stroke()
  ctx!.restore()

  ctx!.save()
  ctx!.fillStyle = COLORS.textDim
  ctx!.font = '12px monospace'
  ctx!.fillText('E C O N O M Y', 24, HUD_HEIGHT + 20)
  ctx!.fillText('D E F E N S E', economyZoneWidth + 48, HUD_HEIGHT + 20)
  ctx!.restore()
}

function drawEconomyPalette() {
  for (const item of paletteItems) {
    drawPaletteItem(ctx!, item, canAfford(inventory, item.costResourceId, item.cost))
  }
}

function drawTowerPalette() {
  for (const item of towerPaletteItems) {
    drawTowerPaletteItem(ctx!, item, canAfford(inventory, 'lumen', item.cost))
  }
}

const TOWER_PALETTE_EXTRA_KINDS = new Set(['mirror', 'expand-grid', 'tower-info', 'ammo-info'])

/** Hover-Tooltip über einem Kauf-Leisten-Icon (Economy ODER Defense) — Name + kurzer Zweck,
 * siehe paletteItemDescription()/towerPaletteItemDescription(). Nutzt denselben Chip-Look wie das
 * Farbwheel-Panel (drawLabel(), von dort exportiert). */
function drawPaletteTooltips() {
  // Sobald ein Modal offen ist, aktualisiert pointermove hoveredEconomyItem/hoveredTowerItem
  // nicht mehr (siehe early returns dort) — ohne diese Sperre würde sonst ein stehen gebliebenes
  // Tooltip vom Icon-Klick, der das Modal gerade erst geöffnet hat, sichtbar bleiben.
  if (wheelMode !== 'closed' || infoTarget || defenseInfoMode !== 'closed') return
  if (hoveredEconomyItem) {
    const item = hoveredEconomyItem
    drawLabel(ctx!, paletteItemDescription(item.kind), item.x, item.y - item.radius - 14, '11px monospace', COLORS.textBright, 15)
  }
  if (hoveredTowerItem) {
    const item = hoveredTowerItem
    const text = TOWER_PALETTE_EXTRA_KINDS.has(item.kind) ? towerPaletteItemDescription(item.kind) : `${item.name} — ${towerPaletteItemDescription(item.kind)}`
    drawLabel(ctx!, text, item.x, item.y - item.radius - 14, '11px monospace', COLORS.textBright, 15)
  }
}

function drawTowerPlacementPreview() {
  if (!placingTowerKind || !placingTowerCursor) return
  const cell = nearestCell(defenseGrid, placingTowerCursor.x, placingTowerCursor.y)
  const center = cellCenter(defenseGrid, cell)

  if (placingTowerKind === 'mirror') {
    drawCellHighlight(ctx!, defenseGrid, cell, canPlaceDefenseMirrorAt(cell) ? '#39ff8f' : '#ff3355', 0.3)
    ctx!.save()
    ctx!.globalAlpha = 0.6
    drawMirrorEntity(ctx!, { id: 'preview', kind: 'mirror', col: cell.col, row: cell.row, orientation: 0 }, center, defenseGrid.cellSize)
    ctx!.restore()
    return
  }

  const valid = canPlaceTowerAt(cell)
  if (!valid) {
    ctx!.save()
    ctx!.globalAlpha = 0.35
    ctx!.fillStyle = '#ff3355'
    ctx!.beginPath()
    ctx!.arc(center.x, center.y, TOWER_ICON_SIZE + 10, 0, Math.PI * 2)
    ctx!.fill()
    ctx!.restore()
  }

  ctx!.save()
  ctx!.globalAlpha = 0.7
  drawTowerPreview(ctx!, placingTowerKind, center)
  ctx!.restore()
}

function drawTowers() {
  for (const tower of towers) {
    const starved = tower.resourceId !== null && !hasAmmoAvailable(tower)
    if (starved) {
      ctx!.save()
      ctx!.globalAlpha = 0.4
    }
    drawTowerEntity(ctx!, tower, towerCenter(tower))
    if (starved) ctx!.restore()
  }
}

/** Defense-Knotenraster: Raster selbst + Spiegel + Gegner-Pfad (inkl. Spawn-Marker, siehe
 * towerdefense/path.ts) + Verschiebe-Vorschau (siehe drawMovePreview()/drawTowerPlacementPreview()). */
function drawDefenseNetwork() {
  drawPlacementGrid(ctx!, defenseGrid, COLORS.gridLineStrong)
  ctx!.save()
  ctx!.fillStyle = COLORS.textDim
  ctx!.font = '11px monospace'
  ctx!.fillText('N O D E S', defenseGrid.originX, defenseGrid.originY - 12)
  ctx!.restore()

  drawPath(ctx!, enemyPathPixels, pathTargetTowerId !== null)
  for (const mirror of defenseMirrors) drawMirrorEntity(ctx!, mirror, defenseMirrorCenter(mirror), defenseGrid.cellSize)
}

/** Wellenstand rechts neben dem "D E F E N S E"-Label (siehe towerdefense/waves.ts) — Wellen-
 * nummer + Boss-Hinweis (jede 10. Welle) plus Spawn-Fortschritt bzw. Pause-Countdown. */
function drawWaveStatus() {
  const boss = isBossWave(waveState.currentWave)
  const status =
    waveState.phase === 'spawning' ? `${waveState.enemiesSpawnedInWave}/${waveState.totalInWave} spawned` : `next wave in ${Math.ceil(waveState.pauseTimer)}s`

  ctx!.save()
  ctx!.textAlign = 'right'
  ctx!.font = 'bold 12px monospace'
  ctx!.fillStyle = boss ? '#ffcc33' : COLORS.textBright
  ctx!.fillText(boss ? `WAVE ${waveState.currentWave} — BOSS  ·  ${status}` : `WAVE ${waveState.currentWave}  ·  ${status}`, width - 20, HUD_HEIGHT + 20)
  ctx!.restore()
}

/** Layout + Zeichnen des Info-Panels für das aktuell angeklickte Gebäude/den Turm. Legt
 * `infoPanelLayout` fest, damit pointerdown dieselben Koordinaten fürs Hit-Testing nutzt. */
function drawInfoPanel() {
  if (!infoTarget) {
    infoPanelLayout = null
    return
  }

  let anchor: Point
  let rowsInput: { label: string; value: string; action?: 'ammo' | 'level' }[]

  if (infoTarget.kind === 'source') {
    const source = lightSources.find((s) => s.id === infoTarget!.id)
    if (!source) {
      infoTarget = null
      return
    }
    anchor = buildingCenter(source)
    const active = lightSimulation.activeSourceIds.has(source.id)
    const maxed = source.level >= GENERATOR_MAX_LEVEL
    rowsInput = [
      { label: 'Name', value: 'Light Source' },
      { label: 'Color', value: getResource(source.resourceId).name },
      { label: 'Level', value: maxed ? `${source.level}/${GENERATOR_MAX_LEVEL} (max)` : `${source.level}/${GENERATOR_MAX_LEVEL} (Lv.${source.level + 1}: ${generatorUpgradeCost(source.level + 1)} lumen)`, action: maxed ? undefined : 'level' },
      { label: 'Range', value: `${source.range} cells` },
      { label: 'Rate', value: active ? `${source.baseRate.toFixed(1)}/s` : '0.0/s (no container)' },
    ]
  } else if (infoTarget.kind === 'container') {
    const container = containers.find((c) => c.id === infoTarget!.id)
    if (!container) {
      infoTarget = null
      return
    }
    anchor = buildingCenter(container)
    const rates = lightSimulation.containerRates.get(container.id)
    const rateRows = rates
      ? [...rates].map(([resourceId, rate]) => ({ label: getResource(resourceId).name, value: `${rate.toFixed(1)}/s` }))
      : [{ label: 'Receiving', value: '—' }]
    const maxed = container.level >= CONTAINER_MAX_LEVEL
    rowsInput = [
      { label: 'Name', value: 'Container' },
      { label: 'Level', value: maxed ? `${container.level}/${CONTAINER_MAX_LEVEL} (max)` : `${container.level}/${CONTAINER_MAX_LEVEL} (Lv.${container.level + 1}: ${containerUpgradeCost(container.level + 1)} lumen)`, action: maxed ? undefined : 'level' },
      ...rateRows,
    ]
  } else {
    const tower = towers.find((t) => t.id === infoTarget!.id)
    if (!tower) {
      infoTarget = null
      return
    }
    anchor = towerCenter(tower)
    const def = getTowerDefinition(tower.kind)
    const stats = getEffectiveTowerStats(tower)
    const ammoLabel = tower.resourceId ? getResource(tower.resourceId).name : '— (choose)'
    const maxed = tower.level >= TOWER_MAX_LEVEL
    rowsInput = [
      { label: 'Name', value: def.name },
      { label: 'Ammo', value: hasAmmoAvailable(tower) ? ammoLabel : `${ammoLabel} (Shortage!)`, action: 'ammo' },
      { label: 'Level', value: maxed ? `${tower.level}/${TOWER_MAX_LEVEL} (max)` : `${tower.level}/${TOWER_MAX_LEVEL} (next: ${towerUpgradeCost(def, tower.level + 1)} lumen)`, action: maxed ? undefined : 'level' },
      { label: 'Damage', value: stats.damage.toFixed(1) },
      { label: 'Range', value: `${stats.range.toFixed(0)}px` },
      { label: 'Attack Speed', value: `${(1 / stats.fireInterval).toFixed(2)}/s` },
      { label: 'Projectile Speed', value: stats.projectileSpeed ? `${stats.projectileSpeed.toFixed(0)}px/s` : '—' },
      { label: 'Consumption', value: `${stats.consumption.toFixed(1)}/s` },
    ]
  }

  const panelWidth = 230
  const padding = 12
  const rowHeight = 18
  const panelHeight = padding * 2 + rowsInput.length * rowHeight
  let panelX = anchor.x + 30
  let panelY = anchor.y - panelHeight / 2
  if (panelX + panelWidth > width - 10) panelX = anchor.x - panelWidth - 30
  if (panelX < 10) panelX = 10
  if (panelY < HUD_HEIGHT + 10) panelY = HUD_HEIGHT + 10
  if (panelY + panelHeight > height - 10) panelY = height - 10 - panelHeight

  const closeSize = 16
  const closeButton = { x: panelX + panelWidth - closeSize - 8, y: panelY + 8, size: closeSize }
  const rows: InfoPanelRow[] = rowsInput.map((r, i) => ({
    ...r,
    y: panelY + padding + i * rowHeight,
    height: rowHeight,
  }))
  infoPanelLayout = { x: panelX, y: panelY, width: panelWidth, height: panelHeight, closeButton, rows }

  ctx!.save()
  ctx!.fillStyle = '#0b0d12'
  ctx!.strokeStyle = COLORS.gridLineStrong
  ctx!.lineWidth = 1.5
  if (typeof ctx!.roundRect === 'function') {
    ctx!.beginPath()
    ctx!.roundRect(panelX, panelY, panelWidth, panelHeight, 6)
    ctx!.fill()
    ctx!.stroke()
  } else {
    ctx!.fillRect(panelX, panelY, panelWidth, panelHeight)
    ctx!.strokeRect(panelX, panelY, panelWidth, panelHeight)
  }
  ctx!.restore()

  ctx!.save()
  ctx!.font = '11px monospace'
  ctx!.textBaseline = 'middle'
  for (const row of rows) {
    const midY = row.y + row.height / 2
    ctx!.fillStyle = COLORS.textDim
    ctx!.textAlign = 'left'
    ctx!.fillText(row.label, panelX + padding, midY)
    ctx!.fillStyle = COLORS.textBright
    ctx!.textAlign = 'right'
    ctx!.fillText(row.value, panelX + panelWidth - padding - 22, midY)
    if (row.action) {
      ctx!.strokeStyle = COLORS.gridLine
      ctx!.beginPath()
      ctx!.moveTo(panelX + padding, row.y + row.height)
      ctx!.lineTo(panelX + panelWidth - padding, row.y + row.height)
      ctx!.stroke()
    }
  }
  ctx!.restore()

  ctx!.save()
  ctx!.strokeStyle = COLORS.textBright
  ctx!.lineWidth = 1.5
  ctx!.strokeRect(closeButton.x, closeButton.y, closeButton.size, closeButton.size)
  ctx!.beginPath()
  ctx!.moveTo(closeButton.x + 4, closeButton.y + 4)
  ctx!.lineTo(closeButton.x + closeButton.size - 4, closeButton.y + closeButton.size - 4)
  ctx!.moveTo(closeButton.x + closeButton.size - 4, closeButton.y + 4)
  ctx!.lineTo(closeButton.x + 4, closeButton.y + closeButton.size - 4)
  ctx!.stroke()
  ctx!.restore()
}

function placementCost(kind: PaletteKind): number {
  if (kind === 'mirror') return BUILDING_COSTS.mirror
  if (kind === 'prism-simple') return BUILDING_COSTS.prismSimple
  if (kind === 'prism-complex') return BUILDING_COSTS.prismComplex
  if (kind === 'container') return BUILDING_COSTS.container
  return BUILDING_COSTS.source
}

function drawPlacementPreview() {
  if (!placingNewKind || !placingCursor) return
  const cell = cellAtPoint(placementGrid, placingCursor.x, placingCursor.y)
  const valid = !!cell && !occupancy.has(cellKey(cell)) && canAfford(inventory, 'lumen', placementCost(placingNewKind))
  if (cell) drawCellHighlight(ctx!, placementGrid, cell, valid ? '#39ff8f' : '#ff3355', 0.3)

  const previewPos = cell ? cellCenter(placementGrid, cell) : placingCursor
  drawPaletteGhost(placingNewKind, previewPos)
}

function drawPaletteGhost(kind: PaletteKind, pos: Point) {
  ctx!.save()
  ctx!.globalAlpha = 0.6
  const resourceId = sourceResourceIdForPalette(kind)
  if (resourceId) {
    ctx!.strokeStyle = getResource(resourceId).color
    ctx!.lineWidth = 2
    ctx!.beginPath()
    ctx!.arc(pos.x, pos.y, SOURCE_OUTER_SIZE, 0, Math.PI * 2)
    ctx!.stroke()
  } else if (kind === 'mirror') {
    const half = placementGrid.cellSize * 0.55
    const angle = (Math.PI / 180) * -30 // Default-Achse (Orientierung 0), siehe buildingRender.ts
    const dx = half * Math.cos(angle)
    const dy = half * Math.sin(angle)
    ctx!.strokeStyle = '#eafffa'
    ctx!.lineWidth = 3
    ctx!.lineCap = 'round'
    ctx!.beginPath()
    ctx!.moveTo(pos.x - dx, pos.y - dy)
    ctx!.lineTo(pos.x + dx, pos.y + dy)
    ctx!.stroke()
  } else if (kind === 'prism-simple' || kind === 'prism-complex') {
    const size = kind === 'prism-simple' ? PRISM_SIMPLE_SIZE : PRISM_COMPLEX_SIZE
    const sides = kind === 'prism-simple' ? 3 : 6
    ctx!.strokeStyle = '#ffffff'
    ctx!.lineWidth = 2
    ctx!.beginPath()
    for (let i = 0; i < sides; i++) {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides
      const px = pos.x + size * Math.cos(angle)
      const py = pos.y + size * Math.sin(angle)
      if (i === 0) ctx!.moveTo(px, py)
      else ctx!.lineTo(px, py)
    }
    ctx!.closePath()
    ctx!.stroke()
  } else if (kind === 'container') {
    ctx!.strokeStyle = COLORS.textBright
    ctx!.lineWidth = 2
    ctx!.beginPath()
    for (let i = 0; i < 6; i++) {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 6
      const px = pos.x + CONTAINER_SIZE * Math.cos(angle)
      const py = pos.y + CONTAINER_SIZE * Math.sin(angle)
      if (i === 0) ctx!.moveTo(px, py)
      else ctx!.lineTo(px, py)
    }
    ctx!.closePath()
    ctx!.stroke()
  }
  ctx!.restore()
}

function drawMovePreview() {
  if (!movingBuildingId || !movingCursor) return

  if (movingKind === 'tower') {
    const tower = towers.find((t) => t.id === movingBuildingId)
    if (!tower) return
    const cell = nearestCell(defenseGrid, movingCursor.x, movingCursor.y)
    const valid = canPlaceTowerAt(cell, tower.id)
    const center = cellCenter(defenseGrid, cell)
    if (!valid) {
      ctx!.save()
      ctx!.globalAlpha = 0.35
      ctx!.fillStyle = '#ff3355'
      ctx!.beginPath()
      ctx!.arc(center.x, center.y, TOWER_ICON_SIZE + 10, 0, Math.PI * 2)
      ctx!.fill()
      ctx!.restore()
    }
    ctx!.save()
    ctx!.globalAlpha = 0.7
    const color = tower.resourceId ? getResource(tower.resourceId).color : undefined
    drawTowerPreview(ctx!, tower.kind, center, color)
    ctx!.restore()
    return
  }

  if (movingKind === 'defense-mirror') {
    const mirror = defenseMirrors.find((m) => m.id === movingBuildingId)
    if (!mirror) return
    const cell = nearestCell(defenseGrid, movingCursor.x, movingCursor.y)
    const valid = canPlaceDefenseMirrorAt(cell, mirror.id)
    const center = cellCenter(defenseGrid, cell)
    drawCellHighlight(ctx!, defenseGrid, cell, valid ? '#39ff8f' : '#ff3355', 0.3)
    ctx!.save()
    ctx!.globalAlpha = 0.6
    drawMirrorEntity(ctx!, mirror, center, defenseGrid.cellSize)
    ctx!.restore()
    return
  }

  if (movingKind === 'spawn') {
    const cell = nearestCell(defenseGrid, movingCursor.x, movingCursor.y)
    const valid = canMoveSpawnTo(cell)
    const center = cellCenter(defenseGrid, cell)
    drawCellHighlight(ctx!, defenseGrid, cell, valid ? '#39ff8f' : '#ff3355', 0.3)
    ctx!.save()
    ctx!.globalAlpha = 0.7
    drawHexagon(ctx!, center.x, center.y, 14, COLORS.enemy, 0, 18)
    ctx!.restore()
    return
  }

  const cell = cellAtPoint(placementGrid, movingCursor.x, movingCursor.y)
  let valid = false
  let kind: PaletteKind | null = null

  if (movingKind === 'source') {
    const source = lightSources.find((s) => s.id === movingBuildingId)
    if (!source) return
    valid = !!cell && (!occupancy.has(cellKey(cell)) || occupancy.get(cellKey(cell)) === source.id)
    kind = source.resourceId === 'cyan' ? 'source-cyan' : source.resourceId === 'magenta' ? 'source-magenta' : 'source-yellow'
  } else if (movingKind === 'mirror') {
    const mirror = mirrors.find((m) => m.id === movingBuildingId)
    if (!mirror) return
    valid = !!cell && (!occupancy.has(cellKey(cell)) || occupancy.get(cellKey(cell)) === mirror.id)
    kind = 'mirror'
  } else if (movingKind === 'prism') {
    const prism = prisms.find((p) => p.id === movingBuildingId)
    if (!prism) return
    valid = !!cell && (!occupancy.has(cellKey(cell)) || occupancy.get(cellKey(cell)) === prism.id)
    kind = prism.prismKind === 'triangle' ? 'prism-simple' : 'prism-complex'
  } else if (movingKind === 'container') {
    const container = containers.find((c) => c.id === movingBuildingId)
    if (!container) return
    valid = !!cell && (!occupancy.has(cellKey(cell)) || occupancy.get(cellKey(cell)) === container.id)
    kind = 'container'
  }
  if (!kind) return

  if (cell) drawCellHighlight(ctx!, placementGrid, cell, valid ? '#39ff8f' : '#ff3355', 0.3)
  const previewPos = cell ? cellCenter(placementGrid, cell) : movingCursor
  drawPaletteGhost(kind, previewPos)
}

function drawBuildings() {
  drawPlacementGrid(ctx!, placementGrid, COLORS.gridLineStrong)
  ctx!.save()
  ctx!.fillStyle = COLORS.textDim
  ctx!.font = '11px monospace'
  ctx!.textAlign = 'right'
  ctx!.fillText('L I G H T', placementGrid.originX + gridPixelWidth(placementGrid), placementGrid.originY - 12)
  ctx!.restore()

  for (const segment of lightSimulation.segments) drawBeamSegment(ctx!, placementGrid, segment)
  for (const segment of lightSimulation.segments) {
    if (segment.reachedEndpoint) drawBeamTraveler(ctx!, placementGrid, segment, elapsedSeconds)
  }

  drawPlacementPreview()
  drawMovePreview()

  for (const source of lightSources) drawLightSourceEntity(ctx!, source, buildingCenter(source), elapsedSeconds)
  for (const mirror of mirrors) drawMirrorEntity(ctx!, mirror, buildingCenter(mirror), placementGrid.cellSize)
  for (const prism of prisms) {
    const status = lightSimulation.prismStatus.get(prism.id)
    if (status) drawPrismEntity(ctx!, prism, buildingCenter(prism), status, elapsedSeconds)
    drawPrismLevelBadge(prism)
  }
  for (const container of containers) {
    const rates = lightSimulation.containerRates.get(container.id)
    drawContainerEntity(ctx!, buildingCenter(container), rates ? [...rates.keys()] : [])
  }
}

let elapsedSeconds = 0

/** Aktuelle Netto-Produktionsrate (Einheiten/Sekunde) je Ressource: die "Brutto"-Rate aus der
 * Licht-Simulation (siehe recomputeLightSimulation()) abzüglich der `consumption` jedes Turms mit
 * zugewiesener Munition (siehe towerdefense/towers.ts getEffectiveTowerStats() — ersetzt den
 * früheren globalen TOWER_AMMO_DRAIN durch einen echten Per-Turm-Wert). `excludeTowerId` blendet
 * einen Turm aus der Drain-Berechnung aus (z. B. den, dessen Munition gerade neu gewählt wird —
 * sonst würde er sich durch seine eigene aktuelle Wahl selbst blockieren). */
function computeResourceRates(excludeTowerId?: string): Map<string, number> {
  const rates = new Map(lightSimulation.totalRates)
  for (const tower of towers) {
    if (!tower.resourceId || tower.id === excludeTowerId) continue
    rates.set(tower.resourceId, (rates.get(tower.resourceId) ?? 0) - getEffectiveTowerStats(tower).consumption)
  }
  for (const [id, rate] of rates) rates.set(id, Math.max(0, rate))
  return rates
}

/** Ressourcen, deren aktuelle Rate nicht ausreicht, um sie DIESEM Turm als Munition zuzuweisen
 * (< seine eigene `consumption` frei, nach Abzug aller ANDEREN Verbraucher). */
function unavailableAmmoIds(targetTowerId: string): Set<string> {
  const targetTower = towers.find((t) => t.id === targetTowerId)
  const consumption = targetTower ? getEffectiveTowerStats(targetTower).consumption : 0
  const rates = computeResourceRates(targetTowerId)
  const disabled = new Set<string>()
  for (const resource of RESOURCES) {
    if ((rates.get(resource.id) ?? 0) < consumption) disabled.add(resource.id)
  }
  return disabled
}

/** Ob ein Turm gerade tatsächlich feuern kann: ohne Munition immer ja (Klarschuss ohne Effekt),
 * mit Munition nur, solange deren Netto-Rate (ohne den eigenen Drain dieses Turms) noch reicht —
 * geht die Ressource aus, hört der Turm auf zu schießen, statt weiter "auf Kredit" zu feuern. */
function hasAmmoAvailable(tower: PlacedTower): boolean {
  if (!tower.resourceId) return true
  return (computeResourceRates(tower.id).get(tower.resourceId) ?? 0) >= getEffectiveTowerStats(tower).consumption
}

function economyTick(dt: number) {
  elapsedSeconds += dt
  recomputeLightSimulation()
  for (const [resourceId, rate] of computeResourceRates()) {
    if (rate > 0) addToInventory(inventory, resourceId, rate * dt)
  }
}

function combatTick(dt: number) {
  if (!defenseReady) return

  tickWaveSpawning(waveState, dt, enemies)

  for (const enemy of enemies) tickEnemy(enemy, dt, elapsedSeconds)

  updateTowers(towers, enemies, dt, elapsedSeconds, enemyPathPixels, towerCenter, hasAmmoAvailable, projectiles, visualEffects)
  projectiles = updateProjectiles(projectiles, enemies, dt, elapsedSeconds, enemyPathPixels, visualEffects)
  visualEffects = pruneVisualEffects(visualEffects, elapsedSeconds)

  const { remaining, killed, arrived } = pruneEnemies(enemies)
  enemies = remaining
  if (killed.length > 0) {
    const lumen = killed.reduce((sum, e) => sum + LUMEN_PER_KILL * (e.isBoss ? BOSS_LUMEN_MULTIPLIER : 1), 0)
    addToInventory(inventory, 'lumen', lumen)
  }
  // Jeder durchgekommene Gegner markiert die aktuelle Welle als nicht geschafft (siehe
  // towerdefense/waves.ts tickWaveSpawning()) — die nächste Welle springt dann 5 zurück statt
  // vorwärtszugehen.
  for (let i = 0; i < arrived.length; i++) registerLeak(waveState)
}

function render(_dt: number) {
  ctx!.fillStyle = COLORS.background
  ctx!.fillRect(0, 0, width, height)

  drawDivider()
  drawEconomyPalette()
  drawBuildings()
  drawTowerPalette()
  drawPaletteTooltips()
  drawWaveStatus()
  drawDefenseNetwork()
  drawTowers()
  drawTowerCombatEffects(ctx!, towers, enemies, enemyPathPixels, towerCenter)
  drawTowerPlacementPreview()
  drawEnemies(ctx!, enemies, enemyPathPixels, elapsedSeconds)
  drawProjectiles(ctx!, projectiles)
  drawVisualEffects(ctx!, visualEffects, elapsedSeconds)

  drawHud(ctx!, width, inventory, computeResourceRates(), playerName, playerLevel, hudButtons, demolishMode)

  if (wheelMode === 'info') {
    drawInfoImagePanel(ctx!, width, height, 'colors')
  } else if (wheelMode === 'ammo' && ammoTargetTowerId) {
    drawColorWheelPanel(ctx!, width, height, wheelSwatches, hoveredWheelResourceId, computeResourceRates(ammoTargetTowerId), unavailableAmmoIds(ammoTargetTowerId))
  }

  if (defenseInfoMode === 'towers') drawTowerReferencePanel(ctx!, width, height)
  else if (defenseInfoMode === 'ammo') drawInfoImagePanel(ctx!, width, height, 'effects')

  drawInfoPanel()
}

startGameLoop({ economyTick, combatTick, render })
