import { COLORS } from './constants/colors'
import { startGameLoop } from './core/gameLoop'
import {
  BUILDING_COSTS,
  createLightSource,
  createMirror,
  createPrism,
  GENERATOR_MAX_LEVEL,
  generatorUpgradeCost,
  rotateMirror,
  rotatePrism,
  upgradeLightSource,
  type LightSource,
  type Mirror,
  type Prism,
} from './economy/buildings'
import { simulateLight, type SimulationResult } from './economy/lightSimulation'
import {
  cellAtPoint,
  cellCenter,
  cellKey,
  drawPlacementGrid,
  gridPixelHeight,
  gridPixelWidth,
  GRID_EXPAND_COST,
  inBounds,
  nearestCell,
  type GridCoord,
  type HexDirection,
  type PlacementGrid,
} from './grid/placementGrid'
import { buildDefenseLookup, traceDefensePath, type Occupancy } from './grid/routing'
import { addToInventory, canAfford, cheatAddHundredToAll, createInventory, spend, type Inventory } from './economy/inventory'
import {
  buildPalette,
  drawBeamSegment,
  drawBeamTraveler,
  drawCellHighlight,
  drawLightSourceEntity,
  drawMaxLevelCellMarker,
  drawMirrorEntity,
  drawPaletteItem,
  drawPrismEntity,
  hitTestPalette,
  isSourceMaxed,
  paletteItemDescription,
  prismSize,
  sourceOuterRadius,
  sourceResourceIdForPalette,
  PRISM_COMPLEX_SIZE,
  PRISM_SIMPLE_SIZE,
  SOURCE_OUTER_SIZE,
  type PaletteItem,
  type PaletteKind,
} from './render/buildingRender'
import { buildHudButtons, drawHud, hitTestButton, HUD_HEIGHT, type HudButton } from './render/hud'
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
import { getEffectiveTowerStats, createTower, getTowerDefinition, loadoutKey, towerUpgradeCost, TOWER_DEFINITIONS, TOWER_MAX_LEVEL, type PlacedTower, type TowerKind } from './towerdefense/towers'
import { getResource, RESOURCES } from './data/resources'
import { drawHexagon, drawLabel } from './render/shapes'
import { drawPath, pathTotalLength, type Point } from './towerdefense/path'
import { updateProjectiles, updateTowers, pruneVisualEffects, type Projectile, type VisualEffect } from './towerdefense/combat'
import { pruneEnemies, tickEnemy, type Enemy } from './towerdefense/enemies'
import { createWaveState, isBossWave, registerLeak, tickWaveSpawning, waveEnemyHp, BOSS_LUMEN_MULTIPLIER, type WaveState } from './towerdefense/waves'
import { drawEnemies, drawProjectiles, drawTowerCombatEffects, drawVisualEffects } from './render/combatRender'
import { drawColorGuidePanel, drawTowerReferencePanel, drawWelcomePanel, hitTestReferencePanelClose } from './render/referencePanels'

const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = canvas.getContext('2d')
if (!ctx) throw new Error('Canvas 2D context is not supported')

let width = 0
let height = 0

// Info-Feld oben (Spielername/Level/Ressourcen/Einstellungen/Speichern/Cheat) + Bestand.
const inventory: Inventory = createInventory()
const playerName = 'Commander'
const playerLevel = 1
let hudButtons: HudButton[] = []
let paletteItems: PaletteItem[] = []

// Nachschlage-Seiten (blockierende Modals, siehe render/referencePanels.ts): "Türme" listet alle
// Turmtypen, der Farb-Guide alle Farben (aus dem jeweiligen Icon der Kauf-Leiste geöffnet).
let towersInfoOpen = false
let colorGuideOpen = false

// Einmaliges Tutorial-Popup (User-Vorgabe: "beim ersten starten") — merkt sich per localStorage,
// ob es schon gezeigt wurde, damit es bei künftigen Besuchen nicht erneut aufploppt (versucht
// erst gar nicht, mehr als dieses eine Flag zu speichern — es gibt sonst kein Save-System).
const TUTORIAL_SEEN_KEY = 'vectoid-tutorial-seen'
function hasSeenTutorial(): boolean {
  try {
    return localStorage.getItem(TUTORIAL_SEEN_KEY) === '1'
  } catch {
    return false
  }
}
function markTutorialSeen() {
  try {
    localStorage.setItem(TUTORIAL_SEEN_KEY, '1')
  } catch {
    // Private-Browsing o. Ä. — dann zeigt sich das Tutorial halt jedes Mal, kein Absturz nötig.
  }
}
let welcomeOpen = !hasSeenTutorial()

// Info-Panel (Klick auf ein Gebäude/einen Turm): zeigt Name/Level/Produktionsdaten bzw.
// Name/Munition/Level. Blockiert alle anderen Interaktionen, solange offen.
interface InfoTarget {
  kind: 'source' | 'tower'
  id: string
}
interface InfoPanelRow {
  label: string
  value: string
  y: number
  height: number
  /** 'level' versucht ein Level-Up (siehe attemptLevelUp() weiter unten) — über denselben
   * klickbaren-Zeile-Mechanismus wie überall sonst in diesem Panel. Türme haben kein 'ammo'-Row-
   * Action mehr (User-Vorgabe: Munition kommt jetzt rein aus der Strahl-Verkabelung, siehe
   * economyTick()) — die "Ammo"-Zeile ist nur noch Anzeige. */
  action?: 'level'
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
// Ein Toggle-Icon in der Kauf-Leiste schaltet den Modus ein/aus — solange aktiv, löscht ein Klick
// auf ein Gebäude/einen Turm ihn sofort statt ihn auszuwählen/zu drehen.
let demolishMode = false

/** Klick vs. Halten+Ziehen auf Generator-Innenkreis/Producer-/Turm-Körper: erst nach dem
 * Loslassen entscheiden, ob es ein Klick (Info-Panel) oder ein Ziehen (Verschieben) war. */
interface PendingPress {
  kind: 'source' | 'mirror' | 'prism' | 'tower' | 'spawn'
  id: string
  downPos: Point
}
let pendingPress: PendingPress | null = null
const PRESS_MOVE_THRESHOLD = 6

// Türme: eigener Abschnitt der kombinierten Kauf-Leiste (siehe buildScene()). Stehen wie jedes
// andere Gebäude auf dem gemeinsamen Raster (siehe placementGrid weiter unten).
let towers: PlacedTower[] = []
let towerPaletteItems: TowerPaletteItem[] = []
let towerCounter = 0
let placingTowerKind: TowerKind | null = null
let placingTowerCursor: Point | null = null

function nextTowerId(): string {
  towerCounter += 1
  return `tower-${towerCounter}`
}

/** Eine einzige kombinierte Kauf-Leiste (User-Vorgabe: "alles auf einem Grid" statt getrennter
 * Economy-/Defense-Reihen) — `buildPalette()` liefert die ersten Einträge (Lichtquellen/Spiegel/
 * Prismen), `buildTowerPalette()` reiht direkt danach die Turmtypen + Grid-Erweiterung/Info-Icons
 * an (`startX` verschoben um genau `paletteItems.length` Positionen). */
const PALETTE_GAP = 64

function buildScene() {
  hudButtons = buildHudButtons(width)
  paletteItems = buildPalette(56, HUD_HEIGHT + 62, PALETTE_GAP)
  towerPaletteItems = buildTowerPalette(56 + paletteItems.length * PALETTE_GAP, HUD_HEIGHT + 62, PALETTE_GAP)
}

// Das gemeinsame Raster (User-Vorgabe: "Instead of having the split between economy and defense,
// i want to have everything on one grid") — Lichtquellen/Spiegel/Prismen/Türme UND der Gegner-
// Spawn/-Pfad leben alle hier zusammen, teilen sich EINE Belegungs-Map. Ein Strahl muss jetzt in
// einem Turm ENDEN, um dessen Farbe als Munition zu liefern (siehe economy/lightSimulation.ts,
// economyTick() weiter unten) — kein Container-Bautyp mehr. Jedes Nicht-Spiegel-Gebäude blockiert
// den Gegner-Pfad genau wie früher nur ein Turm (siehe recomputeEnemyPath()); Spiegel lenken
// sowohl Licht ALS AUCH den Gegner-Pfad um (dieselben Objekte, siehe grid/routing.ts).
let placementGrid: PlacementGrid
let lightSources: LightSource[] = []
let mirrors: Mirror[] = []
let prisms: Prism[] = []
let occupancy: Occupancy = new Map()
let worldReady = false
let lightSimulation: SimulationResult = { segments: [], prismStatus: new Map(), towerAmmo: new Map(), activeSourceIds: new Set() }

let spawnNode: GridCoord
let spawnDirection: HexDirection = 0
let enemyPathPixels: Point[] = []
/** Gesamtlänge des aktuellen Pfads in Pixeln — cached, damit tickEnemy() nicht jeden Frame für
 * jeden Gegner neu über den ganzen Pfad summieren muss (siehe recomputeEnemyPath()). */
let enemyPathLength = 0
/** Id des Gebäudes, an dem der aktuelle Gegner-Pfad endet — `null`, wenn er stattdessen am
 * Rasterrand endet (noch kein Hindernis im Weg). Nur für die "Wand"-Marker-Entscheidung in
 * drawPath() gebraucht (siehe grid/routing.ts DefensePathResult). */
let pathHitBlockerId: string | null = null

function rebuildOccupancy() {
  occupancy = new Map()
  occupancy.set(cellKey(spawnNode), 'spawn')
  for (const b of [...lightSources, ...mirrors, ...prisms, ...towers]) occupancy.set(cellKey({ col: b.col, row: b.row }), b.id)
}

function recomputeLightSimulation() {
  lightSimulation = simulateLight(placementGrid, lightSources, mirrors, prisms, towers)
}

/** Gegner-Pfad: strahlt ab `spawnNode` los, Spiegel lenken um, JEDES andere Gebäude (Lichtquelle/
 * Prisma/Turm — User-Vorgabe: "jedes gebäude blockiert den Weg wie ein Turm") beendet den Pfad
 * dort, wie zuvor nur ein Turm. Muss nach JEDER Änderung an Spiegeln/Lichtquellen/Prismen/Türmen
 * neu aufgerufen werden (nicht nur bei Turm-/Spiegel-Änderungen wie vor der Zusammenlegung). */
function recomputeEnemyPath() {
  const blockers = [...lightSources, ...prisms, ...towers].map((b) => ({ id: b.id, col: b.col, row: b.row }))
  const lookup = buildDefenseLookup(mirrors, blockers)
  const maxSteps = (placementGrid.cols + placementGrid.rows) * 4 // Sicherheitsbremse gg. Spiegel-Endlosschleife
  const { cells, hitBlockerId } = traceDefensePath(placementGrid, lookup, spawnNode, spawnDirection, maxSteps)
  enemyPathPixels = cells.map((c) => cellCenter(placementGrid, c))
  enemyPathLength = pathTotalLength(enemyPathPixels)
  pathHitBlockerId = hitBlockerId
}

function buildingCenter(b: { col: number; row: number }) {
  return cellCenter(placementGrid, { col: b.col, row: b.row })
}

/** Gültige Zelle fürs Platzieren/Verschieben irgendeines Gebäudes/Spiegels/Turms — frei ODER vom
 * gezogenen Gebäude selbst (`ignoreId`) belegt. Ein Tausch (siehe finalizeMove()) entscheidet sich
 * NICHT hier, sondern beim Aufrufer (dieser Check lässt jede belegte Zelle als "gültiges Ziel"
 * durch, `ignoreId` betrifft nur das Sonderfall "eigene alte Zelle"). */
function canPlaceAt(cell: GridCoord): boolean {
  return inBounds(placementGrid, cell)
}

function canMoveSpawnTo(cell: GridCoord): boolean {
  if (!inBounds(placementGrid, cell)) return false
  const occupant = occupancy.get(cellKey(cell))
  return !occupant || occupant === 'spawn'
}

function buildWorld() {
  const cellSize = 34
  placementGrid = { cols: 7, rows: 7, cellSize, originX: 0, originY: HUD_HEIGHT + 126 }
  placementGrid.originX = (width - gridPixelWidth(placementGrid)) / 2

  spawnNode = { col: 0, row: 0 } // User-Vorgabe: Standard-Startpunkt ist das Feld oben links
  spawnDirection = 0 // zeigt zu Beginn ins Rasterinnere (Spawn sitzt oben-links)

  // User-Vorgabe: kein Container mehr zum Vorführen des Grundprinzips da — nur EIN Cyan-Generator,
  // der Spieler verkabelt sich seinen ersten Turm selbst.
  lightSources = [createLightSource(0, 3, 'cyan')]
  mirrors = []
  prisms = []
  towers = []
  enemies = []
  waveState = createWaveState()

  rebuildOccupancy()
  worldReady = true
  recomputeLightSimulation()
  recomputeEnemyPath()
}

/** Erweitert das gemeinsame Raster um 1 Spalte + 1 Zeile — oben-links bleibt fix verankert (Spawn-
 * Ecke), neue Spalten/Zeilen kommen rechts/unten dazu, keine bestehende Gebäude-Koordinate ändert
 * sich (anders als beim früheren, nach links wachsenden Economy-Raster). */
function expandGrid() {
  if (!canAfford(inventory, 'prisma', GRID_EXPAND_COST)) return
  spend(inventory, 'prisma', GRID_EXPAND_COST)
  placementGrid = { ...placementGrid, cols: placementGrid.cols + 1, rows: placementGrid.rows + 1 }
  // Der Pfad kann bisher an der jetzt verschobenen Wand geendet haben — mit mehr Platz läuft er
  // ggf. weiter, bis er ein Hindernis trifft oder die NEUE (weiter entfernte) Wand erreicht.
  recomputeEnemyPath()
}

// Kampf-Simulation: Gegner spawnen wellenweise (siehe towerdefense/waves.ts — 20 Gegner/Welle, 5s
// Pause danach (10s nach einer Boss-Welle), jede Welle stärker, Boss alle 10 Wellen, Fehlschlag
// setzt 5 Wellen zurück), Türme feuern automatisch auf Gegner in Reichweite (siehe towerdefense/
// combat.ts). Munition kommt direkt aus der Licht-Simulation (siehe economyTick()) — kein
// globaler Ratenpool, keine manuelle Auswahl mehr.
let enemies: Enemy[] = []
let projectiles: Projectile[] = []
let visualEffects: VisualEffect[] = []
let waveState: WaveState = createWaveState()
/** Summe des tatsächlich abgezogenen Treffer-Schadens je Turm-Konfiguration (Turmart + Munitions-
 * farbe, siehe towerdefense/towers.ts loadoutKey()) — läuft die ganze Session über weiter (auch
 * über Wellen hinweg), auch wenn die zugehörigen Türme später abgerissen werden (siehe main.ts
 * drawTowerLoadoutSummary()). */
let damageByLoadout = new Map<string, number>()
const LUMEN_PER_KILL = 2

function resize() {
  const dpr = window.devicePixelRatio || 1
  width = window.innerWidth
  height = window.innerHeight
  canvas.width = width * dpr
  canvas.height = height * dpr
  ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
  buildScene()
  if (!worldReady) buildWorld()
}

window.addEventListener('resize', resize)
resize()

// --- Interaktion ---
// Lichtquelle/Prisma/Turm halten+ziehen = verschieben, kurz antippen = Info-Panel. Spiegel
// antippen dreht ihn sofort (kein Info-Panel dafür, siehe User-Vorgabe) — halten+ziehen verschiebt
// ihn trotzdem, genau wie den Spawn (der stattdessen seine Abstrahlrichtung dreht). Kauf-Leiste
// anfassen = neues Gebäude ziehen und aufs Raster fallen lassen (kostet Lumen) bzw. Raster
// erweitern (kostet Prisma, sofortige Aktion statt Drag).

function pointerPos(e: PointerEvent): Point {
  const rect = canvas.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

interface EconomyHit {
  kind: 'source' | 'mirror' | 'prism'
  id: string
}

function hitTestEconomyBuilding(x: number, y: number): EconomyHit | null {
  for (const source of lightSources) {
    if (Math.hypot(buildingCenter(source).x - x, buildingCenter(source).y - y) <= sourceOuterRadius(source) + 6) return { kind: 'source', id: source.id }
  }
  for (const mirror of mirrors) {
    if (Math.hypot(buildingCenter(mirror).x - x, buildingCenter(mirror).y - y) <= placementGrid.cellSize * 0.45) return { kind: 'mirror', id: mirror.id }
  }
  for (const prism of prisms) {
    if (Math.hypot(buildingCenter(prism).x - x, buildingCenter(prism).y - y) <= prismSize(prism) + 6) return { kind: 'prism', id: prism.id }
  }
  return null
}

function towerCenter(tower: PlacedTower) {
  return cellCenter(placementGrid, { col: tower.col, row: tower.row })
}

function hitTestTower(x: number, y: number): PlacedTower | null {
  return towers.find((t) => Math.hypot(towerCenter(t).x - x, towerCenter(t).y - y) <= TOWER_ICON_SIZE + 6) ?? null
}

/** Spawn-Hexagon anfassen — Klick dreht seine Abstrahlrichtung (wie ein Prisma), Halten+Ziehen
 * verschiebt ihn (siehe pendingPress-Logik unten). */
function hitTestSpawn(x: number, y: number): boolean {
  const spawnCenter = cellCenter(placementGrid, spawnNode)
  return Math.hypot(spawnCenter.x - x, spawnCenter.y - y) <= 20
}

/** Löscht ein Gebäude (Lichtquelle/Spiegel/Prisma) und erstattet seinen Lumen-Baukosten zurück
 * (User-Wunsch) — jedes davon kann den Gegner-Pfad blockiert haben, daher immer beide Neu-
 * Berechnungen (Belegung + Pfad) danach. */
function demolishEconomyBuilding(hit: EconomyHit) {
  if (hit.kind === 'source') {
    lightSources = lightSources.filter((s) => s.id !== hit.id)
    addToInventory(inventory, 'lumen', BUILDING_COSTS.source)
  } else if (hit.kind === 'mirror') {
    mirrors = mirrors.filter((m) => m.id !== hit.id)
    addToInventory(inventory, 'lumen', BUILDING_COSTS.mirror)
  } else {
    const prism = prisms.find((p) => p.id === hit.id)
    prisms = prisms.filter((p) => p.id !== hit.id)
    if (prism) addToInventory(inventory, 'lumen', prism.prismKind === 'triangle' ? BUILDING_COSTS.prismSimple : BUILDING_COSTS.prismComplex)
  }
  rebuildOccupancy()
  recomputeEnemyPath()
  if (infoTarget && infoTarget.id === hit.id) infoTarget = null
}

/** Levelt das Gebäude/den Turm hinter `target` um 1 hoch, sofern noch nicht maximal und die
 * Lumen-Kosten (siehe economy/buildings.ts generatorUpgradeCost()/towerdefense/towers.ts
 * towerUpgradeCost()) bezahlt werden können — ausgelöst durch Klick auf die "Level"-Zeile im
 * Info-Panel (siehe pointerdown). Prismen/Spiegel haben kein Level und daher auch kein Info-Panel
 * — Klick dreht sie stattdessen (siehe pendingPress-Logik). */
function attemptLevelUp(target: InfoTarget) {
  if (target.kind === 'source') {
    const source = lightSources.find((s) => s.id === target.id)
    if (!source || source.level >= GENERATOR_MAX_LEVEL) return
    const cost = generatorUpgradeCost(source.level + 1)
    if (!canAfford(inventory, 'lumen', cost)) return
    spend(inventory, 'lumen', cost)
    upgradeLightSource(source)
  } else {
    const tower = towers.find((t) => t.id === target.id)
    if (!tower || tower.level >= TOWER_MAX_LEVEL) return
    const cost = towerUpgradeCost(getTowerDefinition(tower.kind), tower.level + 1)
    if (!canAfford(inventory, 'lumen', cost)) return
    spend(inventory, 'lumen', cost)
    tower.level += 1
  }
}

/** Löscht einen Turm und erstattet seinen Lumen-Baukosten zurück (User-Wunsch). */
function demolishTower(tower: PlacedTower) {
  towers = towers.filter((t) => t.id !== tower.id)
  addToInventory(inventory, 'lumen', getTowerDefinition(tower.kind).cost)
  rebuildOccupancy()
  recomputeEnemyPath()
  if (infoTarget && infoTarget.id === tower.id) infoTarget = null
}

let placingNewKind: PaletteKind | null = null
let placingCursor: Point | null = null
let hoveredEconomyItem: PaletteItem | null = null
let hoveredTowerItem: TowerPaletteItem | null = null
let movingBuildingId: string | null = null
let movingKind: 'source' | 'mirror' | 'prism' | 'tower' | 'spawn' | null = null
let movingCursor: Point | null = null

function handleHudButton(id: HudButton['id']) {
  if (id === 'cheat') cheatAddHundredToAll(inventory)
  else if (id === 'demolish') demolishMode = !demolishMode
  // 'settings' und 'save': absichtlich ohne Funktion (User-Wunsch — noch keine Logik dahinter).
}

canvas.addEventListener('pointerdown', (e) => {
  const pos = pointerPos(e)

  // Tutorial-Popup blockiert alles andere, solange offen (nur beim allerersten Start).
  if (welcomeOpen) {
    if (hitTestReferencePanelClose(width, height, pos.x, pos.y)) {
      welcomeOpen = false
      markTutorialSeen()
    }
    return
  }

  // Info-Panel blockiert alle anderen Interaktionen, solange es offen ist.
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
    if (clickedRow?.action === 'level') {
      attemptLevelUp(infoTarget)
      return
    }
    const insidePanel = pos.x >= x && pos.x <= x + w && pos.y >= y && pos.y <= y + h
    if (!insidePanel) infoTarget = null
    return
  }

  // Türme-Infoseite / Farb-Guide blockieren ebenso alle anderen Interaktionen, solange offen —
  // reine Anzeige, einziger Klick-Handler ist das Schließen.
  if (towersInfoOpen) {
    if (hitTestReferencePanelClose(width, height, pos.x, pos.y)) towersInfoOpen = false
    return
  }
  if (colorGuideOpen) {
    if (hitTestReferencePanelClose(width, height, pos.x, pos.y)) colorGuideOpen = false
    return
  }

  const button = hudButtons.find((b) => hitTestButton(b, pos.x, pos.y))
  if (button) {
    handleHudButton(button.id)
    return
  }

  const paletteItem = hitTestPalette(paletteItems, pos.x, pos.y)
  if (paletteItem) {
    placingNewKind = paletteItem.kind
    placingCursor = pos
    return
  }

  const towerPaletteItem = hitTestTowerPalette(towerPaletteItems, pos.x, pos.y)
  if (towerPaletteItem) {
    if (towerPaletteItem.kind === 'expand-grid') expandGrid()
    else if (towerPaletteItem.kind === 'tower-info') towersInfoOpen = true
    else if (towerPaletteItem.kind === 'color-guide') colorGuideOpen = true
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

  if (hitTestSpawn(pos.x, pos.y)) {
    // Kein Abriss für den Spawn — er ist Pflichtbestandteil des Rasters (immer genau 1).
    pendingPress = { kind: 'spawn', id: 'spawn', downPos: pos }
    return
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
  if (welcomeOpen) return
  if (infoTarget) return
  if (towersInfoOpen) return
  if (colorGuideOpen) return

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
  } else {
    const resourceId = sourceResourceIdForPalette(kind)
    if (!resourceId) return
    if (!canAfford(inventory, 'lumen', BUILDING_COSTS.source)) return
    spend(inventory, 'lumen', BUILDING_COSTS.source)
    lightSources.push(createLightSource(cell.col, cell.row, resourceId))
  }
  rebuildOccupancy()
  recomputeEnemyPath()
}

/** Irgendein Lichtquelle/Spiegel/Prisma (unabhängig vom Typ) anhand seiner Id finden — fürs
 * generische Verschieben/Tauschen, das nicht wissen muss, in welchem der 3 Arrays es steckt. */
function findEconomyBuilding(id: string): { col: number; row: number } | null {
  return lightSources.find((s) => s.id === id) ?? mirrors.find((m) => m.id === id) ?? prisms.find((p) => p.id === id) ?? null
}

/** Kein explizites Neu-Routen der Licht-Simulation nötig — die wird jeden Frame komplett neu aus
 * den aktuellen Positionen berechnet (siehe recomputeLightSimulation()), verschobene Bauwerke
 * wirken sich also automatisch auf den nächsten Frame aus. Der Gegner-Pfad dagegen wird NUR bei
 * Bedarf neu verfolgt (siehe recomputeEnemyPath()) — jedes dieser 3 Gebäude kann ihn blockieren.
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
    if (occupantId === 'spawn') return // Spawn hat sein eigenes Verschiebe-Ziel, kein Tauschpartner
    const other = findEconomyBuilding(occupantId) ?? towers.find((t) => t.id === occupantId)
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
  recomputeEnemyPath()
}

/** Turm verschieben: snapt auf den nächsten freien Knotenpunkt (oder tauscht mit dessen Besitzer,
 * siehe finalizeMove() — dieselbe Logik gilt jetzt einheitlich für jeden Gebäudetyp). Ungültiges
 * Ziel (außerhalb des Rasters) -> Turm bleibt an alter Position. */
function finalizeTowerMove(pos: Point) {
  const tower = towers.find((t) => t.id === movingBuildingId)
  if (!tower) return
  const cell = nearestCell(placementGrid, pos.x, pos.y)
  if (!canPlaceAt(cell)) return

  const occupantId = occupancy.get(cellKey(cell))
  if (occupantId && occupantId !== tower.id && occupantId !== 'spawn') {
    const other = findEconomyBuilding(occupantId) ?? towers.find((t) => t.id === occupantId)
    if (other) {
      const originalCol = tower.col
      const originalRow = tower.row
      tower.col = other.col
      tower.row = other.row
      other.col = originalCol
      other.row = originalRow
    }
  } else if (!occupantId) {
    tower.col = cell.col
    tower.row = cell.row
  }
  rebuildOccupancy()
  recomputeEnemyPath()
}

function finalizeTowerPlacement(pos: Point) {
  const kind = placingTowerKind
  if (!kind) return
  const cell = nearestCell(placementGrid, pos.x, pos.y)
  if (!canPlaceAt(cell) || occupancy.has(cellKey(cell))) return

  const def = getTowerDefinition(kind)
  if (!canAfford(inventory, 'lumen', def.cost)) return
  spend(inventory, 'lumen', def.cost)
  towers.push(createTower(nextTowerId(), kind, cell.col, cell.row))
  rebuildOccupancy()
  recomputeEnemyPath()
}

function finalizeSpawnMove(pos: Point) {
  const cell = nearestCell(placementGrid, pos.x, pos.y)
  if (!canMoveSpawnTo(cell)) return
  spawnNode = cell
  rebuildOccupancy()
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
    // Spiegel ODER einem Prisma dreht ein Klick es direkt (User-Vorgabe: "Prismen müssen auch
    // gedreht werden können, wie Spiegel") statt ein Info-Panel zu öffnen. Der Spawn dreht ebenso
    // seine Abstrahlrichtung (dasselbe Prinzip). Ein Spiegel dreht sowohl Licht- als auch
    // Gegner-Pfad-Richtung (dieselben Objekte, siehe recomputeEnemyPath()).
    if (pendingPress.kind === 'mirror') {
      const mirror = mirrors.find((m) => m.id === pendingPress!.id)
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

const TOWER_PALETTE_EXTRA_KINDS = new Set(['expand-grid', 'tower-info', 'color-guide'])

/** Hover-Tooltip über einem Kauf-Leisten-Icon — Name + kurzer Zweck, siehe
 * paletteItemDescription()/towerPaletteItemDescription(). Nutzt denselben Chip-Look wie die
 * übrigen Panels (drawLabel(), aus shapes.ts). */
function drawPaletteTooltips() {
  // Sobald ein Modal offen ist, aktualisiert pointermove hoveredEconomyItem/hoveredTowerItem
  // nicht mehr (siehe early returns dort) — ohne diese Sperre würde sonst ein stehen gebliebenes
  // Tooltip vom Icon-Klick, der das Modal gerade erst geöffnet hat, sichtbar bleiben.
  if (welcomeOpen || infoTarget || towersInfoOpen || colorGuideOpen) return
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
  const cell = nearestCell(placementGrid, placingTowerCursor.x, placingTowerCursor.y)
  const center = cellCenter(placementGrid, cell)

  const valid = canPlaceAt(cell) && !occupancy.has(cellKey(cell))
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

/** Wellenstand rechts oben (siehe towerdefense/waves.ts) — Wellennummer + Boss-Hinweis (jede 10.
 * Welle) plus Spawn-Fortschritt bzw. Pause-Countdown, sowie darunter die HP der Gegner dieser
 * Welle (User-Vorgabe) — inkl. Boss-HP, falls vorhanden. */
function drawWaveStatus() {
  const boss = isBossWave(waveState.currentWave)
  const status =
    waveState.phase === 'spawning' ? `${waveState.enemiesSpawnedInWave}/${waveState.totalInWave} spawned` : `next wave in ${Math.ceil(waveState.pauseTimer)}s`
  const { regularHp, bossHp } = waveEnemyHp(waveState.currentWave)
  const hpLine = bossHp !== null ? `HP ${Math.round(regularHp)}  ·  Boss HP ${Math.round(bossHp)}` : `HP ${Math.round(regularHp)}`

  ctx!.save()
  ctx!.textAlign = 'right'
  ctx!.font = 'bold 12px monospace'
  ctx!.fillStyle = boss ? '#ffcc33' : COLORS.textBright
  ctx!.fillText(boss ? `WAVE ${waveState.currentWave} — BOSS  ·  ${status}` : `WAVE ${waveState.currentWave}  ·  ${status}`, width - 20, HUD_HEIGHT + 20)
  ctx!.font = '11px monospace'
  ctx!.fillStyle = COLORS.textMid
  ctx!.fillText(hpLine, width - 20, HUD_HEIGHT + 36)
  ctx!.restore()
}

interface LoadoutSummaryEntry {
  kind: TowerKind
  resourceId: string
  count: number
  damage: number
}

/** Aktuell platzierte Türme, gruppiert nach Konfiguration (Turmart + Munitionsfarbe, siehe
 * towerdefense/towers.ts loadoutKey()) — EIN Eintrag je Konfiguration, unabhängig davon, wie
 * viele Türme genau dieser Art/Farbe gerade stehen (User-Vorgabe: "nur 1x pro Art"). Türme ohne
 * aktuelle Munition zählen nicht mit (haben noch keine "Konfiguration"). Sortiert nach Turmart
 * (Reihenfolge der Kauf-Leiste) dann Ressourcen-Tier, für eine stabile, nicht "springende"
 * Reihenfolge zwischen Frames. */
function currentLoadoutSummary(): LoadoutSummaryEntry[] {
  const byKey = new Map<string, LoadoutSummaryEntry>()
  for (const tower of towers) {
    if (!tower.resourceId) continue
    const key = loadoutKey(tower.kind, tower.resourceId)
    const existing = byKey.get(key)
    if (existing) existing.count += 1
    else byKey.set(key, { kind: tower.kind, resourceId: tower.resourceId, count: 1, damage: damageByLoadout.get(key) ?? 0 })
  }
  const kindOrder = TOWER_DEFINITIONS.map((d) => d.kind)
  const resourceOrder = RESOURCES.map((r) => r.id)
  return [...byKey.values()].sort((a, b) => {
    const kindDiff = kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind)
    return kindDiff !== 0 ? kindDiff : resourceOrder.indexOf(a.resourceId) - resourceOrder.indexOf(b.resourceId)
  })
}

const LOADOUT_SUMMARY_WIDTH = 230

/** Listet unter dem Raster je Turm-Konfiguration die Anzahl + den bisher insgesamt damit
 * angerichteten Treffer-Schaden (User-Vorgabe). */
function drawTowerLoadoutSummary() {
  const entries = currentLoadoutSummary()
  if (entries.length === 0) return

  const x = placementGrid.originX
  let y = placementGrid.originY + gridPixelHeight(placementGrid) + 34

  ctx!.save()
  ctx!.textAlign = 'left'
  ctx!.fillStyle = COLORS.textDim
  ctx!.font = '11px monospace'
  ctx!.fillText('T O W E R   D A M A G E', x, y)
  y += 22

  for (const entry of entries) {
    const resource = getResource(entry.resourceId)
    const def = getTowerDefinition(entry.kind)

    ctx!.fillStyle = resource.color
    ctx!.beginPath()
    ctx!.arc(x + 5, y - 4, 5, 0, Math.PI * 2)
    ctx!.fill()

    ctx!.textAlign = 'left'
    ctx!.fillStyle = COLORS.textBright
    ctx!.font = '12px monospace'
    ctx!.fillText(`${entry.count}x ${resource.name} ${def.name}`, x + 16, y)

    ctx!.textAlign = 'right'
    ctx!.fillStyle = COLORS.textMid
    ctx!.fillText(`${Math.round(entry.damage)} dmg`, x + LOADOUT_SUMMARY_WIDTH, y)

    y += 19
  }
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
  let rowsInput: { label: string; value: string; action?: 'level' }[]

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
      { label: 'Status', value: active ? 'Delivering' : 'Idle (no tower in range)' },
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
    const ammo = lightSimulation.towerAmmo.get(tower.id)
    const ammoLabel = tower.resourceId
      ? `${getResource(tower.resourceId).name} (strength ${ammo?.strength ?? 0})`
      : '— (not connected)'
    const maxed = tower.level >= TOWER_MAX_LEVEL
    rowsInput = [
      { label: 'Name', value: def.name },
      { label: 'Ammo', value: tower.resourceId && !hasAmmoAvailable(tower) ? `${ammoLabel} (Shortage!)` : ammoLabel },
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
  }
  ctx!.restore()
}

function drawMovePreview() {
  if (!movingBuildingId || !movingCursor) return

  if (movingKind === 'tower') {
    const tower = towers.find((t) => t.id === movingBuildingId)
    if (!tower) return
    const cell = nearestCell(placementGrid, movingCursor.x, movingCursor.y)
    const valid = canPlaceAt(cell)
    const center = cellCenter(placementGrid, cell)
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

  if (movingKind === 'spawn') {
    const cell = nearestCell(placementGrid, movingCursor.x, movingCursor.y)
    const valid = canMoveSpawnTo(cell)
    const center = cellCenter(placementGrid, cell)
    drawCellHighlight(ctx!, placementGrid, cell, valid ? '#39ff8f' : '#ff3355', 0.3)
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
  }
  if (!kind) return

  if (cell) drawCellHighlight(ctx!, placementGrid, cell, valid ? '#39ff8f' : '#ff3355', 0.3)
  const previewPos = cell ? cellCenter(placementGrid, cell) : movingCursor
  drawPaletteGhost(kind, previewPos)
}

/** Das gemeinsame Raster: Rasterlinien + Gegner-Pfad (inkl. Spawn-Marker) + Lichtstrahlen +
 * Max-Level-Marker + alle Gebäude (Lichtquellen/Spiegel/Prismen) — Türme werden separat danach
 * gezeichnet (siehe drawTowers(), für die richtige Ziel-Priorität beim Klicken sowie den
 * "Shortage"-Alpha-Effekt). */
function drawWorld() {
  drawPlacementGrid(ctx!, placementGrid, COLORS.gridLineStrong)

  drawPath(ctx!, enemyPathPixels, pathHitBlockerId !== null)

  for (const segment of lightSimulation.segments) drawBeamSegment(ctx!, placementGrid, segment)
  for (const segment of lightSimulation.segments) {
    if (segment.reachedEndpoint) drawBeamTraveler(ctx!, placementGrid, segment, elapsedSeconds)
  }

  drawPlacementPreview()
  drawMovePreview()

  for (const source of lightSources) {
    if (isSourceMaxed(source)) drawMaxLevelCellMarker(ctx!, placementGrid, { col: source.col, row: source.row })
  }

  for (const source of lightSources) drawLightSourceEntity(ctx!, source, buildingCenter(source), elapsedSeconds)
  for (const mirror of mirrors) drawMirrorEntity(ctx!, mirror, buildingCenter(mirror), placementGrid.cellSize)
  for (const prism of prisms) {
    const status = lightSimulation.prismStatus.get(prism.id)
    if (status) drawPrismEntity(ctx!, prism, buildingCenter(prism), status, elapsedSeconds)
  }
}

let elapsedSeconds = 0

/** Ob ein Turm gerade tatsächlich feuern kann: ohne Verkabelung immer ja (Klarschuss ohne
 * Effekt), verkabelt nur, solange die ankommende Strahl-Stärke seine `consumption` deckt — geht
 * die Strahl-Stärke unter den Bedarf, hört der Turm auf zu schießen, statt weiter "auf Kredit" zu
 * feuern (siehe economy/lightSimulation.ts für die Stärke-Berechnung). */
function hasAmmoAvailable(tower: PlacedTower): boolean {
  if (!tower.resourceId) return true
  const ammo = lightSimulation.towerAmmo.get(tower.id)
  return (ammo?.strength ?? 0) >= getEffectiveTowerStats(tower).consumption
}

function economyTick(dt: number) {
  elapsedSeconds += dt
  recomputeLightSimulation()
  // Munition kommt jetzt live aus der Strahl-Verkabelung (User-Vorgabe) — kein manuelles
  // Zuweisen mehr, kein globaler Ratenpool: jeder Turm übernimmt jeden Frame direkt, welche Farbe
  // (falls überhaupt eine) ihn gerade erreicht (siehe economy/lightSimulation.ts towerAmmo).
  for (const tower of towers) {
    tower.resourceId = lightSimulation.towerAmmo.get(tower.id)?.resourceId ?? null
  }
}

function combatTick(dt: number) {
  if (!worldReady) return

  tickWaveSpawning(waveState, dt, enemies)

  for (const enemy of enemies) tickEnemy(enemy, dt, elapsedSeconds, enemyPathLength)

  updateTowers(towers, enemies, dt, elapsedSeconds, enemyPathPixels, towerCenter, hasAmmoAvailable, projectiles, visualEffects, damageByLoadout)
  projectiles = updateProjectiles(projectiles, enemies, dt, elapsedSeconds, enemyPathPixels, visualEffects, damageByLoadout)
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

  drawEconomyPalette()
  drawTowerPalette()
  drawPaletteTooltips()
  drawWaveStatus()
  drawWorld()
  drawTowerLoadoutSummary()
  drawTowers()
  drawTowerCombatEffects(ctx!, towers, enemies, enemyPathPixels, towerCenter)
  drawTowerPlacementPreview()
  drawEnemies(ctx!, enemies, enemyPathPixels, elapsedSeconds)
  drawProjectiles(ctx!, projectiles)
  drawVisualEffects(ctx!, visualEffects, elapsedSeconds)

  drawHud(ctx!, width, inventory, playerName, playerLevel, hudButtons, demolishMode)

  if (towersInfoOpen) drawTowerReferencePanel(ctx!, width, height)
  if (colorGuideOpen) drawColorGuidePanel(ctx!, width, height)

  drawInfoPanel()

  if (welcomeOpen) drawWelcomePanel(ctx!, width, height)
}

startGameLoop({ economyTick, combatTick, render })
